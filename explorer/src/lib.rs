//! The Bevy explorer (docs/explorer.md, "The Bevy explorer"): a run's town in 3D, from the explorer's data layer
//! (kernel/crates/explore). One crate for both shells: the browser (WebAssembly; WebGPU, or WebGL 2 where it is
//! missing; web.rs) and a native window (native.rs). The interface around it speaks only through the bridge
//! (bridge.rs). It reads runs and never writes to one.
//!
//! - data.rs: the data layer's world body and tracks, parsed;
//! - layout.rs: where things are drawn, and the roads people are drawn along (a visual only);
//! - tracks.rs: the window of days held, and where everyone is at the moment shown;
//! - overlays.rs: who decided and hardship, as the Three.js explorer computes them;
//! - source.rs: asking the data layer, over HTTP or in process;
//! - scene.rs: the Bevy scene.

pub mod bridge;
pub mod data;
pub mod layout;
pub mod overlays;
pub mod scene;
pub mod source;
pub mod tracks;

#[cfg(feature = "native")]
pub mod native;
#[cfg(feature = "native")]
pub mod ui;
#[cfg(target_arch = "wasm32")]
pub mod web;

use bevy::prelude::*;
use std::sync::Arc;

/// The app: Bevy's plugins for a window (a canvas in the browser), and the town.
pub fn app(source: Arc<dyn source::Source>, run: Option<String>, canvas: Option<String>) -> App {
    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(WindowPlugin {
                primary_window: Some(bevy::window::Window {
                    title: "Oikos explorer".into(),
                    canvas,
                    fit_canvas_to_parent: true,
                    prevent_default_event_handling: true,
                    ..default()
                }),
                ..default()
            })
            .set(bevy::log::LogPlugin { level: bevy::log::Level::WARN, ..default() }),
    )
    .insert_resource(scene::Feed::new(source, run))
    .add_plugins(scene::TownPlugin);
    app
}
