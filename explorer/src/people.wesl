// People: one light each, every one in a single draw. The mesh is a quad per person (its corners in position.xy, its
// index in position.z); where each is drawn and its colour come from a data texture the scene rewrites as people move
// (two texels per person: x, y, z, size; r, g, b, glow). The quad faces the camera.

import bevy_pbr::render::mesh_view_bindings::view;

struct PeopleParams {
    size: f32,
    night: f32,
    width: u32,
    pad: u32,
};

@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> params: PeopleParams;
@group(constants::MATERIAL_BIND_GROUP) @binding(1) var people: texture_2d<f32>;

struct VIn {
    @location(0) position: vec3<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

fn texel(i: u32) -> vec4<f32> {
    let w = params.width;
    return textureLoad(people, vec2<i32>(i32(i % w), i32(i / w)), 0);
}

@vertex
fn vertex(v: VIn) -> VOut {
    var out: VOut;
    let i = u32(v.position.z + 0.5);
    let p = texel(2u * i);
    let c = texel(2u * i + 1u);
    let right = view.world_from_view[0].xyz;
    let up = view.world_from_view[1].xyz;
    let s = params.size * p.w;
    let world = p.xyz + (right * v.position.x + up * v.position.y) * s;
    out.clip = view.clip_from_world * vec4<f32>(world, 1.0);
    if (p.w <= 0.0) {
        out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    }
    out.uv = v.position.xy;
    out.color = c;
    return out;
}

@fragment
fn fragment(in: VOut) -> @location(0) vec4<f32> {
    let d = length(in.uv);
    if (d > 1.0) {
        discard;
    }
    // a bright core and a soft halo, the halo stronger at night
    let core = 1.0 - smoothstep(0.30, 0.46, d);
    let halo = (1.0 - d) * (1.0 - d) * (0.35 + 0.65 * params.night) * in.color.a;
    let a = clamp(core + halo, 0.0, 1.0);
    let rgb = in.color.rgb * (core * (1.1 + params.night * 0.8) + halo * 1.6);
    return vec4<f32>(rgb, a);
}
