//! The binary log (lane F; owner 2026-10-17: "compact, fast; JSONL as an export so tools keep working"): the same
//! hash-chained entries as the JSONL log (log.rs), stored compactly, with snapshots of the whole run among them.
//!
//! A file is a header and then frames, in the order written:
//! - **header**: `OIKOSBL1`, the seq of its first entry, the hash before it (zeros for a run's own log), and a JSON
//!   line saying what it is (for a fork: the log it carries on from, and from which entry);
//! - **entries** (`E`): a block of consecutive entries, compressed together: each its kind, its time, its hash (32
//!   bytes) and its body's canonical JSON. `prev` and `seq` are not stored: they follow from the order;
//! - **snapshot** (`S`): the whole run before entry `seq` (engine/snapshot.rs's bytes, compressed already).
//!
//! It is written by putting `BinLog` where the JSONL file would go: the log writer hands it each entry's canonical
//! line, and it keeps the parts (no change to the writer, the hash chain or what is hashed). `export_jsonl` writes the
//! lines back exactly, byte for byte, so `verify`, `replay` and every tool that reads JSONL read the export. A frame
//! is written whole or not at all: a run cut off loses at most the entries not yet in a block (`flush` writes them).
//!
//! Backward compatibility with old logs is not required (owner, 2026-10-17): JSONL logs stay readable as they are.

use crate::canon::ZERO_HASH;
use crate::log::Kind;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};

pub const MAGIC: &[u8; 8] = b"OIKOSBL1";
/// Entries are compressed together once this many bytes of them are waiting (and at every flush).
pub const BLOCK_BYTES: usize = 1 << 20;
const LEVEL: i32 = 3;

const KINDS: [Kind; 6] = [Kind::Header, Kind::Command, Kind::Event, Kind::Annotation, Kind::Checkpoint, Kind::End];
fn kind_byte(k: Kind) -> u8 {
    KINDS.iter().position(|x| *x == k).expect("every kind is listed") as u8
}
fn kind_name(k: Kind) -> &'static str {
    match k {
        Kind::Header => "header",
        Kind::Command => "command",
        Kind::Event => "event",
        Kind::Annotation => "annotation",
        Kind::Checkpoint => "checkpoint",
        Kind::End => "end",
    }
}

/// What a binary log says of itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct About {
    pub run_id: String,
    /// A fork's log: the log it carries on from (a path, relative to this file's directory), and the seq of its first
    /// entry there (the entries before it are the parent's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// One entry, as a line of the JSONL log is made of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parts<'a> {
    pub seq: u64,
    pub t: i64,
    pub kind: Kind,
    pub body: &'a [u8],
    pub hash: [u8; 32],
    pub prev: [u8; 32],
}

fn unhex(s: &[u8]) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        let d = |c: u8| (c as char).to_digit(16);
        *o = (d(s[2 * i])? * 16 + d(s[2 * i + 1])?) as u8;
    }
    Some(out)
}

fn hex(b: &[u8; 32]) -> String {
    crate::canon::to_hex(b)
}

fn rfind(h: &[u8], needle: &[u8]) -> Option<usize> {
    h.windows(needle.len()).rposition(|w| w == needle)
}

/// A JSONL log line (without its newline) taken apart: it ends `,"hash":"H","kind":"K","prev":"P","seq":S,"t":T}`
/// (log.rs writes it so), and its body is all before. `None`: not such a line.
pub fn parse_line(line: &[u8]) -> Option<Parts<'_>> {
    let l = line.strip_prefix(b"{\"body\":")?.strip_suffix(b"}")?;
    let ti = rfind(l, b",\"t\":")?;
    let t: i64 = std::str::from_utf8(&l[ti + 5..]).ok()?.parse().ok()?;
    let l = &l[..ti];
    let si = rfind(l, b",\"seq\":")?;
    let seq: u64 = std::str::from_utf8(&l[si + 7..]).ok()?.parse().ok()?;
    let l = &l[..si];
    // ,"prev":"<64>"
    let pi = l.len().checked_sub(64 + 10)?;
    if &l[pi..pi + 9] != b",\"prev\":\"" || l.last() != Some(&b'"') {
        return None;
    }
    let prev = unhex(&l[pi + 9..pi + 9 + 64])?;
    let l = &l[..pi];
    let ki = rfind(l, b",\"kind\":\"")?;
    let kname = l[ki + 9..].strip_suffix(b"\"")?;
    let kind = *KINDS.iter().find(|k| kind_name(**k).as_bytes() == kname)?;
    let l = &l[..ki];
    let hi = l.len().checked_sub(64 + 10)?;
    if &l[hi..hi + 9] != b",\"hash\":\"" || l.last() != Some(&b'"') {
        return None;
    }
    let hash = unhex(&l[hi + 9..hi + 9 + 64])?;
    Some(Parts { seq, t, kind, body: &l[..hi], hash, prev })
}

/// The line again, exactly as log.rs wrote it (with its newline).
pub fn write_line(p: &Parts, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"body\":");
    out.extend_from_slice(p.body);
    out.extend_from_slice(b",\"hash\":\"");
    out.extend_from_slice(hex(&p.hash).as_bytes());
    out.extend_from_slice(b"\",\"kind\":\"");
    out.extend_from_slice(kind_name(p.kind).as_bytes());
    out.extend_from_slice(b"\",\"prev\":\"");
    out.extend_from_slice(hex(&p.prev).as_bytes());
    out.extend_from_slice(format!("\",\"seq\":{},\"t\":{}}}\n", p.seq, p.t).as_bytes());
}

fn put_varint(mut x: u64, out: &mut Vec<u8>) {
    while x >= 0x80 {
        out.push((x as u8) | 0x80);
        x >>= 7;
    }
    out.push(x as u8);
}
fn get_varint(b: &[u8], at: &mut usize) -> Option<u64> {
    let mut x = 0u64;
    for shift in (0..64).step_by(7) {
        let c = *b.get(*at)?;
        *at += 1;
        x |= ((c & 0x7f) as u64) << shift;
        if c < 0x80 {
            return Some(x);
        }
    }
    None
}
fn zigzag(x: i64) -> u64 {
    ((x << 1) ^ (x >> 63)) as u64
}
fn unzigzag(x: u64) -> i64 {
    ((x >> 1) as i64) ^ -((x & 1) as i64)
}

/// The binary log's writer: put where the JSONL file would go (it is a `Write` that takes the log's lines).
pub struct BinLog<W: Write> {
    out: W,
    /// A line not yet ended.
    partial: Vec<u8>,
    block: Vec<u8>,
    block_first: u64,
    block_n: u32,
    block_t: (i64, i64),
    next_seq: u64,
    prev: [u8; 32],
    /// Bytes written so far (for whoever reports sizes).
    pub written: u64,
}

impl<W: Write> BinLog<W> {
    /// A run's own log, from its header entry.
    pub fn new(out: W, about: &About) -> io::Result<Self> {
        Self::from_entry(out, about, 0, ZERO_HASH)
    }

    /// A log that begins at entry `first_seq` of a run, the entry before it hashed `prev` (a resumed run's, or a
    /// fork's: `about.parent` says whose entries come before).
    pub fn from_entry(mut out: W, about: &About, first_seq: u64, prev: &str) -> io::Result<Self> {
        let prev = unhex(prev.as_bytes()).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "a log's hash is 64 hex digits"))?;
        let about = serde_json::to_vec(about).map_err(io::Error::other)?;
        let mut h = Vec::with_capacity(about.len() + 56);
        h.extend_from_slice(MAGIC);
        h.extend_from_slice(&first_seq.to_le_bytes());
        h.extend_from_slice(&prev);
        h.extend_from_slice(&(about.len() as u32).to_le_bytes());
        h.extend_from_slice(&about);
        out.write_all(&h)?;
        Ok(BinLog { out, partial: vec![], block: vec![], block_first: first_seq, block_n: 0, block_t: (0, 0), next_seq: first_seq, prev, written: h.len() as u64 })
    }

    fn entry(&mut self, line: &[u8]) -> io::Result<()> {
        let p = parse_line(line).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not a log line"))?;
        if p.seq != self.next_seq || p.prev != self.prev {
            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("entry {} out of order (expected {})", p.seq, self.next_seq)));
        }
        if self.block_n == 0 {
            self.block_first = p.seq;
            self.block_t.0 = p.t;
        }
        self.block_t.1 = p.t;
        self.block.push(kind_byte(p.kind));
        put_varint(zigzag(p.t), &mut self.block);
        self.block.extend_from_slice(&p.hash);
        put_varint(p.body.len() as u64, &mut self.block);
        self.block.extend_from_slice(p.body);
        self.block_n += 1;
        self.next_seq += 1;
        self.prev = p.hash;
        if self.block.len() >= BLOCK_BYTES {
            self.write_block()?;
        }
        Ok(())
    }

    fn write_block(&mut self) -> io::Result<()> {
        if self.block_n == 0 {
            return Ok(());
        }
        let packed = zstd::bulk::compress(&self.block, LEVEL)?;
        let mut f = Vec::with_capacity(packed.len() + 41);
        f.push(b'E');
        f.extend_from_slice(&self.block_first.to_le_bytes());
        f.extend_from_slice(&self.block_n.to_le_bytes());
        f.extend_from_slice(&self.block_t.0.to_le_bytes());
        f.extend_from_slice(&self.block_t.1.to_le_bytes());
        f.extend_from_slice(&(self.block.len() as u32).to_le_bytes());
        f.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        f.extend_from_slice(&packed);
        self.out.write_all(&f)?;
        self.written += f.len() as u64;
        self.block.clear();
        self.block_n = 0;
        Ok(())
    }

    /// A snapshot of the run before the next entry (engine/snapshot.rs's bytes): the entries before it are written
    /// out first, so frames stay in order.
    pub fn snapshot(&mut self, t: i64, bytes: &[u8]) -> io::Result<()> {
        if !self.partial.is_empty() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "a snapshot in the middle of an entry"));
        }
        self.write_block()?;
        let mut f = Vec::with_capacity(25);
        f.push(b'S');
        f.extend_from_slice(&self.next_seq.to_le_bytes());
        f.extend_from_slice(&t.to_le_bytes());
        f.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        self.out.write_all(&f)?;
        self.out.write_all(bytes)?;
        self.written += (f.len() + bytes.len()) as u64;
        Ok(())
    }

    /// The next entry's seq, and the hash before it.
    pub fn head(&self) -> (u64, String) {
        (self.next_seq, hex(&self.prev))
    }

    pub fn into_inner(mut self) -> io::Result<W> {
        self.write_block()?;
        self.out.flush()?;
        Ok(self.out)
    }
}

impl<W: Write> Write for BinLog<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut rest = buf;
        while let Some(nl) = rest.iter().position(|b| *b == b'\n') {
            if self.partial.is_empty() {
                self.entry(&rest[..nl])?;
            } else {
                self.partial.extend_from_slice(&rest[..nl]);
                let line = std::mem::take(&mut self.partial);
                self.entry(&line)?;
            }
            rest = &rest[nl + 1..];
        }
        self.partial.extend_from_slice(rest);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.write_block()?;
        self.out.flush()
    }
}

/// A frame of a binary log, as read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Entries { first_seq: u64, n: u32, t_first: i64, t_last: i64, at: usize },
    Snapshot { seq: u64, t: i64, at: usize, len: usize },
}

/// A binary log read: what it says of itself and where its frames are.
#[derive(Debug, Clone)]
pub struct Read<'a> {
    bytes: &'a [u8],
    pub about: About,
    pub first_seq: u64,
    pub prev: String,
    pub frames: Vec<Frame>,
    /// It ends inside a frame (a run cut off while writing one): what is before is whole.
    pub cut_short: bool,
}

fn bad(why: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("binary log: {why}"))
}

impl<'a> Read<'a> {
    pub fn of(bytes: &'a [u8]) -> io::Result<Read<'a>> {
        if bytes.len() < 52 || &bytes[..8] != MAGIC {
            return Err(bad("not a binary log"));
        }
        let first_seq = u64::from_le_bytes(bytes[8..16].try_into().expect("8"));
        let prev = hex(&bytes[16..48].try_into().expect("32"));
        let n = u32::from_le_bytes(bytes[48..52].try_into().expect("4")) as usize;
        let about: About = serde_json::from_slice(bytes.get(52..52 + n).ok_or_else(|| bad("header cut short"))?).map_err(|e| bad(&e.to_string()))?;
        let mut at = 52 + n;
        let mut frames = vec![];
        let mut cut_short = false;
        let u64_at = |i: usize| bytes.get(i..i + 8).map(|b| u64::from_le_bytes(b.try_into().expect("8")));
        let u32_at = |i: usize| bytes.get(i..i + 4).map(|b| u32::from_le_bytes(b.try_into().expect("4")));
        while at < bytes.len() {
            match bytes[at] {
                b'E' => {
                    let (Some(first_seq), Some(n), Some(t0), Some(t1), Some(_raw), Some(len)) =
                        (u64_at(at + 1), u32_at(at + 9), u64_at(at + 13), u64_at(at + 21), u32_at(at + 29), u32_at(at + 33))
                    else {
                        cut_short = true;
                        break;
                    };
                    if at + 37 + len as usize > bytes.len() {
                        cut_short = true;
                        break;
                    }
                    frames.push(Frame::Entries { first_seq, n, t_first: t0 as i64, t_last: t1 as i64, at });
                    at += 37 + len as usize;
                }
                b'S' => {
                    let (Some(seq), Some(t), Some(len)) = (u64_at(at + 1), u64_at(at + 9), u64_at(at + 17)) else {
                        cut_short = true;
                        break;
                    };
                    if at + 25 + len as usize > bytes.len() {
                        cut_short = true;
                        break;
                    }
                    frames.push(Frame::Snapshot { seq, t: t as i64, at: at + 25, len: len as usize });
                    at += 25 + len as usize;
                }
                _ => return Err(bad(&format!("an unknown frame at byte {at}"))),
            }
        }
        Ok(Read { bytes, about, first_seq, prev, frames, cut_short })
    }

    /// Every entry in order, as `f(parts)`, up to (not including) entry `until` if given.
    pub fn each(&self, until: Option<u64>, mut f: impl FnMut(&Parts) -> io::Result<()>) -> io::Result<()> {
        let mut prev = unhex(self.prev.as_bytes()).expect("hex");
        let mut seq = self.first_seq;
        for fr in &self.frames {
            let Frame::Entries { first_seq, n, at, .. } = fr else { continue };
            if *first_seq != seq {
                return Err(bad(&format!("entries from {first_seq} where {seq} was next")));
            }
            if until.is_some_and(|u| *first_seq >= u) {
                break;
            }
            let raw = u32::from_le_bytes(self.bytes[at + 29..at + 33].try_into().expect("4")) as usize;
            let len = u32::from_le_bytes(self.bytes[at + 33..at + 37].try_into().expect("4")) as usize;
            let block = zstd::bulk::decompress(&self.bytes[at + 37..at + 37 + len], raw).map_err(|e| bad(&e.to_string()))?;
            let mut i = 0;
            for _ in 0..*n {
                if until.is_some_and(|u| seq >= u) {
                    return Ok(());
                }
                let kind = *KINDS.get(*block.get(i).ok_or_else(|| bad("block cut short"))? as usize).ok_or_else(|| bad("unknown kind"))?;
                i += 1;
                let t = unzigzag(get_varint(&block, &mut i).ok_or_else(|| bad("block cut short"))?);
                let hash: [u8; 32] = block.get(i..i + 32).ok_or_else(|| bad("block cut short"))?.try_into().expect("32");
                i += 32;
                let blen = get_varint(&block, &mut i).ok_or_else(|| bad("block cut short"))? as usize;
                let body = block.get(i..i + blen).ok_or_else(|| bad("block cut short"))?;
                i += blen;
                f(&Parts { seq, t, kind, body, hash, prev })?;
                prev = hash;
                seq += 1;
            }
        }
        Ok(())
    }

    /// The JSONL log's lines for these entries (up to `until`), byte for byte.
    pub fn export(&self, until: Option<u64>, out: &mut dyn Write) -> io::Result<u64> {
        let mut line = Vec::with_capacity(4096);
        let mut n = 0;
        self.each(until, |p| {
            line.clear();
            write_line(p, &mut line);
            n += 1;
            out.write_all(&line)
        })?;
        Ok(n)
    }

    /// The snapshots it holds: (seq, t), in order.
    pub fn snapshots(&self) -> Vec<(u64, i64)> {
        self.frames.iter().filter_map(|f| if let Frame::Snapshot { seq, t, .. } = f { Some((*seq, *t)) } else { None }).collect()
    }

    /// The bytes of the last snapshot taken at or before `t` (any, if `t` is absent).
    pub fn snapshot_by(&self, t: Option<i64>) -> Option<(u64, &'a [u8])> {
        self.frames
            .iter()
            .filter_map(|f| if let Frame::Snapshot { seq, t: st, at, len } = f { Some((*seq, *st, *at, *len)) } else { None })
            .filter(|(_, st, ..)| t.is_none_or(|t| *st <= t))
            .last()
            .map(|(seq, _, at, len)| (seq, &self.bytes[at..at + len]))
    }
}

/// A binary log exported as JSONL, a fork's with the entries of the logs it carries on from first (each found by its
/// `about.parent`, relative to the directory of the log that names it): the whole run, from its header, as one log
/// that `verify` and `replay` read.
pub fn export_file(path: &std::path::Path, out: &mut dyn Write) -> io::Result<u64> {
    export_until(path, None, out)
}

fn export_until(path: &std::path::Path, until: Option<u64>, out: &mut dyn Write) -> io::Result<u64> {
    let bytes = std::fs::read(path)?;
    let r = Read::of(&bytes)?;
    let mut n = 0;
    if let Some(parent) = &r.about.parent {
        let p = path.parent().unwrap_or(std::path::Path::new(".")).join(parent);
        n += export_until(&p, Some(r.first_seq), out)?;
        if n != r.first_seq {
            return Err(bad(&format!("{} carries on from entry {} of {}, which has only {n}", path.display(), r.first_seq, p.display())));
        }
    } else if r.first_seq != 0 {
        return Err(bad("a log that does not begin at its header names no parent"));
    }
    n += r.export(until, out)?;
    Ok(n)
}

/// The run's config (canonical JSON), from the header of the log a binary log begins with (following its parents).
pub fn config_of(path: &std::path::Path) -> io::Result<Vec<u8>> {
    let bytes = std::fs::read(path)?;
    let r = Read::of(&bytes)?;
    if let Some(parent) = &r.about.parent {
        return config_of(&path.parent().unwrap_or(std::path::Path::new(".")).join(parent));
    }
    let mut config = None;
    r.each(Some(1), |p| {
        let v: serde_json::Value = serde_json::from_slice(p.body).map_err(|e| bad(&e.to_string()))?;
        config = Some(crate::canon::canonical_value(&v["config"]).map_err(|e| bad(&e.to_string()))?);
        Ok(())
    })?;
    config.ok_or_else(|| bad("no header"))
}

/// The last snapshot a binary log holds at or before `t` (any, if absent), read back with the run's config: the run
/// as it stood then, to resume or fork.
pub fn snapshot_in(path: &std::path::Path, t: Option<i64>) -> Result<crate::engine::Snapshot, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let r = Read::of(&bytes).map_err(|e| e.to_string())?;
    let (_, snap) = r.snapshot_by(t).ok_or("the log holds no snapshot by then")?;
    let head = crate::engine::Snapshot::head_of(snap)?;
    if head.config_elsewhere {
        let config = config_of(path).map_err(|e| e.to_string())?;
        crate::engine::Snapshot::from_bytes_with(snap, &config)
    } else {
        crate::engine::Snapshot::from_bytes(snap)
    }
}
