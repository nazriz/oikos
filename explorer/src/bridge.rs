//! The bridge between the scene and its interface: commands in, events out, as JSON (the browser's `wasm-bindgen`
//! exports in web.rs and the native interface both speak it). The scene never reaches into the interface and the
//! interface never touches the scene's state: everything passes here. Pure: no Bevy.

use serde::{Deserialize, Serialize};

/// A thing that can be selected: `person:c0042`, `org:bank`, `building:12`, `act:345`, `seat:mayor-llm`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sel {
    pub kind: String,
    pub id: String,
}

impl Sel {
    pub fn parse(s: &str) -> Option<Sel> {
        let (k, id) = s.split_once(':')?;
        matches!(k, "person" | "org" | "building" | "act" | "seat").then(|| Sel { kind: k.into(), id: id.into() })
    }
    pub fn key(&self) -> String {
        format!("{}:{}", self.kind, self.id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CameraCmd {
    /// A quarter turn (+1 clockwise, -1 back).
    Turn {
        quarter: i32,
    },
    /// Back to the true isometric angle, looking at the town.
    Iso,
    /// The whole built town in view.
    Frame,
    Zoom {
        factor: f32,
    },
    /// Pan by a fraction of the view.
    Pan {
        dx: f32,
        dz: f32,
    },
    /// Follow the selected person (or stop).
    Follow {
        on: bool,
    },
    /// Tilt (degrees above the ground).
    Tilt {
        degrees: f32,
    },
}

/// What the interface asks of the scene.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    /// Opens a run by its key (the Bun server's run key).
    LoadRun {
        id: String,
    },
    /// Selects a thing (empty: nothing); `fly` moves the camera to it.
    Select {
        id: String,
        #[serde(default)]
        fly: bool,
    },
    SetTime {
        t: i64,
    },
    /// World seconds per real second.
    SetSpeed {
        x: f64,
    },
    Play {
        on: bool,
    },
    /// "town", "decided", "hardship", "compare"; `focus` a class for "decided" ("all", "person", "system", "seat",
    /// "world", "self"), a variable for "hardship" ("agency", "money").
    SetOverlay {
        name: String,
        #[serde(default)]
        focus: Option<String>,
    },
    Camera(CameraCmd),
    /// Highlights where things are: buildings by index, with a colour ("#rrggbb"); empty clears.
    Beacons {
        structs: Vec<i64>,
        color: String,
    },
    /// Draws a seat's act's arcs and keeps them until cleared (from the act's office to everyone it reached).
    ShowAct {
        ord: u32,
    },
    ClearAct,
    /// Per-building values to colour by for the "compare" overlay (another run's difference), -1..1, by structure.
    CompareValues {
        values: Vec<f32>,
        label: String,
    },
    /// Frame-time statistics on or off (sent as `stats` events about once a second).
    Stats {
        on: bool,
    },
}

impl Command {
    pub fn parse(json: &str) -> Result<Command, String> {
        serde_json::from_str(json).map_err(|e| format!("not a command: {e}: {json}"))
    }
}

/// What the scene tells the interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    /// The run's town is drawn: what it holds.
    Ready {
        run: String,
        persons: usize,
        structures: usize,
        days: i64,
        last_t: i64,
        backend: String,
        first_paint_ms: f64,
    },
    /// The pointer is over something (`id` empty: over nothing); screen position in CSS pixels.
    Hovered {
        id: String,
        label: String,
        x: f32,
        y: f32,
    },
    Selected {
        id: String,
    },
    TimeChanged {
        t: i64,
        playing: bool,
        speed: f64,
    },
    /// A seat's act happened at the moment shown (as the scene played through it).
    SeatAct {
        ord: u32,
    },
    /// Labels' screen positions (for the interface to place its labels), by key.
    Labels {
        at: Vec<(String, f32, f32, bool)>,
    },
    Stats(Stats),
    Error {
        message: String,
    },
    /// The run is still being indexed by the data layer.
    Waiting {
        message: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub fps: f32,
    pub frame_ms_mean: f32,
    pub frame_ms_p95: f32,
    /// The scene's own CPU work in the last frame (time, people, overlays), ms.
    pub update_ms: f32,
    pub people_drawn: usize,
    pub trips: usize,
    pub structures: usize,
    pub track_bytes: usize,
    /// The WebAssembly memory (browser) or the process's resident memory (native), bytes, where known.
    pub memory_bytes: u64,
}

impl Event {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{\"ev\":\"error\"}".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_read_as_the_interface_writes_them() {
        assert_eq!(Command::parse(r#"{"cmd":"set_time","t":3600}"#).unwrap(), Command::SetTime { t: 3600 });
        assert_eq!(Command::parse(r#"{"cmd":"select","id":"person:c1"}"#).unwrap(), Command::Select { id: "person:c1".into(), fly: false });
        assert_eq!(
            Command::parse(r#"{"cmd":"set_overlay","name":"decided","focus":"seat"}"#).unwrap(),
            Command::SetOverlay { name: "decided".into(), focus: Some("seat".into()) }
        );
        assert_eq!(Command::parse(r#"{"cmd":"camera","turn":{"quarter":1}}"#).unwrap(), Command::Camera(CameraCmd::Turn { quarter: 1 }));
        assert_eq!(Command::parse(r#"{"cmd":"camera","iso":null}"#).unwrap(), Command::Camera(CameraCmd::Iso));
        assert!(Command::parse(r#"{"cmd":"write_to_the_run"}"#).is_err(), "nothing else is a command");
    }

    #[test]
    fn events_are_tagged_json() {
        let e = Event::Selected { id: "org:bank".into() };
        assert_eq!(e.to_json(), r#"{"ev":"selected","id":"org:bank"}"#);
        let s = Event::Stats(Stats { fps: 60.0, ..Default::default() }).to_json();
        assert!(s.starts_with(r#"{"ev":"stats","fps":60.0"#), "{s}");
    }

    #[test]
    fn selections_are_kind_and_id() {
        assert_eq!(Sel::parse("building:12"), Some(Sel { kind: "building".into(), id: "12".into() }));
        assert_eq!(Sel::parse("act:5").unwrap().key(), "act:5");
        assert_eq!(Sel::parse("nonsense"), None);
        assert_eq!(Sel::parse("file:/etc/passwd"), None);
    }
}
