//! Where the scene gets a run from: the explorer's data layer (kernel/crates/explore), asked and answered by message so
//! the scene never waits. In the browser it is the Bun server's `/api` (web.rs, the Rust service behind it); natively it
//! is an `oikos_explore::Index` in the same process (native.rs). Both read; neither can write to a run.

use crate::tracks::Need;

/// What the scene asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Req {
    /// Whether the run is indexed yet (`/status?open=1`).
    Status,
    /// The `/world` body.
    World,
    /// Keyframes or moves for a window of days.
    Track(Need),
    /// A whole small track: "pulses".
    Bin(&'static str),
    /// One day's row of a per-day track: "agency", "money".
    DayRow(&'static str, i64),
    /// Per building and class, the consequential changes reaching those who live there, days `from..=to`.
    Decided { from: i64, to: i64 },
}

/// What comes back.
#[derive(Debug, Clone)]
pub enum Resp {
    /// `header`: the world can be shown already (the rest of the log still being read).
    Status {
        state: String,
        message: String,
        header: bool,
    },
    World(String),
    Track(Need, Vec<u8>),
    Bin(&'static str, Vec<u8>),
    DayRow(&'static str, i64, Vec<u8>),
    Decided {
        from: i64,
        to: i64,
        counts: Vec<[u32; 5]>,
    },
    Failed(Req, String),
}

/// A data layer the scene can ask. `ask` never blocks: the answer comes on `reply`.
pub trait Source: Send + Sync + 'static {
    fn ask(&self, run: &str, req: Req, reply: crossbeam_channel::Sender<Resp>);
    /// What drives the GPU here, as the interface shows it ("WebGPU", "WebGL 2", "native").
    fn backend(&self) -> String {
        String::new()
    }
}

/// The `/api` path of a request (as renderer/src/server.ts and kernel/crates/explore/src/service.rs serve it).
pub fn api_path(run: &str, req: &Req) -> String {
    let r = encode(run);
    match req {
        // (`partial`: answered from what is indexed so far, while the rest of the log is read: kernel/crates/explore)
        Req::Status => format!("api/r/{r}/status?open=1"),
        Req::World => format!("api/r/{r}/world?partial=1"),
        Req::Track(Need::Where { from, to }) => {
            format!("api/r/{r}/bin/where?from={from}&to={to}&partial=1")
        }
        Req::Track(Need::Moves { from, to }) => {
            format!("api/r/{r}/bin/moves?from={from}&to={to}&partial=1")
        }
        Req::Bin(name) => format!("api/r/{r}/bin/{name}?partial=1"),
        Req::DayRow(name, d) => format!("api/r/{r}/bin/{name}?from={d}&to={}&partial=1", d + 1),
        Req::Decided { from, to } => format!("api/r/{r}/decided?from={from}&to={to}&partial=1"),
    }
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_name_the_service_routes() {
        assert_eq!(api_path("town.seed1", &Req::World), "api/r/town.seed1/world?partial=1");
        assert_eq!(api_path("a b", &Req::Track(Need::Moves { from: 4, to: 8 })), "api/r/a%20b/bin/moves?from=4&to=8&partial=1");
        assert_eq!(api_path("r", &Req::Track(Need::Where { from: 0, to: 4 })), "api/r/r/bin/where?from=0&to=4&partial=1");
        assert_eq!(api_path("r", &Req::Bin("pulses")), "api/r/r/bin/pulses?partial=1");
        assert_eq!(api_path("r", &Req::DayRow("agency", 7)), "api/r/r/bin/agency?from=7&to=8&partial=1");
        assert_eq!(api_path("r", &Req::Decided { from: 0, to: 29 }), "api/r/r/decided?from=0&to=29&partial=1");
    }
}
