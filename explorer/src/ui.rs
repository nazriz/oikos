//! The native interface (egui): the clock and its controls, overlays, search, the timeline, and the inspector's panels,
//! read from the same data layer in process (`oikos_explore::Index`), through the same bridge as the browser's interface
//! (commands in, events out). Plainer than the browser's HTML interface; the same scene and the same data.

use crate::bridge::{CameraCmd, Command, Event, Stats};
use crate::data::{clock, DAY};
use crate::scene::{push_command, take_events};
use bevy::prelude::*;
use bevy_egui::{egui, EguiContexts, EguiPlugin, EguiPrimaryContextPass};
use oikos_explore::{Index, Panel};
use serde_json::Value;
use std::sync::Arc;

const SPEEDS: [(f64, &str); 6] =
    [(900.0, "¼h/s"), (3600.0, "1h/s"), (10800.0, "3h/s"), (43200.0, "12h/s"), (86400.0, "1d/s"), (345600.0, "4d/s")];
const CLASSES: [(&str, [u8; 3]); 5] = [
    ("self", [0x8c, 0x9b, 0xb0]),
    ("person", [0xf2, 0xc1, 0x4e]),
    ("system", [0x3f, 0xd0, 0xc9]),
    ("seat", [0xff, 0x4f, 0xa0]),
    ("world", [0x6f, 0x7a, 0x8c]),
];

#[derive(Resource)]
struct Ui {
    index: Arc<Index>,
    world: Option<Value>,
    t: i64,
    end: i64,
    playing: bool,
    speed: usize,
    overlay: String,
    focus: String,
    search: String,
    selected: String,
    panel: Option<Value>,
    panel_t: i64,
    trace: Option<(u32, Value)>,
    stats: Option<Stats>,
    hovered: String,
    follow: bool,
    persons: Vec<String>,
}

pub fn add(app: &mut App, index: Arc<Index>) {
    app.add_plugins(EguiPlugin::default())
        .insert_resource(Ui {
            index,
            world: None,
            t: 8 * 3600,
            end: 1,
            playing: false,
            speed: 2,
            overlay: "town".into(),
            focus: "all".into(),
            search: String::new(),
            selected: String::new(),
            panel: None,
            panel_t: -1,
            trace: None,
            stats: None,
            hovered: String::new(),
            follow: false,
            persons: vec![],
        })
        .add_systems(Update, (events, keys))
        .add_systems(EguiPrimaryContextPass, draw);
}

fn events(mut ui: ResMut<Ui>) {
    for e in take_events() {
        match e {
            Event::Ready { last_t, days, .. } => {
                ui.end = last_t.max(days * DAY);
                ui.world = ui.index.world_json();
                ui.persons = ui
                    .world
                    .as_ref()
                    .and_then(|w| w["persons"].as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                push_command(Command::SetSpeed { x: SPEEDS[ui.speed].0 });
            }
            Event::TimeChanged { t, playing, .. } => {
                ui.t = t;
                ui.playing = playing;
            }
            Event::Selected { id } => {
                if !id.is_empty() {
                    ui.selected = id;
                    ui.panel_t = -1;
                }
            }
            Event::Hovered { label, .. } => ui.hovered = label,
            Event::Stats(s) => ui.stats = Some(s),
            _ => {}
        }
    }
    // the panel at the moment shown (again when the moment moves while paused)
    if !ui.selected.is_empty() && (ui.panel_t < 0 || (!ui.playing && (ui.panel_t - ui.t).abs() > 600)) {
        let (k, id) = ui.selected.split_once(':').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or_default();
        let t = ui.t;
        let p = match k.as_str() {
            "person" => ui.index.panel_json(Panel::Person(id), Some(t)),
            "org" => ui.index.panel_json(Panel::Org(id), Some(t)),
            "building" => id.parse().ok().and_then(|n| ui.index.panel_json(Panel::Building(n), Some(t))),
            "act" => id.parse().ok().and_then(|n| ui.index.panel_json(Panel::SeatAct(n), Some(t))),
            "seat" => Some(ui.index.seat_json(&id)),
            _ => None,
        };
        ui.panel = p;
        ui.panel_t = t;
    }
}

fn keys(keys: Res<ButtonInput<KeyCode>>, mut ui: ResMut<Ui>, mut ctx: EguiContexts) {
    if ctx.ctx_mut().map(|c| c.egui_wants_keyboard_input()).unwrap_or(false) {
        return;
    }
    let shift = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if keys.just_pressed(KeyCode::Space) {
        let on = !ui.playing;
        ui.playing = on;
        push_command(Command::Play { on });
    }
    for (k, dir) in [(KeyCode::ArrowRight, 1), (KeyCode::ArrowLeft, -1)] {
        if keys.just_pressed(k) {
            let t = (ui.t + dir * if shift { DAY } else { 3600 }).clamp(0, ui.end);
            push_command(Command::SetTime { t });
        }
    }
    if keys.just_pressed(KeyCode::BracketLeft) || keys.just_pressed(KeyCode::BracketRight) {
        ui.speed = if keys.just_pressed(KeyCode::BracketLeft) { ui.speed.saturating_sub(1) } else { (ui.speed + 1).min(5) };
        push_command(Command::SetSpeed { x: SPEEDS[ui.speed].0 });
    }
    if keys.just_pressed(KeyCode::KeyQ) {
        push_command(Command::Camera(CameraCmd::Turn { quarter: -1 }));
    }
    if keys.just_pressed(KeyCode::KeyE) {
        push_command(Command::Camera(CameraCmd::Turn { quarter: 1 }));
    }
    if keys.just_pressed(KeyCode::KeyI) {
        push_command(Command::Camera(CameraCmd::Iso));
    }
    if keys.just_pressed(KeyCode::Digit0) {
        push_command(Command::Camera(CameraCmd::Frame));
    }
    if keys.just_pressed(KeyCode::KeyF) {
        ui.follow = !ui.follow;
        push_command(Command::Camera(CameraCmd::Follow { on: ui.follow }));
    }
    if keys.just_pressed(KeyCode::Escape) {
        ui.selected.clear();
        ui.panel = None;
        push_command(Command::Select { id: String::new(), fly: false });
        push_command(Command::ClearAct);
    }
}

fn col(c: [u8; 3]) -> egui::Color32 {
    egui::Color32::from_rgb(c[0], c[1], c[2])
}

fn draw(mut contexts: EguiContexts, mut ui: ResMut<Ui>) -> Result {
    let ctx = contexts.ctx_mut()?.clone();
    let ui = &mut *ui;
    // (panels are shown inside a root Ui over the whole window, the scene behind it)
    let mut root = egui::Ui::new(
        ctx.clone(),
        "root".into(),
        egui::UiBuilder::new().layer_id(egui::LayerId::background()).max_rect(ctx.viewport_rect()),
    );
    // ---- the top bar
    egui::Panel::top("top").show(&mut root, |b| {
        b.horizontal(|h| {
            h.strong("OIKOS EXPLORER");
            if let Some(w) = &ui.world {
                h.label(format!(
                    "{} · {} people · {} days",
                    w["world"]["name"].as_str().unwrap_or(""),
                    w["meta"]["persons"],
                    w["meta"]["days"]
                ));
            }
            h.separator();
            for (name, label) in [("town", "Town"), ("decided", "Who decided"), ("hardship", "Hardship")] {
                if h.selectable_label(ui.overlay == name, label).clicked() {
                    ui.overlay = name.into();
                    ui.focus = if name == "hardship" { "agency".into() } else { "all".into() };
                    push_command(Command::SetOverlay { name: name.into(), focus: Some(ui.focus.clone()) });
                }
            }
            if ui.overlay != "town" {
                let opts: &[&str] =
                    if ui.overlay == "decided" { &["all", "person", "system", "seat", "world", "self"] } else { &["agency", "money"] };
                egui::ComboBox::from_id_salt("focus").selected_text(ui.focus.clone()).show_ui(h, |c| {
                    for o in opts {
                        if c.selectable_label(ui.focus == *o, *o).clicked() {
                            ui.focus = o.to_string();
                            push_command(Command::SetOverlay { name: ui.overlay.clone(), focus: Some(ui.focus.clone()) });
                        }
                    }
                });
            }
            h.separator();
            h.add(egui::TextEdit::singleline(&mut ui.search).hint_text("search a person, office, building").desired_width(220.0));
            if let Some(s) = &ui.stats {
                h.separator();
                h.weak(format!(
                    "{:.0} fps · {:.1} ms (p95 {:.1}) · {} drawn · {} on the way · {} MB",
                    s.fps,
                    s.frame_ms_mean,
                    s.frame_ms_p95,
                    s.people_drawn,
                    s.trips,
                    s.memory_bytes / 1_048_576
                ));
            }
        });
        // search results
        let q = ui.search.trim().to_lowercase();
        if q.len() >= 2 {
            let mut hits: Vec<(String, String)> = vec![];
            if let Some(w) = &ui.world {
                for o in w["world"]["orgs"].as_array().into_iter().flatten() {
                    let (id, name) = (o["id"].as_str().unwrap_or(""), o["name"].as_str().unwrap_or(""));
                    if name.to_lowercase().contains(&q) || id.to_lowercase().contains(&q) {
                        hits.push((format!("org:{id}"), name.to_string()));
                    }
                }
                for (i, s) in w["world"]["structures"].as_array().into_iter().flatten().enumerate() {
                    if s["id"].as_str().unwrap_or("").to_lowercase().starts_with(&q) && s["type"] != "road" {
                        hits.push((format!("building:{i}"), s["id"].as_str().unwrap_or("").into()));
                    }
                }
            }
            hits.extend(ui.persons.iter().filter(|p| p.to_lowercase().starts_with(&q)).take(8).map(|p| (format!("person:{p}"), p.clone())));
            b.horizontal_wrapped(|h| {
                for (id, label) in hits.into_iter().take(14) {
                    if h.button(label).clicked() {
                        push_command(Command::Select { id: id.clone(), fly: true });
                        ui.selected = id;
                        ui.panel_t = -1;
                        ui.search.clear();
                    }
                }
            });
        }
    });
    // ---- the clock and the timeline
    egui::Panel::bottom("time").min_size(84.0).show(&mut root, |b| {
        b.horizontal(|h| {
            if h.button(if ui.playing { "⏸" } else { "▶" }).clicked() {
                ui.playing = !ui.playing;
                push_command(Command::Play { on: ui.playing });
            }
            let (d, hh, mm, _) = clock(ui.t);
            h.strong(format!("day {d}  {hh:02}:{mm:02}"));
            for (i, (s, l)) in SPEEDS.iter().enumerate() {
                if h.selectable_label(ui.speed == i, *l).clicked() {
                    ui.speed = i;
                    push_command(Command::SetSpeed { x: *s });
                }
            }
            h.weak("space play · left/right an hour (shift: a day) · [ ] speed · q/e turn · i iso · 0 fit · f follow · Esc close");
        });
        // the town's pulse by day, and the playhead: click or drag to scrub
        let (rect, resp) = b.allocate_exact_size(egui::vec2(b.available_width(), 46.0), egui::Sense::click_and_drag());
        let p = b.painter_at(rect);
        p.rect_filled(rect, 4.0, egui::Color32::from_rgb(0x13, 0x1c, 0x31));
        if let Some(w) = &ui.world {
            let days = w["meta"]["days"].as_i64().unwrap_or(1).max(1);
            let tp = &w["townPulse"]["byClass"];
            let total = |d: usize| ["person", "system", "seat", "world"].iter().map(|c| tp[*c][d].as_f64().unwrap_or(0.0)).sum::<f64>();
            let max = (0..=days as usize).map(total).fold(1.0, f64::max).sqrt();
            let bw = rect.width() / (days + 1) as f32;
            for d in 0..=days as usize {
                let mut y = rect.bottom();
                for (c, rgb) in &CLASSES[1..] {
                    let v = tp[*c][d].as_f64().unwrap_or(0.0);
                    let hgt = (v.sqrt() / max) as f32 * (rect.height() - 4.0) * (v / total(d).max(1.0)).sqrt() as f32;
                    let x = rect.left() + d as f32 * bw;
                    p.rect_filled(
                        egui::Rect::from_min_max(egui::pos2(x, y - hgt), egui::pos2(x + bw - 1.0, y)),
                        0.0,
                        col(*rgb).gamma_multiply(0.75),
                    );
                    y -= hgt;
                }
            }
            for a in w["seatActs"].as_array().into_iter().flatten() {
                let x = rect.left() + (a["t"].as_f64().unwrap_or(0.0) / ui.end as f64) as f32 * rect.width();
                p.circle_filled(egui::pos2(x, rect.top() + 6.0), 3.0, col(CLASSES[3].1));
            }
        }
        let x = rect.left() + (ui.t as f32 / ui.end.max(1) as f32) * rect.width();
        p.line_segment([egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())], egui::Stroke::new(1.5, egui::Color32::WHITE));
        if let Some(pos) = resp.interact_pointer_pos() {
            let t = (((pos.x - rect.left()) / rect.width()).clamp(0.0, 1.0) * ui.end as f32) as i64;
            push_command(Command::SetTime { t });
            ui.t = t;
        }
    });
    // ---- the inspector
    if let Some(panel) = ui.panel.clone() {
        egui::Panel::right("inspector").default_size(420.0).show(&mut root, |b| {
            b.horizontal(|h| {
                h.heading(&ui.selected);
                if h.button("×").clicked() {
                    ui.selected.clear();
                    ui.panel = None;
                    push_command(Command::Select { id: String::new(), fly: false });
                }
            });
            egui::ScrollArea::vertical().show(b, |s| panel_ui(s, ui, &panel));
        });
    }
    if !ui.hovered.is_empty() {
        egui::Area::new("hover".into()).fixed_pos(egui::pos2(12.0, 60.0)).show(&ctx, |a| {
            a.label(egui::RichText::new(&ui.hovered).background_color(egui::Color32::from_black_alpha(200)));
        });
    }
    Ok(())
}

/// A panel: its facts first, then its rows (each opens its causal trace), then the rest as it is.
fn panel_ui(s: &mut egui::Ui, ui: &mut Ui, p: &Value) {
    let go = |s: &mut egui::Ui, label: &str, id: String| {
        if s.link(label).clicked() {
            push_command(Command::Select { id, fly: true });
        }
    };
    if let Some(o) = p.as_object() {
        for k in ["kind", "type", "category", "age", "sex", "name"] {
            if let Some(v) = o.get(k).filter(|v| !v.is_null()) {
                s.label(format!("{k}: {}", v.as_str().map(String::from).unwrap_or(v.to_string())));
            }
        }
        for k in ["now", "home", "job"] {
            if let Some(v) = o.get(k).filter(|v| v.is_object()) {
                s.horizontal(|h| {
                    h.weak(k);
                    if let Some(st) = v["struct"].as_i64() {
                        go(h, v["structure"].as_str().unwrap_or("?"), format!("building:{st}"));
                    }
                    if let Some(e) = v["employer"].as_str() {
                        go(h, e, format!("org:{e}"));
                    }
                });
            }
        }
        if let Some(by) = o.get("byClass").and_then(|v| v.as_object()) {
            s.horizontal_wrapped(|h| {
                h.weak("who decided what reached them:");
                for (c, rgb) in CLASSES {
                    if let Some(n) = by.get(c).and_then(|v| v.as_u64()).filter(|n| *n > 0) {
                        h.colored_label(col(rgb), format!("{c} {n}"));
                    }
                }
            });
        }
        for (k, label) in [("money", "money held, each midnight"), ("agency", "sense of agency (their own record)")] {
            if let Some(a) = o.get(k).and_then(|v| v.as_array()).filter(|a| a.len() > 1) {
                let d = (ui.t / DAY) as usize;
                s.label(format!("{label}: {} now (day {d})", a.get(d.min(a.len() - 1)).map(|v| v.to_string()).unwrap_or_default()));
            }
        }
        if let Some(r) = o.get("request").filter(|v| v.is_object()) {
            s.separator();
            s.strong("In its own words");
            s.label(r["words"].as_str().unwrap_or("(no words recorded)"));
            if let Some(d) = r["draft"]["call"].as_str() {
                s.strong("The translator's draft");
                s.monospace(d);
                s.label(format!("sign-off: {}", r["signoff"].as_str().unwrap_or("?")));
            }
        }
        for k in ["events", "decisions", "recent"] {
            if let Some(rows) = o.get(k).and_then(|v| v.as_array()) {
                s.separator();
                s.strong(format!("{k} ({})", rows.len()));
                for r in rows.iter().rev().take(200) {
                    let ord = r["ord"].as_u64().unwrap_or(0) as u32;
                    let cls = r["cls"].as_str().unwrap_or("world");
                    let rgb = CLASSES.iter().find(|c| c.0 == cls).map(|c| c.1).unwrap_or([0x88; 3]);
                    let (d, hh, mm, _) = clock(r["t"].as_i64().unwrap_or(0));
                    let text = format!("day {d} {hh:02}:{mm:02}  {}", r["text"].as_str().unwrap_or(""));
                    if s.add(egui::Label::new(egui::RichText::new(text).color(col(rgb))).sense(egui::Sense::click())).clicked() {
                        let about = ui.selected.strip_prefix("person:").map(String::from);
                        ui.trace = ui.index.trace_json(ord, about.as_deref()).map(|v| (ord, v));
                    }
                    if let Some((o, tr)) = &ui.trace {
                        if *o == ord {
                            for l in tr["links"].as_array().into_iter().flatten() {
                                s.indent(("trace", ord), |i| {
                                    i.label(format!(
                                        "{} · {}{}",
                                        l["role"].as_str().unwrap_or(""),
                                        l["text"].as_str().unwrap_or(""),
                                        l["why"]["text"].as_str().map(|w| format!(" — why: {w}")).unwrap_or_default()
                                    ));
                                });
                            }
                        }
                    }
                }
            }
        }
        if let Some(tr) = o.get("trace").and_then(|v| v.as_array()) {
            s.separator();
            s.strong("What it rested on");
            for l in tr {
                s.label(format!("{} · {}", l["role"].as_str().unwrap_or(""), l["text"].as_str().unwrap_or("")));
            }
        }
    }
    s.collapsing("the whole panel", |c| {
        c.monospace(serde_json::to_string_pretty(p).unwrap_or_default().chars().take(20_000).collect::<String>());
    });
}
