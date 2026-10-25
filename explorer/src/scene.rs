//! The town in Bevy: the ground (terrain, water, lots, roads, parks), buildings (merged by tile, so whole tiles are
//! culled at once and the overlays recolour them in one write), trees, people (one GPU-driven mesh: people.wesl), and
//! seats' acts and changes as arcs and rings. Light follows the hour: the sun's arc, a sky and fog that go from dawn to
//! night, warm lit windows after dark. Read-only: the scene only reads the tracks it is given.

use crate::bridge::{CameraCmd, Command, Event, Sel, Stats};
use crate::data::{self, Pulse, WorldData, DAY};
use crate::layout::{self, hash01, Layout, LEVEL};
use crate::overlays::{self, lin};
use crate::source::{Req, Resp, Source};
use crate::tracks::{Crowd, Need, Window as Days};
use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::NoFrustumCulling;
use bevy::camera::ScalingMode;
use bevy::image::{ImageAddressMode, ImageSampler, ImageSamplerDescriptor};
use bevy::input::mouse::{MouseMotion, MouseScrollUnit, MouseWheel};
use bevy::light::NotShadowCaster;
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::pbr::{DistanceFog, FogFalloff};
use bevy::prelude::*;
use bevy::reflect::TypePath;
use bevy::render::render_resource::{AsBindGroup, Extent3d, ShaderType, TextureDimension, TextureFormat};
use bevy::shader::ShaderRef;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------- the bridge's queues

/// Commands waiting for the scene, and events waiting for the interface (web.rs and native.rs fill and drain them).
#[derive(Default)]
pub struct Queues {
    pub commands: VecDeque<Command>,
    pub events: Vec<Event>,
}
pub static QUEUES: Mutex<Option<Queues>> = Mutex::new(None);

pub fn push_command(c: Command) {
    QUEUES.lock().unwrap().get_or_insert_with(Default::default).commands.push_back(c);
}
pub fn take_events() -> Vec<Event> {
    std::mem::take(&mut QUEUES.lock().unwrap().get_or_insert_with(Default::default).events)
}
fn emit(e: Event) {
    let mut q = QUEUES.lock().unwrap();
    let q = q.get_or_insert_with(Default::default);
    // (an interface that is not reading must not make the scene grow without end)
    if q.events.len() > 4000 {
        q.events.drain(..2000);
    }
    q.events.push(e);
}
fn take_commands() -> Vec<Command> {
    QUEUES.lock().unwrap().get_or_insert_with(Default::default).commands.drain(..).collect()
}

// ---------------------------------------------------------------- resources

/// The data layer and the run being shown.
#[derive(Resource)]
pub struct Feed {
    pub source: Arc<dyn Source>,
    pub run: String,
    tx: crossbeam_channel::Sender<Resp>,
    rx: crossbeam_channel::Receiver<Resp>,
    status_wait: f32,
    world_asked: bool,
    /// The town is shown from an index still being made: asked again when it is done.
    partial: bool,
    partial_polls: u32,
}

impl Feed {
    pub fn new(source: Arc<dyn Source>, run: Option<String>) -> Feed {
        let (tx, rx) = crossbeam_channel::unbounded();
        Feed { source, run: run.unwrap_or_default(), tx, rx, status_wait: 0.0, world_asked: false, partial: false, partial_polls: 0 }
    }
    fn ask(&self, r: Req) {
        self.source.ask(&self.run, r, self.tx.clone());
    }
}

/// The moment shown and how fast it moves.
#[derive(Resource)]
pub struct Clock {
    pub t: f64,
    pub speed: f64,
    pub playing: bool,
    pub end: f64,
    /// A jump is pending (scrub, or the tracks for it were not there yet).
    pub seek: Option<i64>,
    last_sent: f64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Overlay {
    Town,
    Decided,
    Hardship,
    Compare,
}

/// The town being shown.
#[derive(Resource)]
pub struct Town {
    pub data: Arc<WorldData>,
    pub layout: Arc<Layout>,
    pub window: Days,
    pub crowd: Crowd,
    pulses: Vec<Pulse>,
    pulse_i: usize,
    act_i: usize,
    /// The overlays' data for one day at a time, from the data layer (never a whole year of a big town): who decided
    /// (counts by building and class over the 30 days to the day), and a day's row of agency or money.
    decided: Option<(i64, Vec<[u32; 5]>)>,
    agency: Option<(i64, Vec<i16>)>,
    money: Option<(i64, Vec<f64>)>,
    overlay_asked: Option<(Overlay, bool, i64)>,
    pub overlay: Overlay,
    focus: Option<String>,
    compare: Option<Vec<f32>>,
    overlay_dirty: bool,
    overlay_day: i64,
    /// The people's data texture, and a copy of its texels (x, y, z, size; r, g, b, glow per person).
    people_img: Handle<Image>,
    people_mat: Handle<PeopleMaterial>,
    texels: Vec<[f32; 4]>,
    person_color: Vec<Option<[f32; 3]>>,
    tiles: Vec<Tile>,
    /// Night: a pool of warm light round each building with people in it (one additive mesh; a quad per building).
    pools: Handle<Mesh>,
    pool_of: Vec<(usize, usize)>,
    pool_level: f32,
    wall_mat: Handle<StandardMaterial>,
    pub selected: Option<Sel>,
    pub selected_person: Option<u32>,
    follow: bool,
    born: f64,
    painted: bool,
    pub occupancy: Vec<u16>,
    labels: Vec<(String, Vec3)>,
}

/// A tile of merged building boxes, and where each structure's vertices are in it (for recolouring).
struct Tile {
    mesh: Handle<Mesh>,
    spans: Vec<(usize, usize, usize, usize)>, // (structure, first vertex, wall vertices, roof vertices)
}

#[derive(Resource, Default)]
struct Fx {
    rings: Vec<Ring>,
    arcs: Vec<ArcFx>,
    beacons: Vec<(Vec3, Color)>,
}
struct Ring {
    at: Vec3,
    color: Color,
    born: f64,
    life: f64,
    size: f32,
}
struct ArcFx {
    a: Vec3,
    b: Vec3,
    mid: Vec3,
    color: Color,
    born: f64,
    life: f64,
    keep: bool,
}

/// The camera's orbit, eased towards its goal each frame.
#[derive(Resource)]
pub struct Orbit {
    pub target: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    /// The orthographic view's height in world units.
    pub height: f32,
    goal_target: Vec3,
    goal_yaw: f32,
    goal_pitch: f32,
    goal_height: f32,
    drag: Option<(Vec2, bool, Vec2)>, // (start, rotating, last)
    moved: bool,
    hover_at: f64,
}

/// How far back the (orthographic) camera stands from the point it looks at.
const CAMERA_DISTANCE: f32 = 1000.0;

/// The true isometric elevation: 35.26 degrees above the ground (54.74 from straight down).
pub const ISO_PITCH: f32 = 0.6155;

impl Default for Orbit {
    fn default() -> Self {
        Orbit {
            target: Vec3::ZERO,
            yaw: std::f32::consts::FRAC_PI_4,
            pitch: ISO_PITCH,
            height: 80.0,
            goal_target: Vec3::ZERO,
            goal_yaw: std::f32::consts::FRAC_PI_4,
            goal_pitch: ISO_PITCH,
            goal_height: 80.0,
            drag: None,
            moved: true,
            hover_at: 0.0,
        }
    }
}

#[derive(Resource, Default)]
struct Perf {
    frames: VecDeque<f32>,
    on: bool,
    last: f64,
    update_ms: f32,
    started: Option<f64>,
}

/// A probe of memory held, given by the platform (the WebAssembly memory, or the process's).
#[derive(Resource, Clone, Copy)]
pub struct MemProbe(pub fn() -> u64);

#[derive(Component)]
struct Sun;
#[derive(Component)]
struct TownPart;

// ---------------------------------------------------------------- the people's material

#[derive(Clone, Copy, ShaderType, Debug, Default)]
pub struct PeopleParams {
    pub size: f32,
    pub night: f32,
    pub width: u32,
    pub pad: u32,
}

#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct PeopleMaterial {
    #[uniform(0)]
    pub params: PeopleParams,
    #[texture(1, sample_type = "float", filterable = false)]
    pub people: Handle<Image>,
}

impl Material for PeopleMaterial {
    fn vertex_shader() -> ShaderRef {
        ShaderRef::Path(bevy::asset::AssetPath::from_path_buf(bevy::asset::embedded_path!("people.wesl")).with_source("embedded"))
    }
    fn fragment_shader() -> ShaderRef {
        Self::vertex_shader()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Blend
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &bevy::pbr::MaterialPipeline,
        descriptor: &mut bevy::render::render_resource::RenderPipelineDescriptor,
        layout: &bevy::mesh::MeshVertexBufferLayoutRef,
        _key: bevy::pbr::MaterialPipelineKey<Self>,
    ) -> Result<(), bevy::render::render_resource::SpecializedMeshPipelineError> {
        let vertex_layout = layout.0.get_layout(&[Mesh::ATTRIBUTE_POSITION.at_shader_location(0)])?;
        descriptor.vertex.buffers = vec![vertex_layout];
        Ok(())
    }
}

/// Texels a row of the people's texture.
const TEX_W: u32 = 2048;

// ---------------------------------------------------------------- the plugin

pub struct TownPlugin;

impl Plugin for TownPlugin {
    fn build(&self, app: &mut App) {
        bevy::asset::embedded_asset!(app, "people.wesl");
        app.add_plugins(MaterialPlugin::<PeopleMaterial>::default())
            .insert_resource(Clock { t: 8.0 * 3600.0, speed: 3.0 * 3600.0, playing: false, end: f64::MAX, seek: None, last_sent: -1.0 })
            .insert_resource(Orbit::default())
            .insert_resource(Fx::default())
            .insert_resource(Perf::default())
            .insert_resource(ClearColor(Color::srgb(0.03, 0.05, 0.10)))
            .add_systems(Startup, setup)
            .add_systems(
                Update,
                (pump, commands, step_time, people, overlay, light, camera_input, camera_apply, pick, fx, labels, perf).chain(),
            );
    }
}

fn setup(mut commands: Commands, feed: ResMut<Feed>) {
    commands.spawn((
        Camera3d::default(),
        Projection::from(OrthographicProjection {
            scaling_mode: ScalingMode::FixedVertical { viewport_height: 80.0 },
            near: -4000.0,
            far: 4000.0,
            ..OrthographicProjection::default_3d()
        }),
        Transform::from_xyz(100.0, 100.0, 100.0).looking_at(Vec3::ZERO, Vec3::Y),
        DistanceFog { color: Color::srgba(0.6, 0.7, 0.85, 1.0), falloff: FogFalloff::Linear { start: 4000.0, end: 9000.0 }, ..default() },
        bevy::core_pipeline::tonemapping::Tonemapping::TonyMcMapface,
        bevy::post_process::bloom::Bloom { intensity: 0.12, ..bevy::post_process::bloom::Bloom::NATURAL },
        Msaa::Sample4,
    ));
    commands.spawn((
        Sun,
        DirectionalLight { illuminance: 9000.0, shadow_maps_enabled: true, ..default() },
        Transform::from_xyz(50.0, 100.0, 30.0).looking_at(Vec3::ZERO, Vec3::Y),
        // (the orthographic camera stands CAMERA_DISTANCE back: the shadows cover the depth the town is seen through)
        bevy::light::CascadeShadowConfigBuilder {
            num_cascades: 2,
            minimum_distance: CAMERA_DISTANCE - 600.0,
            first_cascade_far_bound: CAMERA_DISTANCE + 60.0,
            maximum_distance: CAMERA_DISTANCE + 600.0,
            overlap_proportion: 0.2,
        }
        .build(),
    ));
    commands.insert_resource(GlobalAmbientLight { color: Color::srgb(0.75, 0.82, 1.0), brightness: 400.0, ..default() });
    if !feed.run.is_empty() {
        feed.ask(Req::Status);
    }
}

// ---------------------------------------------------------------- the data layer's answers

#[allow(clippy::too_many_arguments)]
fn pump(
    mut commands: Commands,
    mut feed: ResMut<Feed>,
    town: Option<ResMut<Town>>,
    mut clock: ResMut<Clock>,
    mut orbit: ResMut<Orbit>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut pmats: ResMut<Assets<PeopleMaterial>>,
    mut images: ResMut<Assets<Image>>,
    time: Res<Time<Real>>,
    parts: Query<Entity, With<TownPart>>,
    windows: Query<&Window, With<bevy::window::PrimaryWindow>>,
    mut perf: ResMut<Perf>,
) {
    perf.started.get_or_insert(time.elapsed_secs_f64());
    let mut town = town;
    // (a run not indexed yet, or shown while it is: its status asked again every second or two)
    let msgs: Vec<Resp> = feed.rx.try_iter().collect();
    for m in msgs {
        match m {
            Resp::Status { state, message, header } => {
                if state == "ready" || state == "live" {
                    if !feed.world_asked || feed.partial {
                        // (first sight, or the index is done: the world again, the scene refreshed in place)
                        feed.world_asked = true;
                        feed.partial = false;
                        feed.ask(Req::World);
                    }
                } else if state == "failed" {
                    emit(Event::Error { message });
                } else {
                    if header && !feed.world_asked {
                        // the town at once, from what is read so far; the rest follows
                        feed.world_asked = true;
                        feed.partial = true;
                        feed.ask(Req::World);
                    } else if header && feed.partial {
                        if let Some(t) = town.as_mut() {
                            // what the moment needs, asked again as more of the log is read; the run's span every 10 s
                            if !t.window.ready(clock.t as i64) {
                                let (d, days) = (t.window.day_of(clock.t as i64), t.window.days);
                                t.window.forget_from(d, days);
                            }
                            feed.partial_polls += 1;
                            if feed.partial_polls.is_multiple_of(5) {
                                feed.ask(Req::World);
                            }
                        }
                    }
                    emit(Event::Waiting { message: format!("{state}: {message}") });
                    feed.status_wait = if feed.partial { 2.0 } else { 0.5 };
                }
            }
            Resp::World(json) => match WorldData::parse(&json) {
                // the same town, more of its log read: the data and the tracks' window refreshed, the meshes kept
                Ok(d)
                    if town
                        .as_ref()
                        .map(|t| {
                            t.data.meta.run_id == d.meta.run_id
                                && t.data.meta.persons == d.meta.persons
                                && t.data.world.structures.len() == d.world.structures.len()
                        })
                        .unwrap_or(false) =>
                {
                    let t = town.as_mut().unwrap();
                    let old_days = t.data.meta.days;
                    clock.end = (d.meta.last_t.max(d.meta.days * DAY)) as f64;
                    t.window.forget_from((old_days - 1).max(0), d.meta.days);
                    t.act_i = d.seat_acts.partition_point(|a| (a.t as f64) <= clock.t);
                    t.data = Arc::new(d);
                    clock.seek = Some(clock.t as i64);
                    feed.ask(Req::Bin("pulses"));
                    t.overlay_asked = None;
                    t.overlay_dirty = true;
                    emit(Event::Ready {
                        run: feed.run.clone(),
                        persons: t.data.meta.persons,
                        structures: t.data.structure_count(),
                        days: t.data.meta.days,
                        last_t: t.data.meta.last_t,
                        backend: feed.source.backend(),
                        first_paint_ms: -1.0,
                    });
                }
                Ok(d) => {
                    for e in &parts {
                        commands.entity(e).despawn();
                    }
                    let built = bevy::platform::time::Instant::now();
                    let t =
                        build_town(&mut commands, d, &mut meshes, &mut mats, &mut pmats, &mut images, &mut orbit, windows.iter().next());
                    emit(Event::Waiting { message: format!("town built in {} ms", built.elapsed().as_millis()) });
                    clock.end = (t.data.meta.last_t.max(t.data.meta.days * DAY)) as f64;
                    clock.t = clock.t.min(clock.end);
                    clock.seek = Some(clock.t as i64);
                    feed.ask(Req::Bin("pulses"));
                    let mut t = t;
                    t.born = time.elapsed_secs_f64();
                    commands.insert_resource(t);
                }
                Err(e) => emit(Event::Error { message: e }),
            },
            Resp::Track(n, b) => {
                if let Some(t) = town.as_mut() {
                    t.window.take(n, &b);
                    if let Need::Where { .. } = n {
                        t.overlay_dirty = true;
                    }
                }
            }
            Resp::Bin(name, b) => {
                if let (Some(t), "pulses") = (town.as_mut(), name) {
                    t.pulses = data::pulses(&b);
                    t.pulse_i = t.pulses.partition_point(|p| (p.t as f64) <= clock.t);
                }
            }
            Resp::DayRow(name, d, b) => {
                if let Some(t) = town.as_mut() {
                    match name {
                        "agency" => t.agency = Some((d, data::i16s(&b))),
                        "money" => t.money = Some((d, data::f64s(&b))),
                        _ => {}
                    }
                    t.overlay_dirty = true;
                }
            }
            Resp::Decided { to, counts, .. } => {
                if let Some(t) = town.as_mut() {
                    t.decided = Some((to, counts));
                    t.overlay_dirty = true;
                }
            }
            Resp::Failed(r, e) => {
                if r == Req::Status {
                    feed.status_wait = 2.0;
                }
                emit(Event::Error { message: format!("{r:?}: {e}") });
            }
        }
    }
    if (feed.partial || !feed.world_asked) && !feed.run.is_empty() {
        feed.status_wait -= time.delta_secs();
    }
    if (!feed.world_asked || feed.partial) && !feed.run.is_empty() && feed.status_wait <= 0.0 && feed.status_wait > -100.0 {
        feed.status_wait = 1e9; // (until the answer resets it)
        feed.ask(Req::Status);
    }
}

#[allow(clippy::too_many_arguments)]
fn build_town(
    commands: &mut Commands,
    d: WorldData,
    meshes: &mut Assets<Mesh>,
    mats: &mut Assets<StandardMaterial>,
    pmats: &mut Assets<PeopleMaterial>,
    images: &mut Assets<Image>,
    orbit: &mut Orbit,
    window: Option<&Window>,
) -> Town {
    let layout = Layout::new(&d);
    let (w, h) = (d.world.ground.w.max(1), d.world.ground.h.max(1));

    // ---- the ground, painted once
    let px = (4096 / w.max(h)).clamp(2, 8) as usize;
    let (tw, th) = (w as usize * px, h as usize * px);
    let mut img = vec![0u8; tw * th * 4];
    let mut fill = |x0: f32, y0: f32, x1: f32, y1: f32, c: [u8; 3], a: f32| {
        let (xa, ya) = ((x0 * px as f32).max(0.0) as usize, (y0 * px as f32).max(0.0) as usize);
        let (xb, yb) = (((x1 * px as f32) as usize).min(tw), ((y1 * px as f32) as usize).min(th));
        for y in ya..yb {
            for x in xa..xb {
                let k = (y * tw + x) * 4;
                for i in 0..3 {
                    img[k + i] = (img[k + i] as f32 * (1.0 - a) + c[i] as f32 * a) as u8;
                }
                img[k + 3] = 255;
            }
        }
    };
    fill(0.0, 0.0, w as f32, h as f32, layout::terrain_color("grassland"), 1.0);
    for t in &d.world.ground.terrain {
        fill(t.x as f32, t.y as f32, (t.x + t.w) as f32, (t.y + t.h) as f32, layout::terrain_color(&t.label), 1.0);
        if t.label == "farmland" {
            let mut yy = t.y as f32 + 0.25;
            while yy < (t.y + t.h) as f32 {
                fill(t.x as f32, yy, (t.x + t.w) as f32, yy + 0.08, [0x8a, 0x76, 0x40], 0.3);
                yy += 0.5;
            }
        }
    }
    for &(x, y) in &d.world.water {
        fill(x as f32, y as f32, x as f32 + 1.0, y as f32 + 1.0, layout::terrain_color("water"), 1.0);
    }
    for cells in &d.world.lot_cells {
        if cells.len() < 2 {
            continue;
        }
        let (mut x0, mut y0, mut x1, mut y1) = (i64::MAX, i64::MAX, i64::MIN, i64::MIN);
        for &(x, y) in cells {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        let (a, b, c, e) = (x0 as f32 + 0.04, y0 as f32 + 0.04, x1 as f32 + 0.96, y1 as f32 + 0.96);
        let line = 1.0 / px as f32;
        let col = [0x2a, 0x25, 0x1a];
        fill(a, b, c, b + line, col, 0.18);
        fill(a, e - line, c, e, col, 0.18);
        fill(a, b, a + line, e, col, 0.18);
        fill(c - line, b, c, e, col, 0.18);
    }
    for s in &d.world.structures {
        let (x0, y0, x1, y1) = (s.x as f32, s.y as f32, s.x as f32 + s.w as f32, s.y as f32 + s.h as f32);
        match s.type_.as_str() {
            "road" => {
                fill(x0, y0, x1, y1, [0x4b, 0x50, 0x5b], 1.0);
                fill(x0 + 0.47, y0 + 0.2, x0 + 0.53, y1 - 0.2, [0xff, 0xff, 0xff], 0.12);
            }
            "park" => fill(x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, [0x73, 0xc0, 0x62], 1.0),
            _ => fill(x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06, [0xd8, 0xcf, 0xbd], 1.0),
        }
    }
    let mut ground_img = Image::new(
        Extent3d { width: tw as u32, height: th as u32, depth_or_array_layers: 1 },
        TextureDimension::D2,
        img,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    ground_img.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor { anisotropy_clamp: 1, ..ImageSamplerDescriptor::linear() });
    let ground_tex = images.add(ground_img);
    let ground = Mesh::from(Plane3d::new(Vec3::Y, Vec2::new(w as f32 / 2.0, h as f32 / 2.0)));
    commands.spawn((
        TownPart,
        Mesh3d(meshes.add(ground)),
        MeshMaterial3d(mats.add(StandardMaterial {
            base_color_texture: Some(ground_tex),
            perceptual_roughness: 1.0,
            reflectance: 0.1,
            ..default()
        })),
        Transform::from_xyz(w as f32 / 2.0, 0.0, h as f32 / 2.0),
    ));
    // the slab the town stands on
    commands.spawn((
        TownPart,
        Mesh3d(meshes.add(Cuboid::new(w as f32 + 0.6, 3.0, h as f32 + 0.6))),
        MeshMaterial3d(mats.add(StandardMaterial { base_color: Color::srgb_u8(0x2a, 0x2f, 0x3d), perceptual_roughness: 1.0, ..default() })),
        Transform::from_xyz(w as f32 / 2.0, -1.52, h as f32 / 2.0),
        NotShadowCaster,
    ));

    // ---- buildings, merged by tile
    let window_tex = images.add(window_texture());
    let wall_mat = mats.add(StandardMaterial {
        base_color: Color::WHITE,
        perceptual_roughness: 0.85,
        reflectance: 0.2,
        emissive: LinearRgba::BLACK,
        emissive_texture: Some(window_tex),
        ..default()
    });
    const TILE: i64 = 24;
    let mut by_tile: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, s) in d.world.structures.iter().enumerate() {
        if !layout::is_flat(&s.type_) {
            by_tile.entry((s.x.div_euclid(TILE), s.y.div_euclid(TILE))).or_default().push(i);
        }
    }
    let mut keys: Vec<_> = by_tile.keys().copied().collect();
    keys.sort();
    let mut tiles = vec![];
    for k in keys {
        let list = &by_tile[&k];
        let mut mb = MeshBuf::default();
        let mut spans = vec![];
        for &i in list {
            let s = &d.world.structures[i];
            let Some(p) = layout.placed[i] else { continue };
            let (wall, roof) = layout::category_colors(&s.category);
            let first = mb.pos.len();
            mb.walls(p, lin(wall));
            let nw = mb.pos.len() - first;
            mb.boxed(Vec3::new(p.cx, p.h + 0.04, p.cz), Vec3::new(p.fw + 0.08, 0.08, p.fd + 0.08), lin(roof));
            spans.push((i, first, nw, mb.pos.len() - first - nw));
        }
        let mesh = meshes.add(mb.mesh());
        commands.spawn((TownPart, Mesh3d(mesh.clone()), MeshMaterial3d(wall_mat.clone())));
        tiles.push(Tile { mesh, spans });
    }

    // ---- pools of light at night, a soft quad on the ground round each building (lit by the people inside)
    let mut pb = MeshBuf::default();
    let mut pool_of = vec![];
    for (i, p) in layout.placed.iter().enumerate() {
        let Some(p) = p.filter(|p| !p.flat) else { continue };
        let r = p.fw.max(p.fd) * 1.6 + 0.8;
        let c = Vec3::new(p.cx, 0.03, p.cz);
        pool_of.push((i, pb.pos.len()));
        pb.quad(
            [c + Vec3::new(-r, 0.0, r), c + Vec3::new(r, 0.0, r), c + Vec3::new(r, 0.0, -r), c + Vec3::new(-r, 0.0, -r)],
            Vec3::Y,
            [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            [0.0, 0.0, 0.0],
        );
    }
    let pools = meshes.add(pb.mesh());
    let glow = images.add(glow_texture());
    commands.spawn((
        TownPart,
        Mesh3d(pools.clone()),
        MeshMaterial3d(mats.add(StandardMaterial { base_color: Color::WHITE, base_color_texture: Some(glow), unlit: true, alpha_mode: AlphaMode::Add, ..default() })),
        NotShadowCaster,
        bevy::light::NotShadowReceiver,
    ));

    // ---- trees on woodland and scrub, and in parks
    let built: std::collections::HashSet<(i64, i64)> = d.world.structures.iter().map(|s| (s.x, s.y)).collect();
    let mut trees: HashMap<(i64, i64), MeshBuf> = HashMap::new();
    let mut seed = 1u32;
    let mut rnd = || {
        seed = seed.wrapping_add(1);
        hash01(seed)
    };
    let mut count = 0;
    let mut spots = vec![];
    for t in &d.world.ground.terrain {
        let p = match t.label.as_str() {
            "woodland" => 0.55,
            "scrub" => 0.12,
            _ => continue,
        };
        for y in t.y..t.y + t.h {
            for x in t.x..t.x + t.w {
                if !built.contains(&(x, y)) && rnd() < p {
                    spots.push((x as f32 + 0.2 + rnd() * 0.6, y as f32 + 0.2 + rnd() * 0.6));
                }
            }
        }
    }
    for s in d.world.structures.iter().filter(|s| s.type_ == "park") {
        for _ in 0..3 {
            spots.push((s.x as f32 + 0.2 + rnd() * 0.6, s.y as f32 + 0.2 + rnd() * 0.6));
        }
    }
    for (x, z) in spots {
        if count >= 40_000 {
            break;
        }
        count += 1;
        let sc = 0.7 + rnd() * 0.6;
        let g = 0.26 + rnd() * 0.08;
        let c = Color::hsl((0.27 + rnd() * 0.06) * 360.0, 0.38, g).to_linear();
        trees.entry(((x as i64).div_euclid(TILE), (z as i64).div_euclid(TILE))).or_default().tree(
            Vec3::new(x, 0.0, z),
            sc,
            [c.red, c.green, c.blue],
        );
    }
    let tree_mat = mats.add(StandardMaterial { base_color: Color::WHITE, perceptual_roughness: 0.9, ..default() });
    for (_, mb) in trees {
        commands.spawn((TownPart, Mesh3d(meshes.add(mb.mesh())), MeshMaterial3d(tree_mat.clone())));
    }

    // ---- the way out of town: where the outside world's offices act from
    let gate = layout.gate;
    commands.spawn((
        TownPart,
        Mesh3d(meshes.add(Cylinder::new(1.5, 0.4))),
        MeshMaterial3d(mats.add(StandardMaterial { base_color: Color::srgb_u8(0x2b, 0x33, 0x50), ..default() })),
        Transform::from_xyz(gate.0, -0.1, gate.1),
    ));
    commands.spawn((
        TownPart,
        Mesh3d(meshes.add(Cylinder::new(0.9, 6.0))),
        MeshMaterial3d(mats.add(StandardMaterial {
            base_color: Color::srgba(0.48, 0.64, 1.0, 0.18),
            emissive: LinearRgba::rgb(0.2, 0.3, 0.9),
            alpha_mode: AlphaMode::Add,
            unlit: true,
            ..default()
        })),
        Transform::from_xyz(gate.0, 3.0, gate.1),
        NotShadowCaster,
    ));

    // ---- people: one quad each, drawn from a data texture
    let n = d.meta.persons.max(1);
    let rows = ((2 * n) as u32).div_ceil(TEX_W).max(1);
    let texels = vec![[0.0f32; 4]; (TEX_W * rows) as usize];
    let people_img = images.add(people_image(&texels, rows));
    let people_mat =
        pmats.add(PeopleMaterial { params: PeopleParams { size: 0.11, night: 0.0, width: TEX_W, pad: 0 }, people: people_img.clone() });
    let mut pos = Vec::with_capacity(n * 4);
    let mut idx = Vec::with_capacity(n * 6);
    for i in 0..n {
        let f = i as f32;
        pos.extend_from_slice(&[[-1.0, -1.0, f], [1.0, -1.0, f], [1.0, 1.0, f], [-1.0, 1.0, f]]);
        let b = (i * 4) as u32;
        idx.extend_from_slice(&[b, b + 1, b + 2, b, b + 2, b + 3]);
    }
    let mut pm = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD);
    pm.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
    pm.insert_indices(Indices::U32(idx));
    commands.spawn((TownPart, Mesh3d(meshes.add(pm)), MeshMaterial3d(people_mat.clone()), NoFrustumCulling, NotShadowCaster));

    // ---- the view: the built town in the middle
    let (x0, z0, x1, z1) = layout.built_bounds(&d).unwrap_or((0.0, 0.0, w as f32, h as f32));
    let aspect = window.map(|w| w.width() / w.height().max(1.0)).unwrap_or(1.6);
    orbit.goal_target = Vec3::new((x0 + x1) / 2.0, 0.0, (z0 + z1) / 2.0);
    orbit.target = orbit.goal_target;
    // (seen at 45 degrees round, the town's diagonal runs across the view and its depth is foreshortened by the pitch)
    let ext = (x1 - x0).max(z1 - z0);
    orbit.goal_height = (ext * 1.42 * ISO_PITCH.sin() * 1.12).max(ext * 1.42 * 1.08 / aspect).max(10.0);
    orbit.height = orbit.goal_height * 1.3;
    orbit.moved = true;

    // labels: offices that matter, and the seats' offices
    let important = [
        "government",
        "tribunal",
        "bank",
        "police",
        "health_service",
        "school",
        "registry",
        "ombudsman",
        "consumer_desk",
        "electoral_commission",
        "union",
        "builder",
        "utility",
        "land_registry",
    ];
    let seat_orgs: std::collections::HashSet<&str> = d
        .world
        .posts
        .iter()
        .filter(|p| p.holder.as_deref().map(|h| d.meta.seats.iter().any(|s| s == h)).unwrap_or(false))
        .filter_map(|p| p.entity.as_deref())
        .collect();
    let mut labels = vec![];
    let mut seen = std::collections::HashSet::new();
    for o in &d.world.orgs {
        if !seat_orgs.contains(o.id.as_str()) && !important.contains(&o.kind.as_str()) {
            continue;
        }
        let st = o.premises.first().copied().unwrap_or(-1);
        if !seen.insert(st) {
            continue;
        }
        let (x, y, z) = layout.pos_of(st);
        labels.push((format!("org:{}", o.id), Vec3::new(x, if st < 0 { 7.5 } else { y + 0.6 }, z)));
    }
    labels.push(("gate".into(), Vec3::new(gate.0, 6.2, gate.1)));

    let s = d.structure_count();
    let persons = d.meta.persons;
    let days = d.meta.days;
    Town {
        layout: Arc::new(layout),
        window: Days::new(persons, days),
        crowd: Crowd::new(persons),
        pulses: vec![],
        pulse_i: 0,
        act_i: 0,
        decided: None,
        agency: None,
        money: None,
        overlay_asked: None,
        overlay: Overlay::Town,
        focus: None,
        compare: None,
        overlay_dirty: true,
        overlay_day: -1,
        people_img,
        people_mat,
        texels,
        person_color: vec![None; persons],
        tiles,
        pools,
        pool_of,
        pool_level: -1.0,
        wall_mat,
        selected: None,
        selected_person: None,
        follow: false,
        born: 0.0,
        painted: false,
        occupancy: vec![0; s],
        labels,
        data: Arc::new(d),
    }
}

fn people_image(texels: &[[f32; 4]], rows: u32) -> Image {
    let bytes: Vec<u8> = texels.iter().flat_map(|t| t.iter().flat_map(|v| v.to_le_bytes())).collect();
    let mut img = Image::new(
        Extent3d { width: TEX_W, height: rows, depth_or_array_layers: 1 },
        TextureDimension::D2,
        bytes,
        TextureFormat::Rgba32Float,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
    );
    img.sampler = ImageSampler::nearest();
    img
}

/// A soft round glow, white at the centre and gone at the edge (the pools of light; coloured by the vertices).
fn glow_texture() -> Image {
    let n = 64usize;
    let mut b = vec![0u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let d = (((x as f32 + 0.5) / n as f32 - 0.5).powi(2) + ((y as f32 + 0.5) / n as f32 - 0.5).powi(2)).sqrt() * 2.0;
            let v = ((1.0 - d).max(0.0).powf(1.8) * 255.0) as u8;
            b[(y * n + x) * 4..(y * n + x) * 4 + 4].copy_from_slice(&[v, v, v, 255]);
        }
    }
    Image::new(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 }, TextureDimension::D2, b, TextureFormat::Rgba8Unorm, RenderAssetUsages::RENDER_WORLD)
}

/// Windows: a four-by-four of panes, most lit, a few dark, on black (the frame, which the roofs sample).
fn window_texture() -> Image {
    let n = 64usize;
    let mut b = vec![0u8; n * n * 4];
    for k in 0..n * n {
        b[k * 4 + 3] = 255;
    }
    for wy in 0..4 {
        for wx in 0..4 {
            let lit = hash01((wy * 4 + wx) as u32 * 31 + 7) < 0.72;
            let c: [u8; 3] = if lit { [0xff, 0xcf, 0x7a] } else { [0x2a, 0x1e, 0x0c] };
            for y in (wy * 16 + 5)..(wy * 16 + 13) {
                for x in (wx * 16 + 5)..(wx * 16 + 11) {
                    let k = (y * n + x) * 4;
                    b[k..k + 3].copy_from_slice(&c);
                }
            }
        }
    }
    let mut img = Image::new(
        Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 },
        TextureDimension::D2,
        b,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    img.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        ..ImageSamplerDescriptor::linear()
    });
    img
}

/// Merged geometry: positions, normals, uvs, colours.
#[derive(Default)]
struct MeshBuf {
    pos: Vec<[f32; 3]>,
    nor: Vec<[f32; 3]>,
    uv: Vec<[f32; 2]>,
    col: Vec<[f32; 4]>,
    idx: Vec<u32>,
}

impl MeshBuf {
    fn quad(&mut self, c: [Vec3; 4], n: Vec3, uv: [[f32; 2]; 4], col: [f32; 3]) {
        let b = self.pos.len() as u32;
        for i in 0..4 {
            self.pos.push(c[i].to_array());
            self.nor.push(n.to_array());
            self.uv.push(uv[i]);
            self.col.push([col[0], col[1], col[2], 1.0]);
        }
        self.idx.extend_from_slice(&[b, b + 1, b + 2, b, b + 2, b + 3]);
    }
    /// A building's four walls, with window UVs: one pane per level up, one every 0.7 cells along (the texture
    /// repeats four by four).
    fn walls(&mut self, p: layout::Placed, col: [f32; 3]) {
        let (hx, hz, h) = (p.fw / 2.0, p.fd / 2.0, p.h);
        let c = Vec3::new(p.cx, 0.0, p.cz);
        let v = h / LEVEL / 4.0;
        let (ux, uz) = (p.fw / 0.7 / 4.0, p.fd / 0.7 / 4.0);
        let o = hash01((p.cx * 31.0 + p.cz * 7.0) as u32) * 4.0; // (so neighbours' windows differ)
        let faces = [
            (Vec3::Z, [Vec3::new(-hx, 0.0, hz), Vec3::new(hx, 0.0, hz), Vec3::new(hx, h, hz), Vec3::new(-hx, h, hz)], ux),
            (Vec3::NEG_Z, [Vec3::new(hx, 0.0, -hz), Vec3::new(-hx, 0.0, -hz), Vec3::new(-hx, h, -hz), Vec3::new(hx, h, -hz)], ux),
            (Vec3::X, [Vec3::new(hx, 0.0, hz), Vec3::new(hx, 0.0, -hz), Vec3::new(hx, h, -hz), Vec3::new(hx, h, hz)], uz),
            (Vec3::NEG_X, [Vec3::new(-hx, 0.0, -hz), Vec3::new(-hx, 0.0, hz), Vec3::new(-hx, h, hz), Vec3::new(-hx, h, -hz)], uz),
        ];
        for (k, (n, q, u)) in faces.into_iter().enumerate() {
            let u0 = o + k as f32 * 0.25;
            self.quad([c + q[0], c + q[1], c + q[2], c + q[3]], n, [[u0, v], [u0 + u, v], [u0 + u, 0.0], [u0, 0.0]], col);
        }
    }
    /// A box (the roof's slab): all six faces, UVs on the window texture's black frame (so it never glows).
    fn boxed(&mut self, c: Vec3, size: Vec3, col: [f32; 3]) {
        let (x, y, z) = (size.x / 2.0, size.y / 2.0, size.z / 2.0);
        let uv = [[0.01, 0.01]; 4];
        let f = |a: Vec3, b: Vec3, cc: Vec3, d: Vec3| [c + a, c + b, c + cc, c + d];
        self.quad(f(Vec3::new(-x, y, z), Vec3::new(x, y, z), Vec3::new(x, y, -z), Vec3::new(-x, y, -z)), Vec3::Y, uv, col);
        self.quad(f(Vec3::new(-x, -y, z), Vec3::new(x, -y, z), Vec3::new(x, y, z), Vec3::new(-x, y, z)), Vec3::Z, uv, col);
        self.quad(f(Vec3::new(x, -y, -z), Vec3::new(-x, -y, -z), Vec3::new(-x, y, -z), Vec3::new(x, y, -z)), Vec3::NEG_Z, uv, col);
        self.quad(f(Vec3::new(x, -y, z), Vec3::new(x, -y, -z), Vec3::new(x, y, -z), Vec3::new(x, y, z)), Vec3::X, uv, col);
        self.quad(f(Vec3::new(-x, -y, -z), Vec3::new(-x, -y, z), Vec3::new(-x, y, z), Vec3::new(-x, y, -z)), Vec3::NEG_X, uv, col);
    }
    /// A tree: a six-sided cone on a short trunk, flat-shaded.
    fn tree(&mut self, at: Vec3, sc: f32, col: [f32; 3]) {
        let (r, h, base) = (0.26 * sc, 0.75 * sc, 0.08 * sc);
        let top = at + Vec3::Y * (base + h);
        for k in 0..6 {
            let a0 = k as f32 / 6.0 * std::f32::consts::TAU;
            let a1 = (k + 1) as f32 / 6.0 * std::f32::consts::TAU;
            let p0 = at + Vec3::new(a0.cos() * r, base, a0.sin() * r);
            let p1 = at + Vec3::new(a1.cos() * r, base, a1.sin() * r);
            let n = (p1 - p0).cross(top - p0).normalize_or_zero();
            let n = if n.y < 0.0 { -n } else { n };
            let b = self.pos.len() as u32;
            for p in [p0, top, p1] {
                self.pos.push(p.to_array());
                self.nor.push(n.to_array());
                self.uv.push([0.01, 0.01]);
                self.col.push([col[0], col[1], col[2], 1.0]);
            }
            self.idx.extend_from_slice(&[b, b + 1, b + 2]);
        }
        let tc = [0.22, 0.14, 0.08];
        self.quad(
            [
                at + Vec3::new(-0.03, 0.0, 0.0),
                at + Vec3::new(0.03, 0.0, 0.0),
                at + Vec3::new(0.03, base, 0.0),
                at + Vec3::new(-0.03, base, 0.0),
            ],
            Vec3::Z,
            [[0.01, 0.01]; 4],
            tc,
        );
    }
    fn mesh(self) -> Mesh {
        let mut m = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD);
        m.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.pos);
        m.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor);
        m.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uv);
        m.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.col);
        m.insert_indices(Indices::U32(self.idx));
        m
    }
}

// ---------------------------------------------------------------- commands from the interface

#[allow(clippy::too_many_arguments)]
fn commands(
    mut feed: ResMut<Feed>,
    mut clock: ResMut<Clock>,
    town: Option<ResMut<Town>>,
    mut orbit: ResMut<Orbit>,
    mut fx: ResMut<Fx>,
    mut perf: ResMut<Perf>,
    time: Res<Time<Real>>,
) {
    let mut town = town;
    for c in take_commands() {
        match c {
            Command::LoadRun { id } => {
                feed.run = id;
                feed.world_asked = false;
                feed.status_wait = 0.0;
                feed.ask(Req::Status);
            }
            Command::SetTime { t } => {
                // (before the run is loaded its end is not known: the moment is kept as asked)
                clock.t = (t as f64).clamp(0.0, clock.end);
                clock.seek = Some(clock.t as i64);
            }
            Command::SetSpeed { x } => clock.speed = x.clamp(1.0, 400.0 * DAY as f64),
            Command::Play { on } => {
                if on && clock.t >= clock.end {
                    clock.t = 0.0;
                    clock.seek = Some(0);
                }
                clock.playing = on;
            }
            Command::SetOverlay { name, focus } => {
                if let Some(t) = town.as_mut() {
                    t.overlay = match name.as_str() {
                        "decided" => Overlay::Decided,
                        "hardship" => Overlay::Hardship,
                        "compare" => Overlay::Compare,
                        _ => Overlay::Town,
                    };
                    t.focus = focus;
                    t.overlay_dirty = true;
                }
            }
            Command::CompareValues { values, .. } => {
                if let Some(t) = town.as_mut() {
                    t.compare = Some(values);
                    t.overlay_dirty = true;
                }
            }
            Command::Select { id, fly } => {
                let Some(t) = town.as_mut() else { continue };
                let sel = Sel::parse(&id);
                t.selected_person = None;
                t.follow = false;
                if let Some(s) = &sel {
                    let goal = match s.kind.as_str() {
                        "person" => {
                            let p = t.data.persons.iter().position(|x| *x == s.id).map(|p| p as u32);
                            t.selected_person = p;
                            p.and_then(|p| t.crowd.pos(&t.layout, p, 0)).map(|(v, _)| (Vec3::from(v), 14.0))
                        }
                        "building" => s.id.parse::<i64>().ok().map(|b| (Vec3::from(t.layout.pos_of(b)), 20.0)),
                        "org" => t
                            .data
                            .world
                            .orgs
                            .iter()
                            .find(|o| o.id == s.id)
                            .map(|o| (Vec3::from(t.layout.pos_of(o.premises.first().copied().unwrap_or(-1))), 30.0)),
                        "act" => s.id.parse::<u32>().ok().and_then(|o| t.data.seat_acts.iter().find(|a| a.ord == o)).map(|a| {
                            let st = a.targets.iter().find(|x| x.st >= 0).map(|x| x.st).unwrap_or(a.from);
                            (Vec3::from(t.layout.pos_of(st)), 40.0)
                        }),
                        _ => None,
                    };
                    if let (true, Some((p, h))) = (fly, goal) {
                        orbit.goal_target = Vec3::new(p.x, 0.0, p.z);
                        orbit.goal_height = orbit.goal_height.min(h);
                    }
                }
                emit(Event::Selected { id: sel.as_ref().map(|s| s.key()).unwrap_or_default() });
                t.selected = sel;
                t.crowd.all_dirty = true;
            }
            Command::Camera(cc) => match cc {
                CameraCmd::Turn { quarter } => orbit.goal_yaw += quarter as f32 * std::f32::consts::FRAC_PI_2,
                CameraCmd::Iso => {
                    orbit.goal_pitch = ISO_PITCH;
                    orbit.goal_yaw =
                        (orbit.goal_yaw / std::f32::consts::FRAC_PI_2).floor() * std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_4;
                }
                CameraCmd::Frame => {
                    if let Some(t) = town.as_ref() {
                        if let Some((x0, z0, x1, z1)) = t.layout.built_bounds(&t.data) {
                            orbit.goal_target = Vec3::new((x0 + x1) / 2.0, 0.0, (z0 + z1) / 2.0);
                            orbit.goal_height = (x1 - x0).max(z1 - z0) * 0.8;
                        }
                    }
                }
                CameraCmd::Zoom { factor } => orbit.goal_height = (orbit.goal_height / factor.max(0.01)).clamp(2.0, 3000.0),
                CameraCmd::Pan { dx, dz } => {
                    let (s, c) = orbit.yaw.sin_cos();
                    let h = orbit.height;
                    orbit.goal_target += Vec3::new(c * dx - s * dz, 0.0, -s * dx - c * dz) * h;
                }
                CameraCmd::Follow { on } => {
                    if let Some(t) = town.as_mut() {
                        t.follow = on && t.selected_person.is_some();
                    }
                }
                CameraCmd::Tilt { degrees } => orbit.goal_pitch = degrees.clamp(12.0, 89.0).to_radians(),
            },
            Command::Beacons { structs, color } => {
                let col = Srgba::hex(color.trim_start_matches('#')).map(Color::from).unwrap_or(Color::WHITE);
                fx.beacons.clear();
                if let Some(t) = town.as_ref() {
                    for s in structs {
                        let (x, y, z) = t.layout.pos_of(s);
                        fx.beacons.push((Vec3::new(x, y, z), col));
                    }
                }
            }
            Command::ShowAct { ord } => {
                let Some(t) = town.as_ref() else { continue };
                fx.arcs.iter_mut().filter(|a| a.keep).for_each(|a| a.keep = false);
                if let Some(a) = t.data.seat_acts.iter().find(|a| a.ord == ord) {
                    let col = seat_color(&t.data, &a.participant);
                    act_arcs(&mut fx, t, a, col, true, time.elapsed_secs_f64());
                }
            }
            Command::ClearAct => fx.arcs.iter_mut().filter(|a| a.keep).for_each(|a| {
                a.keep = false;
                a.life = 0.0;
            }),
            Command::Stats { on } => perf.on = on,
        }
    }
}

fn seat_color(d: &WorldData, participant: &str) -> Color {
    let c = d.seat_index(participant).map(|i| overlays::SEAT_COLORS[i % 6]).unwrap_or(overlays::CLASS_COLOR[3]);
    Color::srgb_u8(c[0], c[1], c[2])
}

fn act_arcs(fx: &mut Fx, t: &Town, a: &data::SeatAct, col: Color, keep: bool, now: f64) {
    let (ax, ay, az) = t.layout.pos_of(a.from);
    let from = Vec3::new(ax, ay, az);
    let mut n = 0;
    for tg in a.targets.iter().filter(|x| x.st >= 0 || x.kind == "org") {
        if n >= if keep { 24 } else { 12 } {
            break;
        }
        n += 1;
        let (bx, by, bz) = t.layout.pos_of(tg.st);
        let to = Vec3::new(bx, by, bz);
        if from.distance(to) < 0.01 {
            fx.rings.push(Ring { at: to, color: col, born: now, life: 2.2, size: 1.6 });
            continue;
        }
        let mut mid = (from + to) * 0.5;
        mid.y = from.y.max(to.y) + 2.0 + from.distance(to) * 0.35;
        fx.arcs.push(ArcFx { a: from, b: to, mid, color: col, born: now, life: 4.2, keep });
    }
    if n == 0 {
        fx.rings.push(Ring { at: from, color: col, born: now, life: 2.6, size: 2.0 });
    }
}

// ---------------------------------------------------------------- time

fn step_time(
    mut clock: ResMut<Clock>,
    town: Option<ResMut<Town>>,
    feed: Res<Feed>,
    time: Res<Time<Real>>,
    mut fx: ResMut<Fx>,
    perf: Res<Perf>,
) {
    let Some(mut town) = town else { return };
    let perf_start = perf.started.unwrap_or(0.0);
    let town = &mut *town;
    let now = time.elapsed_secs_f64();
    let dt = time.delta_secs_f64().min(0.1);
    let t0 = clock.t;
    if clock.playing && clock.seek.is_none() {
        clock.t = (clock.t + dt * clock.speed).min(clock.end);
        if clock.t >= clock.end {
            clock.playing = false;
        }
    }
    // ask for what the moment needs, and let go of what is far behind
    for n in town.window.wants(clock.t as i64) {
        feed.ask(Req::Track(n));
    }
    let vis = (clock.speed * 0.6) as i64; // (a hop is on screen for at least 0.6 s)
    if let Some(s) = clock.seek {
        if town.crowd.seek(&town.window, &town.layout, s) {
            clock.seek = None;
            town.pulse_i = town.pulses.partition_point(|p| p.t <= s);
            town.act_i = town.data.seat_acts.partition_point(|a| a.t <= s);
            town.overlay_dirty = true;
            if !town.painted {
                town.painted = true;
                let started = perf_start;
                emit(Event::Ready {
                    run: feed.run.clone(),
                    persons: town.data.meta.persons,
                    structures: town.data.structure_count(),
                    days: town.data.meta.days,
                    last_t: town.data.meta.last_t,
                    backend: feed.source.backend(),
                    first_paint_ms: ((now - started) * 1000.0).round(),
                });
            }
        }
    } else {
        let ok = town.crowd.advance(&town.window, &town.layout, clock.t as i64, vis);
        if !ok && clock.playing {
            // (the moves are not here yet: hold the moment until they are)
            clock.t = clock.t.min(town.crowd.t as f64 + dt * clock.speed);
        }
        town.crowd.settle(vis);
        // changes landing: rings; seats' acts: arcs
        let t = clock.t as i64;
        let mut spawned = 0;
        let focus = if town.overlay == Overlay::Decided {
            town.focus.as_deref().and_then(|f| data::CLASSES.iter().position(|c| *c == f))
        } else {
            None
        };
        while town.pulse_i < town.pulses.len() && town.pulses[town.pulse_i].t <= t {
            let p = town.pulses[town.pulse_i];
            town.pulse_i += 1;
            if p.cls == 0 && !p.hard() {
                continue;
            }
            spawned += 1;
            if (spawned > 50 && p.flags & 3 == 0) || focus.map(|f| f != p.cls as usize).unwrap_or(false) || fx.rings.len() > 900 {
                continue;
            }
            let (x, y, z) = town.layout.pos_of(p.st as i64);
            if p.st < 0 {
                continue;
            }
            let c = if p.hard() { overlays::HARD_COLOR } else { overlays::CLASS_COLOR[p.cls as usize] };
            fx.rings.push(Ring {
                at: Vec3::new(x, y + 0.05, z),
                color: Color::srgb_u8(c[0], c[1], c[2]),
                born: now,
                life: if p.hard() { 2.2 } else { 1.3 },
                size: if p.hard() { 1.5 } else { 0.9 },
            });
        }
        while town.act_i < town.data.seat_acts.len() && town.data.seat_acts[town.act_i].t <= t {
            let a = town.data.seat_acts[town.act_i].clone();
            town.act_i += 1;
            if (a.t as f64) > t0 {
                let col = seat_color(&town.data, &a.participant);
                act_arcs(&mut fx, town, &a, col, false, now);
                emit(Event::SeatAct { ord: a.ord });
            }
        }
        if (t0 / DAY as f64).floor() != (clock.t / DAY as f64).floor() {
            town.overlay_dirty = true;
        }
    }
    town.window.evict(clock.t as i64);
    if (clock.t - clock.last_sent).abs() > 1.0 || clock.is_changed() {
        clock.last_sent = clock.t;
        emit(Event::TimeChanged { t: clock.t as i64, playing: clock.playing, speed: clock.speed });
    }
}

// ---------------------------------------------------------------- people

fn people(
    clock: Res<Clock>,
    town: Option<ResMut<Town>>,
    mut images: ResMut<Assets<Image>>,
    mut pmats: ResMut<Assets<PeopleMaterial>>,
    orbit: Res<Orbit>,
    mut perf: ResMut<Perf>,
) {
    let Some(mut town) = town else { return };
    let started = bevy::platform::time::Instant::now();
    let town = &mut *town;
    let vis = (clock.speed * 0.6) as i64;
    let n = town.data.meta.persons;
    let mut changed = false;
    let update = |town: &mut Town, p: u32| {
        let i = p as usize;
        if i >= n {
            return;
        }
        let sel = town.selected_person == Some(p);
        match town.crowd.pos(&town.layout, p, vis) {
            Some((v, moving)) => {
                let kind = if moving {
                    2
                } else {
                    town.crowd.cur[i].checked_sub(1).and_then(|s| town.layout.space_kind.get(s as usize)).copied().unwrap_or(2) as usize
                };
                let c = if sel { [1.0, 1.0, 1.0] } else { town.person_color[i].unwrap_or_else(|| lin(overlays::KIND_COLOR[kind.min(2)])) };
                town.texels[2 * i] = [
                    v[0],
                    v[1],
                    v[2],
                    if sel {
                        2.6
                    } else if moving {
                        0.9
                    } else {
                        1.0
                    },
                ];
                town.texels[2 * i + 1] = [c[0], c[1], c[2], if moving { 0.6 } else { 1.0 }];
            }
            None => town.texels[2 * i][3] = 0.0,
        }
    };
    if town.crowd.all_dirty {
        town.crowd.all_dirty = false;
        town.crowd.dirty.clear();
        for p in 0..n as u32 {
            update(town, p);
        }
        changed = true;
    } else {
        let dirty = std::mem::take(&mut town.crowd.dirty);
        changed |= !dirty.is_empty();
        for p in dirty {
            update(town, p);
        }
    }
    let moving: Vec<u32> = town.crowd.trips.keys().copied().collect();
    changed |= !moving.is_empty();
    for p in moving {
        update(town, p);
    }
    if let Some(p) = town.selected_person {
        update(town, p);
        if town.follow {
            if let Some((v, _)) = town.crowd.pos(&town.layout, p, vis) {
                let _ = v; // (followed in camera_apply)
            }
        }
    }
    if changed {
        if let Some(mut img) = images.get_mut(&town.people_img) {
            let bytes: &[u8] = bytemuck_cast(&town.texels);
            img.data = Some(bytes.to_vec());
        }
    }
    // occupancy, for the hover and the night's glow
    if changed {
        town.occupancy.iter_mut().for_each(|x| *x = 0);
        for &s1 in &town.crowd.cur {
            if let Some(st) = town.layout.struct_of_space(s1) {
                if let Some(o) = town.occupancy.get_mut(st) {
                    *o = o.saturating_add(1);
                }
            }
        }
    }
    if let Some(mut m) = pmats.get_mut(&town.people_mat) {
        // people stay a few pixels across whatever the zoom
        m.params.size = (orbit.height / 320.0).clamp(0.05, 1.2);
    }
    perf.update_ms = started.elapsed().as_secs_f32() * 1000.0;
}

fn bytemuck_cast(v: &[[f32; 4]]) -> &[u8] {
    // SAFETY: [f32; 4] is plain old data with no padding; the slice's bytes are its texels in order.
    unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, std::mem::size_of_val(v)) }
}

// ---------------------------------------------------------------- overlays

fn overlay(clock: Res<Clock>, town: Option<ResMut<Town>>, mut meshes: ResMut<Assets<Mesh>>, feed: Res<Feed>) {
    let Some(mut town) = town else { return };
    let town = &mut *town;
    let d = (clock.t as i64).div_euclid(DAY).clamp(0, town.data.meta.days);
    // the day's data for the overlay shown, asked once (the scene keeps the last day's colours until it comes)
    let money = town.focus.as_deref() == Some("money");
    let have = match town.overlay {
        Overlay::Decided => town.decided.as_ref().map(|x| x.0) == Some(d),
        Overlay::Hardship if money => town.money.as_ref().map(|x| x.0) == Some(d),
        Overlay::Hardship => town.agency.as_ref().map(|x| x.0) == Some(d),
        _ => true,
    };
    let key = (town.overlay, money, d);
    if !have && town.overlay_asked != Some(key) {
        town.overlay_asked = Some(key);
        match town.overlay {
            Overlay::Decided => feed.ask(Req::Decided { from: (d - 29).max(0), to: d }),
            Overlay::Hardship => feed.ask(Req::DayRow(if money { "money" } else { "agency" }, d)),
            _ => {}
        }
    }
    if !town.overlay_dirty && town.overlay_day == d {
        return;
    }
    town.overlay_dirty = false;
    town.overlay_day = d;
    let s = town.data.structure_count();
    let persons = town.data.meta.persons;
    let (buildings, people): (Vec<Option<[f32; 3]>>, Vec<Option<[f32; 3]>>) = match town.overlay {
        Overlay::Town => (vec![None; s], vec![None; persons]),
        Overlay::Decided => {
            let focus = town.focus.as_deref().filter(|f| *f != "all").and_then(|f| data::CLASSES.iter().position(|c| *c == f));
            let b =
                town.decided.as_ref().map(|x| overlays::decided_colors(&x.1, focus)).unwrap_or_else(|| vec![Some(lin(overlays::BASE)); s]);
            (b, vec![Some(lin([0xc9, 0xd3, 0xe6])); persons])
        }
        Overlay::Hardship => {
            let money = town.focus.as_deref() == Some("money");
            // (one day's row: a track of one day)
            let vals = overlays::hardship(
                if money { None } else { town.agency.as_ref().map(|x| x.1.as_slice()) },
                if money { town.money.as_ref().map(|x| x.1.as_slice()) } else { None },
                persons,
                0,
                0,
            );
            let midnight = town.window.where_.get(&d).cloned().unwrap_or_default();
            let homes = overlays::by_home(&vals, &midnight, &town.layout.space_struct, &town.layout.space_kind, s);
            let base = lin(overlays::BASE);
            (
                homes.iter().map(|v| Some(v.map(|v| overlays::lerp3(base, overlays::ramp(v), 0.8)).unwrap_or(base))).collect(),
                vals.iter().map(|v| Some(v.map(overlays::ramp).unwrap_or(lin(overlays::NO_DATA)))).collect(),
            )
        }
        Overlay::Compare => {
            let base = lin(overlays::BASE);
            let v = town.compare.clone().unwrap_or_default();
            (
                (0..s)
                    .map(|i| {
                        let x = v.get(i).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
                        Some(if x > 0.0 {
                            overlays::lerp3(base, lin([0xff, 0x4f, 0xa0]), x.sqrt())
                        } else {
                            overlays::lerp3(base, lin([0x3f, 0xd0, 0xc9]), (-x).sqrt())
                        })
                    })
                    .collect(),
                vec![Some(lin([0xc9, 0xd3, 0xe6])); persons],
            )
        }
    };
    for tile in &town.tiles {
        let Some(mut m) = meshes.get_mut(&tile.mesh) else {
            continue;
        };
        let Some(bevy::mesh::VertexAttributeValues::Float32x4(col)) = m.attribute_mut(Mesh::ATTRIBUTE_COLOR) else {
            continue;
        };
        for &(st, first, nw, nr) in &tile.spans {
            let cat = &town.data.world.structures[st].category;
            let (wall, roof) = layout::category_colors(cat);
            let (cw, cr) = match buildings.get(st).copied().flatten() {
                Some(c) => (c, [c[0] * 0.72, c[1] * 0.72, c[2] * 0.72]),
                None => (lin(wall), lin(roof)),
            };
            for v in &mut col[first..first + nw] {
                *v = [cw[0], cw[1], cw[2], 1.0];
            }
            for v in &mut col[first + nw..first + nw + nr] {
                *v = [cr[0], cr[1], cr[2], 1.0];
            }
        }
    }
    town.person_color = people;
    town.crowd.all_dirty = true;
}

// ---------------------------------------------------------------- light by the hour

#[allow(clippy::type_complexity)]
fn light(
    clock: Res<Clock>,
    town: Option<ResMut<Town>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut sun: Query<(&mut DirectionalLight, &mut Transform), With<Sun>>,
    mut ambient: ResMut<GlobalAmbientLight>,
    mut clear: ResMut<ClearColor>,
    mut fog: Query<&mut DistanceFog>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut pmats: ResMut<Assets<PeopleMaterial>>,
    orbit: Res<Orbit>,
) {
    let hour = data::clock(clock.t as i64).3;
    let day = (((hour - 6.0) / 12.0) * std::f32::consts::PI).sin(); // 1 at noon, below 0 at night
    let up = day.max(0.0);
    let night = ((0.25 - day) / 0.45).clamp(0.0, 1.0);
    let overlay_lit = town.as_ref().map(|t| t.overlay != Overlay::Town).unwrap_or(false);
    let warm = 1.0 - (up * 2.2).min(1.0);
    if let Ok((mut l, mut tr)) = sun.single_mut() {
        let az = ((hour - 6.0) / 12.0) * std::f32::consts::PI;
        let c = town.as_ref().map(|t| Vec3::new(t.layout.w as f32 / 2.0, 0.0, t.layout.h as f32 / 2.0)).unwrap_or(Vec3::ZERO);
        let dir = if night > 0.5 {
            Vec3::new(-0.4, 0.9, 0.5).normalize()
        } else {
            Vec3::new(az.cos() * 0.8, 0.25 + up * 0.9, -az.sin() * 0.3 - 0.35).normalize()
        };
        *tr = Transform::from_translation(c + dir * 200.0).looking_at(c, Vec3::Y);
        // by day the sun, warm low and white high; by night a cool moon, enough to read the town by
        let sun = Vec3::new(1.0, 0.93 - warm * 0.25, 0.85 - warm * 0.45);
        let moon = Vec3::new(0.55, 0.66, 1.0);
        let c = sun.lerp(moon, night);
        l.color = Color::srgb(c.x, c.y, c.z);
        l.illuminance = if overlay_lit { 7000.0f32.max(500.0 + up * 11000.0) } else { 1400.0 * night + up * 11000.0 + 300.0 };
    }
    let (sky_day, sky_dusk, sky_night) = (Vec3::new(0.62, 0.75, 0.92), Vec3::new(0.85, 0.55, 0.42), Vec3::new(0.05, 0.07, 0.15));
    let sky = if day > 0.15 {
        sky_day.lerp(sky_dusk, (1.0 - ((day - 0.15) / 0.5).min(1.0)) * 0.5)
    } else if day > -0.2 {
        sky_night.lerp(sky_dusk, (day + 0.2) / 0.35)
    } else {
        sky_night
    };
    let sky = if overlay_lit { sky.lerp(Vec3::new(0.12, 0.14, 0.2), 0.8) } else { sky };
    clear.0 = Color::srgb(sky.x, sky.y, sky.z);
    ambient.brightness = if overlay_lit { 1100.0 } else { 300.0 + up * 900.0 };
    ambient.color = Color::srgb(0.45 + up * 0.35, 0.55 + up * 0.32, 0.95);
    if let Ok(mut f) = fog.single_mut() {
        f.color = Color::srgba(sky.x, sky.y, sky.z, 1.0);
        // gentle depth: the far side of the view fades a little
        // (the camera stands CAMERA_DISTANCE back from what it looks at: the fog begins behind the middle of the view)
        let span = orbit.height;
        f.falloff = FogFalloff::Linear { start: CAMERA_DISTANCE + span * 0.15, end: CAMERA_DISTANCE + span * 2.6 };
    }
    if let Some(t) = town.as_ref() {
        if let Some(mut m) = mats.get_mut(&t.wall_mat) {
            let k = if overlay_lit { 0.0 } else { night * 2.2 };
            m.emissive = LinearRgba::rgb(1.0 * k, 0.72 * k, 0.36 * k);
        }
        if let Some(mut m) = pmats.get_mut(&t.people_mat) {
            m.params.night = night;
        }
    }
    // the pools: warm where people are in, by night (rewritten when the night or the occupancy moves)
    if let Some(mut t) = town {
        let level = if overlay_lit { 0.0 } else { night };
        let occ_sum: u32 = t.occupancy.iter().map(|&x| x as u32).sum();
        let key = level * 1000.0 + occ_sum as f32 * 0.0001;
        if (key - t.pool_level).abs() > 0.02 {
            t.pool_level = key;
            if let Some(mut m) = meshes.get_mut(&t.pools) {
                if let Some(bevy::mesh::VertexAttributeValues::Float32x4(col)) = m.attribute_mut(Mesh::ATTRIBUTE_COLOR) {
                    for &(st, v0) in &t.pool_of {
                        let k = level * (t.occupancy.get(st).copied().unwrap_or(0) as f32 / 6.0).min(1.0) * 0.55;
                        for v in &mut col[v0..v0 + 4] {
                            *v = [k, k * 0.72, k * 0.38, 1.0];
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- the camera

fn camera_input(
    mut orbit: ResMut<Orbit>,
    buttons: Res<ButtonInput<MouseButton>>,
    keys: Res<ButtonInput<KeyCode>>,
    mut wheel: MessageReader<MouseWheel>,
    mut motion: MessageReader<MouseMotion>,
    windows: Query<&Window, With<bevy::window::PrimaryWindow>>,
    cams: Query<(&Camera, &GlobalTransform)>,
    town: Option<ResMut<Town>>,
) {
    let Ok(win) = windows.single() else { return };
    let cursor = win.cursor_position();
    let _ = motion.read().count();
    let rotate_mod = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::AltLeft);
    if let Some(c) = cursor {
        if buttons.just_pressed(MouseButton::Left) || buttons.just_pressed(MouseButton::Right) || buttons.just_pressed(MouseButton::Middle)
        {
            let rot = buttons.just_pressed(MouseButton::Right) || buttons.just_pressed(MouseButton::Middle) || rotate_mod;
            orbit.drag = Some((c, rot, c));
            if let Some(mut t) = town {
                t.follow = false;
            }
        }
    }
    if !(buttons.pressed(MouseButton::Left) || buttons.pressed(MouseButton::Right) || buttons.pressed(MouseButton::Middle)) {
        orbit.drag = None;
    }
    if let (Some((start, rot, last)), Some(c)) = (orbit.drag, cursor) {
        let d = c - last;
        if rot {
            orbit.goal_yaw -= d.x * 0.008;
            orbit.goal_pitch = (orbit.goal_pitch + d.y * 0.006).clamp(0.21, 1.55);
        } else {
            // pan: the ground under the pointer stays under it
            let k = orbit.height / win.height().max(1.0);
            let (s, cy) = orbit.yaw.sin_cos();
            let along = 1.0 / orbit.pitch.sin().max(0.2);
            let mv = Vec3::new(-cy * d.x + s * d.y * along, 0.0, s * d.x + cy * d.y * along) * k;
            orbit.goal_target += mv;
            orbit.target += mv;
        }
        orbit.drag = Some((start, rot, c));
    }
    let mut scroll = 0.0;
    for ev in wheel.read() {
        scroll += match ev.unit {
            MouseScrollUnit::Line => ev.y * 0.12,
            MouseScrollUnit::Pixel => ev.y * 0.0015,
        };
    }
    if scroll != 0.0 {
        let f = (1.0 + scroll.abs()).powf(scroll.signum());
        let old = orbit.goal_height;
        orbit.goal_height = (orbit.goal_height / f).clamp(2.0, 3000.0);
        // zoom towards the pointer
        if let (Some(c), Ok((cam, gt))) = (cursor, cams.single()) {
            if let Ok(ray) = cam.viewport_to_world(gt, c) {
                if let Some(d) = ray.intersect_plane(Vec3::ZERO, InfinitePlane3d::new(Vec3::Y)) {
                    let p = ray.get_point(d);
                    let k = 1.0 - orbit.goal_height / old;
                    let tgt = orbit.goal_target;
                    orbit.goal_target = tgt + (p - tgt) * k;
                }
            }
        }
    }
}

fn camera_apply(
    mut orbit: ResMut<Orbit>,
    mut cams: Query<(&mut Transform, &mut Projection), With<Camera3d>>,
    time: Res<Time<Real>>,
    town: Option<Res<Town>>,
    clock: Res<Clock>,
) {
    let k = 1.0 - (-time.delta_secs() * 9.0).exp();
    if let Some(t) = town.as_ref() {
        if let (true, Some(p)) = (t.follow, t.selected_person) {
            if let Some((v, _)) = t.crowd.pos(&t.layout, p, (clock.speed * 0.6) as i64) {
                orbit.goal_target = Vec3::new(v[0], 0.0, v[2]);
            }
        }
    }
    let before = (orbit.target, orbit.yaw, orbit.pitch, orbit.height);
    orbit.target = orbit.target.lerp(orbit.goal_target, k);
    orbit.yaw += (orbit.goal_yaw - orbit.yaw) * k;
    orbit.pitch += (orbit.goal_pitch - orbit.pitch) * k;
    orbit.height += (orbit.goal_height - orbit.height) * k;
    orbit.moved = before != (orbit.target, orbit.yaw, orbit.pitch, orbit.height) || orbit.moved;
    let Ok((mut tr, mut proj)) = cams.single_mut() else {
        return;
    };
    let dir = Vec3::new(orbit.pitch.cos() * orbit.yaw.sin(), orbit.pitch.sin(), orbit.pitch.cos() * orbit.yaw.cos());
    *tr = Transform::from_translation(orbit.target + dir * CAMERA_DISTANCE).looking_at(orbit.target, Vec3::Y);
    if let Projection::Orthographic(o) = &mut *proj {
        o.scaling_mode = ScalingMode::FixedVertical { viewport_height: orbit.height };
    }
}

// ---------------------------------------------------------------- picking

fn pick(
    mut orbit: ResMut<Orbit>,
    town: Option<Res<Town>>,
    windows: Query<&Window, With<bevy::window::PrimaryWindow>>,
    cams: Query<(&Camera, &GlobalTransform)>,
    buttons: Res<ButtonInput<MouseButton>>,
    time: Res<Time<Real>>,
    clock: Res<Clock>,
    mut press: Local<Option<Vec2>>,
) {
    let Some(t) = town else { return };
    let Ok(win) = windows.single() else { return };
    let Ok((cam, gt)) = cams.single() else { return };
    let Some(c) = win.cursor_position() else {
        return;
    };
    if buttons.just_pressed(MouseButton::Left) {
        *press = Some(c);
    }
    let click = buttons.just_released(MouseButton::Left) && press.map(|p| p.distance(c) < 5.0).unwrap_or(false);
    let now = time.elapsed_secs_f64();
    let hover = buttons.get_pressed().next().is_none() && now - orbit.hover_at > 0.08;
    if !click && !hover {
        return;
    }
    orbit.hover_at = now;
    let vis = (clock.speed * 0.6) as i64;
    // people first: the nearest drawn within a few pixels
    let mut best: Option<(u32, f32)> = None;
    let r2 = 10.0f32 * 10.0;
    for p in 0..t.data.meta.persons as u32 {
        let tx = t.texels[2 * p as usize];
        if tx[3] <= 0.0 {
            continue;
        }
        let Ok(s) = cam.world_to_viewport(gt, Vec3::new(tx[0], tx[1], tx[2])) else {
            continue;
        };
        let d = s.distance_squared(c);
        if d < r2 && best.map(|b| d < b.1).unwrap_or(true) {
            best = Some((p, d));
        }
    }
    let (id, label) = if let Some((p, _)) = best {
        let pid = &t.data.persons[p as usize];
        let inside = t
            .layout
            .struct_of_space(t.crowd.cur[p as usize])
            .and_then(|s| t.data.world.structures.get(s))
            .map(|s| format!(" in {}", s.id))
            .unwrap_or_default();
        let moving =
            if t.crowd.pos(&t.layout, p, vis).map(|x| x.1).unwrap_or(false) { " on the way (the route is drawn, not logged)" } else { "" };
        (format!("person:{pid}"), format!("{pid}{inside}{moving}"))
    } else if let Some(b) = pick_building(&t, cam, gt, c) {
        let s = &t.data.world.structures[b];
        let org = t.data.world.orgs.iter().find(|o| o.premises.contains(&(b as i64)));
        let key = match org {
            Some(o) if click => format!("org:{}", o.id),
            _ => format!("building:{b}"),
        };
        (
            key,
            format!(
                "{} · {} · {} inside",
                org.map(|o| o.name.clone()).unwrap_or(s.id.clone()),
                s.type_,
                t.occupancy.get(b).copied().unwrap_or(0)
            ),
        )
    } else {
        (String::new(), String::new())
    };
    if click {
        // (an org's building opens the org, as the Three.js client does for offices and seats' premises)
        let id = if id.starts_with("org:") {
            let oid = id.strip_prefix("org:").unwrap_or(&id);
            let o = t.data.world.orgs.iter().find(|o| o.id == oid);
            let important = o.map(|o| !matches!(o.kind.as_str(), "household" | "landlord" | "shop" | "factory" | "firm")).unwrap_or(false);
            if important {
                id
            } else {
                o.and_then(|o| o.premises.first()).map(|b| format!("building:{b}")).unwrap_or(id)
            }
        } else {
            id
        };
        push_command(Command::Select { id, fly: false });
    } else {
        emit(Event::Hovered { id, label, x: c.x, y: c.y });
    }
}

/// The building under a screen point: a ray against every box (the nearest hit), else the flat thing on the cell.
fn pick_building(t: &Town, cam: &Camera, gt: &GlobalTransform, c: Vec2) -> Option<usize> {
    let ray = cam.viewport_to_world(gt, c).ok()?;
    let (o, d) = (ray.origin, *ray.direction);
    let mut best: Option<(usize, f32)> = None;
    for (i, p) in t.layout.placed.iter().enumerate() {
        let Some(p) = p else { continue };
        if p.flat {
            continue;
        }
        let lo = Vec3::new(p.cx - p.fw / 2.0, 0.0, p.cz - p.fd / 2.0);
        let hi = Vec3::new(p.cx + p.fw / 2.0, p.top, p.cz + p.fd / 2.0);
        let inv = d.recip();
        let (t1, t2) = ((lo - o) * inv, (hi - o) * inv);
        let tmin = t1.min(t2).max_element();
        let tmax = t1.max(t2).min_element();
        if tmax >= tmin.max(0.0) && best.map(|b| tmin < b.1).unwrap_or(true) {
            best = Some((i, tmin));
        }
    }
    if let Some(b) = best {
        return Some(b.0);
    }
    let dist = ray.intersect_plane(Vec3::ZERO, InfinitePlane3d::new(Vec3::Y))?;
    let p = ray.get_point(dist);
    t.layout.structure_at(&t.data, p.x, p.z)
}

// ---------------------------------------------------------------- rings, arcs, beacons

fn fx(mut fx: ResMut<Fx>, mut gizmos: Gizmos, time: Res<Time<Real>>, town: Option<Res<Town>>, clock: Res<Clock>) {
    let now = time.elapsed_secs_f64();
    fx.rings.retain(|r| now - r.born < r.life);
    for r in &fx.rings {
        let age = ((now - r.born) / r.life) as f32;
        let s = r.size * (0.25 + age * 1.1);
        let f = (1.0 - age) * (1.0 - age);
        gizmos.circle(Isometry3d::new(r.at, Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)), s, r.color.with_alpha(f));
    }
    fx.arcs.retain(|a| a.keep || now - a.born < a.life);
    for a in &fx.arcs {
        let age = ((now - a.born) / a.life) as f32;
        let fade = if a.keep { 0.85 + 0.15 * ((now * 3.0).sin() as f32) } else { (1.0 - ((age - 0.35).max(0.0) / 0.65)).max(0.0) };
        let head = ((now - a.born) / 1.1).min(1.0) as f32;
        let pts: Vec<Vec3> = (0..=32).map(|i| bezier(a.a, a.mid, a.b, i as f32 / 32.0)).collect();
        gizmos.linestrip(pts, a.color.with_alpha(fade));
        if head < 1.0 {
            gizmos.sphere(Isometry3d::from_translation(bezier(a.a, a.mid, a.b, head)), 0.22, a.color.mix(&Color::WHITE, 0.5));
        }
    }
    for (p, c) in &fx.beacons {
        gizmos.line(*p, *p + Vec3::Y * 14.0, c.with_alpha(0.55));
        gizmos.circle(Isometry3d::new(Vec3::new(p.x, 0.05, p.z), Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)), 0.7, *c);
    }
    if let Some(t) = town {
        if let Some(p) = t.selected_person {
            if let Some((v, _)) = t.crowd.pos(&t.layout, p, (clock.speed * 0.6) as i64) {
                let v = Vec3::from(v);
                gizmos.circle(
                    Isometry3d::new(v, Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
                    0.35 + 0.05 * (now * 4.0).sin() as f32,
                    Color::WHITE,
                );
            }
        }
    }
}

fn bezier(a: Vec3, m: Vec3, b: Vec3, k: f32) -> Vec3 {
    let u = 1.0 - k;
    a * u * u + m * 2.0 * u * k + b * k * k
}

// ---------------------------------------------------------------- labels and statistics

fn labels(
    town: Option<Res<Town>>,
    cams: Query<(&Camera, &GlobalTransform)>,
    mut orbit: ResMut<Orbit>,
    mut last: Local<f64>,
    time: Res<Time<Real>>,
) {
    let Some(t) = town else { return };
    let now = time.elapsed_secs_f64();
    if !orbit.moved && now - *last < 0.5 {
        return;
    }
    orbit.moved = false;
    *last = now;
    let Ok((cam, gt)) = cams.single() else { return };
    let at = t
        .labels
        .iter()
        .filter_map(|(k, p)| {
            cam.world_to_viewport(gt, *p).ok().map(|s| (k.clone(), s.x, s.y, orbit.height < 140.0 || k.starts_with("org:") && false))
        })
        .collect();
    emit(Event::Labels { at });
}

fn perf(mut perf: ResMut<Perf>, time: Res<Time<Real>>, town: Option<Res<Town>>, probe: Option<Res<MemProbe>>) {
    let dt = time.delta_secs() * 1000.0;
    perf.frames.push_back(dt);
    if perf.frames.len() > 240 {
        perf.frames.pop_front();
    }
    let now = time.elapsed_secs_f64();
    if !perf.on || now - perf.last < 1.0 {
        return;
    }
    perf.last = now;
    let mut v: Vec<f32> = perf.frames.iter().copied().collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = v.iter().sum::<f32>() / v.len().max(1) as f32;
    let p95 = v.get((v.len() as f32 * 0.95) as usize).copied().unwrap_or(mean);
    let (drawn, trips, structures, bytes) = town
        .as_ref()
        .map(|t| {
            (
                t.texels.iter().step_by(2).take(t.data.meta.persons).filter(|x| x[3] > 0.0).count(),
                t.crowd.trips.len(),
                t.data.structure_count(),
                t.window.bytes(),
            )
        })
        .unwrap_or_default();
    emit(Event::Stats(Stats {
        fps: if mean > 0.0 { 1000.0 / mean } else { 0.0 },
        frame_ms_mean: mean,
        frame_ms_p95: p95,
        update_ms: perf.update_ms,
        people_drawn: drawn,
        trips,
        structures,
        track_bytes: bytes,
        memory_bytes: probe.map(|p| (p.0)()).unwrap_or(0),
    }));
}
