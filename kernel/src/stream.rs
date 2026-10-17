//! The live event stream (lane F): every log entry, as it is written, for whoever watches a run while it goes (a viewer
//! indexing it live, a dashboard, a researcher's tool). It is the log itself, not a second account of the run: `Tee`
//! stands where the log's file would and hands each complete line on to the file and to the stream.
//!
//! The stream is pulled (`Stream::take`), never pushed into a reader's code, so a slow reader cannot slow the run or
//! change it: it holds at most `cap` lines, and one that falls further behind is told how many it missed. Nothing in
//! the world reads it. Which kinds of entry it keeps is the watcher's choice (`kinds`).

use crate::blog::parse_line;
use crate::log::Kind;
use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};

/// What a watcher has not yet taken.
#[derive(Debug, Default)]
pub struct Waiting {
    pub lines: VecDeque<Vec<u8>>,
    /// Lines dropped because the watcher fell more than `cap` behind, since it last took.
    pub missed: u64,
}

#[derive(Debug, Clone)]
pub struct Stream {
    inner: Arc<Mutex<Waiting>>,
    cap: usize,
    /// Kinds kept (empty: every kind).
    kinds: Vec<Kind>,
}

impl Stream {
    pub fn new(cap: usize, kinds: Vec<Kind>) -> Self {
        Stream { inner: Arc::default(), cap: cap.max(1), kinds }
    }

    fn push(&self, line: &[u8]) {
        if !self.kinds.is_empty() {
            match parse_line(line) {
                Some(p) if self.kinds.contains(&p.kind) => {}
                _ => return,
            }
        }
        let mut w = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if w.lines.len() >= self.cap {
            w.lines.pop_front();
            w.missed += 1;
        }
        w.lines.push_back(line.to_vec());
    }

    /// Up to `max` lines in the order written (each a log entry's canonical JSON, without its newline), and how many
    /// were missed before them.
    pub fn take(&self, max: usize) -> (Vec<Vec<u8>>, u64) {
        let mut w = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let n = max.min(w.lines.len());
        let lines = w.lines.drain(..n).collect();
        (lines, std::mem::take(&mut w.missed))
    }
}

/// A log's writer that also hands each line to a stream.
pub struct Tee<W: Write> {
    out: W,
    stream: Option<Stream>,
    partial: Vec<u8>,
}

impl<W: Write> Tee<W> {
    pub fn new(out: W, stream: Option<Stream>) -> Self {
        Tee { out, stream, partial: vec![] }
    }
    pub fn stream(&self) -> Option<&Stream> {
        self.stream.as_ref()
    }
    pub fn set_stream(&mut self, s: Option<Stream>) {
        self.stream = s;
    }
    pub fn inner(&mut self) -> &mut W {
        &mut self.out
    }
    pub fn into_inner(self) -> W {
        self.out
    }
}

impl<W: Write> Write for Tee<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.out.write_all(buf)?;
        if let Some(s) = &self.stream {
            let mut rest = buf;
            while let Some(nl) = rest.iter().position(|b| *b == b'\n') {
                if self.partial.is_empty() {
                    s.push(&rest[..nl]);
                } else {
                    self.partial.extend_from_slice(&rest[..nl]);
                    s.push(&self.partial);
                    self.partial.clear();
                }
                rest = &rest[nl + 1..];
            }
            self.partial.extend_from_slice(rest);
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }
}
