//! The browser shell: the WebAssembly exports the interface calls (the bridge: commands in, events out), and the data
//! layer reached over the Bun server's `/api` (renderer/src/server.ts, answered by kernel/crates/explore's service).

use crate::bridge::{CameraCmd, Command};
use crate::scene::{push_command, take_events, MemProbe};
use crate::source::{api_path, Req, Resp, Source};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

struct HttpSource {
    base: String,
}

async fn fetch_bytes(url: String) -> Result<Vec<u8>, String> {
    let win = web_sys::window().ok_or("no window")?;
    let resp = wasm_bindgen_futures::JsFuture::from(win.fetch_with_str(&url)).await.map_err(|e| format!("{e:?}"))?;
    let resp: web_sys::Response = resp.dyn_into().map_err(|_| "not a response")?;
    if !resp.ok() {
        return Err(format!("{url}: {}", resp.status()));
    }
    let buf =
        wasm_bindgen_futures::JsFuture::from(resp.array_buffer().map_err(|e| format!("{e:?}"))?).await.map_err(|e| format!("{e:?}"))?;
    Ok(js_sys::Uint8Array::new(&buf).to_vec())
}

impl Source for HttpSource {
    fn ask(&self, run: &str, req: Req, reply: crossbeam_channel::Sender<Resp>) {
        let url = format!("{}/{}", self.base.trim_end_matches('/'), api_path(run, &req));
        wasm_bindgen_futures::spawn_local(async move {
            let r = match fetch_bytes(url).await {
                Err(e) => Resp::Failed(req, e),
                Ok(b) => match req {
                    Req::Status => {
                        let v: serde_json::Value = serde_json::from_slice(&b).unwrap_or_default();
                        Resp::Status {
                            state: v["state"].as_str().unwrap_or("").into(),
                            message: v["message"].as_str().unwrap_or("").into(),
                            header: v["header"].as_bool().unwrap_or(false),
                        }
                    }
                    Req::World => Resp::World(String::from_utf8_lossy(&b).into_owned()),
                    Req::Track(n) => Resp::Track(n, b),
                    Req::Bin(name) => Resp::Bin(name, b),
                    Req::DayRow(name, d) => Resp::DayRow(name, d, b),
                    Req::Decided { from, to } => match serde_json::from_slice(&b) {
                        Ok(counts) => Resp::Decided { from, to, counts },
                        Err(e) => Resp::Failed(req, e.to_string()),
                    },
                },
            };
            let _ = reply.send(r);
        });
    }
    fn backend(&self) -> String {
        if cfg!(feature = "webgpu") {
            "WebGPU".into()
        } else {
            "WebGL 2".into()
        }
    }
}

fn wasm_memory() -> u64 {
    wasm_bindgen::memory()
        .dyn_into::<js_sys::WebAssembly::Memory>()
        .map(|m| m.buffer().dyn_into::<js_sys::ArrayBuffer>().map(|b| b.byte_length() as u64).unwrap_or(0))
        .unwrap_or(0)
}

/// Starts the scene in the canvas `#<canvas>`, reading runs from the server at `base` (its path prefix), on `run`.
#[wasm_bindgen]
pub fn start(canvas: String, base: String, run: String) {
    console_error_panic_hook::set_once();
    let src: Arc<dyn Source> = Arc::new(HttpSource { base });
    let mut app = crate::app(src, (!run.is_empty()).then_some(run), Some(format!("#{canvas}")));
    app.insert_resource(MemProbe(wasm_memory));
    app.run();
}

/// Any command, as JSON (bridge.rs `Command`).
#[wasm_bindgen]
pub fn send(json: &str) -> Result<(), JsValue> {
    push_command(Command::parse(json).map_err(|e| JsValue::from_str(&e))?);
    Ok(())
}
#[wasm_bindgen]
pub fn select(id: &str, fly: bool) {
    push_command(Command::Select { id: id.into(), fly });
}
#[wasm_bindgen]
pub fn set_time(t: f64) {
    push_command(Command::SetTime { t: t as i64 });
}
#[wasm_bindgen]
pub fn set_speed(x: f64) {
    push_command(Command::SetSpeed { x });
}
#[wasm_bindgen]
pub fn play(on: bool) {
    push_command(Command::Play { on });
}
#[wasm_bindgen]
pub fn set_overlay(name: &str, focus: Option<String>) {
    push_command(Command::SetOverlay { name: name.into(), focus });
}
#[wasm_bindgen]
pub fn load_run(id: &str) {
    push_command(Command::LoadRun { id: id.into() });
}
/// A camera command, as JSON (bridge.rs `CameraCmd`: `{"turn":{"quarter":1}}`, `{"zoom":{"factor":1.2}}`, `"iso"`).
#[wasm_bindgen]
pub fn camera(json: &str) -> Result<(), JsValue> {
    let c: CameraCmd = serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    push_command(Command::Camera(c));
    Ok(())
}
/// The events since the last call, as a JSON array (bridge.rs `Event`): hovered, selected, time_changed, ...
#[wasm_bindgen]
pub fn take_events_json() -> String {
    let evs = take_events();
    let mut s = String::from("[");
    for (i, e) in evs.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&e.to_json());
    }
    s.push(']');
    s
}
