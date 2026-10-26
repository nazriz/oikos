//! What the explorer reads of a run: the `/world` body of the explorer's data layer (kernel/crates/explore,
//! `Index::world_json`), parsed into plain structs, and the binary tracks (`Index::track_bytes`). Pure: no Bevy, no I/O.
//! Every field is the data layer's, under the client's names (renderer/src/client/api.ts `WorldData`).

use serde::Deserialize;
use serde_json::Value;

pub const DAY: i64 = 86_400;
/// Ints per move in the `moves` track (t, person, space index + 1 or 0).
pub const MOVE_INTS: usize = 3;
/// Ints per pulse in the `pulses` track (t, person, structure, class, flags, ord).
pub const PULSE_INTS: usize = 6;

/// The classes of who decided, in the track codes' order (kernel/crates/explore/src/world.rs `CLASSES`).
pub const CLASSES: [&str; 5] = ["self", "person", "system", "seat", "world"];

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub run_id: String,
    pub days: i64,
    pub last_t: i64,
    pub persons: usize,
    pub holders: usize,
    /// Per space: (structure index, kind, number).
    pub spaces: Vec<(i64, String, i64)>,
    pub extra_structures: Vec<String>,
    pub seats: Vec<String>,
    pub kept: u64,
    pub lines: u64,
    pub moves_day: Vec<usize>,
    pub pulses: usize,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Ground {
    pub w: i64,
    pub h: i64,
    pub cell: f64,
    pub terrain: Vec<Rect>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Structure {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub category: String,
    pub x: i64,
    pub y: i64,
    pub w: f64,
    pub h: f64,
    pub spaces: i64,
    pub levels: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Org {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub premises: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Post {
    pub id: String,
    pub entity: Option<String>,
    pub title: Option<String>,
    pub role: Option<String>,
    pub holder: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct World {
    pub run_id: String,
    pub name: String,
    pub description: String,
    pub ground: Ground,
    pub water: Vec<(i64, i64)>,
    pub lot_cells: Vec<Vec<(i64, i64)>>,
    pub structures: Vec<Structure>,
    pub orgs: Vec<Org>,
    pub posts: Vec<Post>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Target {
    pub id: String,
    pub kind: String,
    #[serde(rename = "struct")]
    pub st: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SeatAct {
    pub ord: u32,
    pub t: i64,
    pub end_t: Option<i64>,
    pub participant: String,
    #[serde(rename = "as")]
    pub as_: String,
    pub kinds: Vec<String>,
    pub text: String,
    pub status: Option<String>,
    pub from: i64,
    pub targets: Vec<Target>,
}

/// The `/world` body.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WorldData {
    pub meta: Meta,
    pub world: World,
    pub persons: Vec<String>,
    pub seat_acts: Vec<SeatAct>,
}

impl WorldData {
    pub fn parse(json: &str) -> Result<WorldData, String> {
        serde_json::from_str(json).map_err(|e| format!("the world did not parse: {e}"))
    }
    pub fn from_value(v: Value) -> Result<WorldData, String> {
        serde_json::from_value(v).map_err(|e| format!("the world did not parse: {e}"))
    }
    /// Structures in the world, plus those first named later in the log (they have no place on the ground).
    pub fn structure_count(&self) -> usize {
        self.world.structures.len() + self.meta.extra_structures.len()
    }
    /// The colour slot of each seat (in `meta.seats` order), as the Three.js client gives it.
    pub fn seat_index(&self, participant: &str) -> Option<usize> {
        self.meta.seats.iter().position(|s| s == participant)
    }
}

/// Little-endian decoders for the tracks.
pub fn u32s(b: &[u8]) -> Vec<u32> {
    b.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
pub fn i32s(b: &[u8]) -> Vec<i32> {
    b.chunks_exact(4).map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
pub fn i16s(b: &[u8]) -> Vec<i16> {
    b.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
}
pub fn f64s(b: &[u8]) -> Vec<f64> {
    b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
}

/// A pulse: a consequential change reaching a person (kernel/crates/explore `Pulse`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pulse {
    pub t: i64,
    pub person: i32,
    pub st: i32,
    pub cls: u8,
    pub flags: i32,
    pub ord: u32,
}
impl Pulse {
    /// Landed hard: a refusal, a removal, a debt, a failed payment, an illness.
    pub fn hard(&self) -> bool {
        self.flags & 1 != 0
    }
}
pub fn pulses(b: &[u8]) -> Vec<Pulse> {
    i32s(b)
        .chunks_exact(PULSE_INTS)
        .map(|k| Pulse { t: k[0] as i64, person: k[1], st: k[2], cls: k[3].clamp(0, 4) as u8, flags: k[4], ord: k[5] as u32 })
        .collect()
}

/// A day's (or days') moves: (t, person, space index + 1, 0 for none).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Move {
    pub t: i64,
    pub person: u32,
    pub s1: u32,
}
pub fn moves(b: &[u8]) -> Vec<Move> {
    i32s(b).chunks_exact(MOVE_INTS).map(|k| Move { t: k[0] as i64, person: k[1].max(0) as u32, s1: k[2].max(0) as u32 }).collect()
}

/// The clock as the client shows it.
pub fn clock(t: i64) -> (i64, u32, u32, f32) {
    let s = t.rem_euclid(DAY);
    (t.div_euclid(DAY), (s / 3600) as u32, ((s % 3600) / 60) as u32, s as f32 / 3600.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_world_body_parses_and_ignores_what_it_does_not_use() {
        let j = r#"{"meta":{"runId":"r1","days":2,"lastT":172800,"persons":2,"holders":3,"spaces":[[0,"dwelling",1],[1,"workplace",1]],
          "extraStructures":["x"],"seats":["mayor"],"kept":10,"lines":20,"movesDay":[0,2,3],"pulses":1,"indexSeconds":{"read":1}},
          "world":{"runId":"r1","name":"Town","ground":{"w":10,"h":8,"cell":1,"terrain":[{"x":0,"y":0,"w":2,"h":2,"label":"woodland"}]},
          "water":[[1,1]],"lotCells":[[[0,0],[0,1]]],"structures":[{"id":"h1","type":"house","category":"residential","x":1,"y":2,"w":1,"h":1,"spaces":1,"levels":2}],
          "orgs":[{"id":"bank","kind":"bank","name":"The bank","premises":[0]}],"posts":[{"id":"p","entity":"bank","holder":"mayor"}],"participants":[]},
          "persons":["c1","c2"],"pilot":null,"seatActs":[{"ord":5,"t":3600,"participant":"mayor","as":"p","kinds":["decision"],"text":"x","from":0,"targets":[{"id":"c1","kind":"person","struct":0}]}],"townPulse":{}}"#;
        let w = WorldData::parse(j).unwrap();
        assert_eq!(w.meta.persons, 2);
        assert_eq!(w.meta.spaces[1], (1, "workplace".into(), 1));
        assert_eq!(w.world.structures[0].type_, "house");
        assert_eq!(w.world.water, vec![(1, 1)]);
        assert_eq!(w.seat_acts[0].targets[0].st, 0);
        assert_eq!(w.structure_count(), 2);
        assert_eq!(w.seat_index("mayor"), Some(0));
    }

    #[test]
    fn tracks_decode_little_endian() {
        let mut b = vec![];
        for v in [7200i32, 1, 3, 9000, 0, 0] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        assert_eq!(moves(&b), vec![Move { t: 7200, person: 1, s1: 3 }, Move { t: 9000, person: 0, s1: 0 }]);
        let p = pulses(&b);
        assert_eq!(p.len(), 1);
        assert_eq!((p[0].t, p[0].st, p[0].cls), (7200, 3, 4));
        assert_eq!(clock(DAY + 3 * 3600 + 120), (1, 3, 2, 3.0 + 120.0 / 3600.0));
    }
}
