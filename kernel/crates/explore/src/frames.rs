//! The kept lines of a run, held compactly: finished frames of `FRAME_LINES` lines are zstd-compressed, the open frame
//! is plain, and a few decompressed frames are cached, so memory stays bounded however long the log (the TS index's
//! `frames.bin`, in memory).

use std::sync::{Arc, Mutex};

pub const FRAME_LINES: usize = 4096;
const CACHE: usize = 24;
const LEVEL: i32 = 3;

#[derive(Default)]
pub struct FrameStore {
    /// (raw length, compressed bytes) of each finished frame.
    frames: Vec<(usize, Vec<u8>)>,
    open: Vec<String>,
    cache: Mutex<Vec<(usize, Arc<Vec<String>>)>>,
}

impl FrameStore {
    pub fn len(&self) -> usize {
        self.frames.len() * FRAME_LINES + self.open.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn push(&mut self, line: String) {
        self.open.push(line);
        if self.open.len() == FRAME_LINES {
            let raw = self.open.join("\n");
            let packed = zstd::bulk::compress(raw.as_bytes(), LEVEL).expect("zstd compress");
            self.frames.push((raw.len(), packed));
            self.open.clear();
        }
    }
    /// The compressed bytes held and the plain bytes of the open frame (a measure of memory).
    pub fn bytes_held(&self) -> usize {
        self.frames.iter().map(|f| f.1.len()).sum::<usize>() + self.open.iter().map(|l| l.len()).sum::<usize>()
    }
    pub fn frames(&self) -> usize {
        self.frames.len() + usize::from(!self.open.is_empty())
    }
    /// A kept line's text by its ordinal.
    pub fn text(&self, ord: usize) -> Option<String> {
        let f = ord / FRAME_LINES;
        if f == self.frames.len() {
            return self.open.get(ord % FRAME_LINES).cloned();
        }
        if f > self.frames.len() {
            return None;
        }
        let lines = {
            let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(pos) = c.iter().position(|(k, _)| *k == f) {
                let hit = c.remove(pos);
                let v = hit.1.clone();
                c.push(hit);
                v
            } else {
                let (raw, packed) = &self.frames[f];
                let bytes = zstd::bulk::decompress(packed, *raw).ok()?;
                let text = String::from_utf8(bytes).ok()?;
                let v = Arc::new(text.split('\n').map(String::from).collect::<Vec<_>>());
                c.push((f, v.clone()));
                if c.len() > CACHE {
                    c.remove(0);
                }
                v
            }
        };
        lines.get(ord % FRAME_LINES).cloned()
    }
}
