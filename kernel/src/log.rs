//! Hash-chained JSONL run log (contracts/log.schema.json).
//!
//! Each line is the canonical JSON of an entry. entry.hash = SHA-256 over
//! "oikos.log.v1\n" + canonical JSON of the entry without `hash`;
//! entry.prev = the previous entry's hash (64 zeros for the header). Every
//! `anchor_every` entries, and at the end, the head is also written to a
//! separate witness file.

use crate::canon::{self, ZERO_HASH};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;
use std::io::{self, Write};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Header,
    Command,
    Event,
    Annotation,
    Checkpoint,
    End,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub seq: u64,
    pub t: i64,
    pub kind: Kind,
    pub body: Value,
    pub prev: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    pub seq: u64,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_time: Option<String>,
}

pub fn entry_hash(seq: u64, t: i64, kind: Kind, body: &Value, prev: &str) -> Result<String, canon::CanonError> {
    let unhashed = json!({ "seq": seq, "t": t, "kind": kind, "body": body, "prev": prev });
    Ok(canon::hash_with_domain(canon::DOMAIN_LOG, &canon::canonical_value(&unhashed)?))
}

pub struct LogWriter<W: Write> {
    out: W,
    anchors: Option<Box<dyn Write>>,
    anchor_every: u64,
    next_seq: u64,
    prev: String,
}

impl<W: Write> LogWriter<W> {
    pub fn new(out: W, anchors: Option<Box<dyn Write>>, anchor_every: u64) -> Self {
        LogWriter { out, anchors, anchor_every: anchor_every.max(1), next_seq: 0, prev: ZERO_HASH.to_string() }
    }

    /// A log carried on from entry `next_seq`, the one before it hashed `prev` (a resumed or forked run).
    pub fn resume(out: W, anchors: Option<Box<dyn Write>>, anchor_every: u64, next_seq: u64, prev: &str) -> Self {
        LogWriter { out, anchors, anchor_every: anchor_every.max(1), next_seq, prev: prev.to_string() }
    }

    pub fn out_ref(&self) -> &W {
        &self.out
    }

    pub fn out_mut(&mut self) -> &mut W {
        &mut self.out
    }

    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    pub fn head(&self) -> &str {
        &self.prev
    }

    pub fn append(&mut self, t: i64, kind: Kind, body: Value) -> io::Result<Entry> {
        let err = |e: canon::CanonError| io::Error::new(io::ErrorKind::InvalidData, e.to_string());
        let body_bytes = canon::canonical_value(&body).map_err(err)?;
        let (seq, prev) = (self.next_seq, self.prev.clone());
        let hash = self.append_canonical(t, kind, &body_bytes)?;
        debug_assert_eq!(Ok(&hash), entry_hash(seq, t, kind, &body, &prev).as_ref());
        Ok(Entry { seq, t, kind, body, prev, hash })
    }

    /// `append`, for a body in a shape of its own: its canonical bytes are written from it (`canon::canonical`: what
    /// its JSON value's would be), with no JSON value made of it on the way. Returns the entry's seq and its body's
    /// canonical bytes.
    pub fn append_as<T: Serialize + ?Sized>(&mut self, t: i64, kind: Kind, body: &T) -> io::Result<(u64, Vec<u8>)> {
        let bytes = canon::canonical(body).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        let seq = self.next_seq;
        self.append_canonical(t, kind, &bytes)?;
        Ok((seq, bytes))
    }

    /// `append`, for a body whose canonical JSON the caller has (and vouches for). The hashed form and the written
    /// line are both made of it, part by part, and neither is put together first: a large body (the header's, with
    /// its config) is held once. Keys in canonical order: body, hash, kind, prev, seq, t. Returns the entry's hash.
    /// (Byte-identical to canonicalising the whole entry; see entry_hash and the tests.)
    pub fn append_canonical(&mut self, t: i64, kind: Kind, body: &[u8]) -> io::Result<String> {
        use sha2::{Digest, Sha256};
        let kind_name = serde_json::to_value(kind).expect("kinds serialize");
        let mut tail = Vec::with_capacity(160);
        tail.extend_from_slice(b",\"kind\":");
        canon::write_string(kind_name.as_str().expect("kind is a string"), &mut tail);
        tail.extend_from_slice(b",\"prev\":");
        canon::write_string(&self.prev, &mut tail);
        tail.extend_from_slice(format!(",\"seq\":{},\"t\":{t}}}\n", self.next_seq).as_bytes());
        // (Hashed: the entry without `hash`, and without the line's end.)
        let mut h = Sha256::new();
        h.update(canon::DOMAIN_LOG.as_bytes());
        h.update(b"{\"body\":");
        h.update(body);
        h.update(&tail[..tail.len() - 1]);
        let hash = canon::to_hex(&h.finalize());
        let mut after = Vec::with_capacity(tail.len() + 80);
        after.extend_from_slice(b",\"hash\":");
        canon::write_string(&hash, &mut after);
        after.extend_from_slice(&tail);
        self.out.write_all(b"{\"body\":")?;
        self.out.write_all(body)?;
        self.out.write_all(&after)?;
        self.next_seq += 1;
        self.prev = hash.clone();
        if self.next_seq % self.anchor_every == 0 {
            self.anchor()?;
        }
        Ok(hash)
    }

    /// Export the current head to the witness file.
    pub fn anchor(&mut self) -> io::Result<()> {
        if self.next_seq == 0 {
            return Ok(());
        }
        if let Some(a) = self.anchors.as_mut() {
            let anchor = Anchor { seq: self.next_seq - 1, hash: self.prev.clone(), wall_time: None };
            let mut line = canon::canonical(&anchor).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
            line.push(b'\n');
            a.write_all(&line)?;
            a.flush()?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }

    pub fn into_inner(self) -> W {
        self.out
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyError {
    /// 0-based line number in the log (or the anchors file, for anchor errors).
    pub line: usize,
    pub reason: String,
}

impl fmt::Display for VerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line + 1, self.reason)
    }
}

impl std::error::Error for VerifyError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub entries: Vec<Entry>,
    pub head: String,
    /// The log ends with an `end` entry.
    pub complete: bool,
    pub anchors_checked: usize,
}

/// Split a log into lines, requiring a trailing newline on each.
pub fn lines(bytes: &[u8]) -> Vec<&[u8]> {
    let mut v: Vec<&[u8]> = bytes.split(|b| *b == b'\n').collect();
    if v.last().is_some_and(|l| l.is_empty()) {
        v.pop();
    }
    v
}

/// Verify the whole chain, and the witness anchors if given.
pub fn verify(log: &[u8], anchors: Option<&[u8]>) -> Result<Verified, VerifyError> {
    let fail = |line: usize, reason: String| VerifyError { line, reason };
    if !log.is_empty() && !log.ends_with(b"\n") {
        return Err(fail(lines(log).len().saturating_sub(1), "log does not end with a newline (truncated?)".into()));
    }
    let mut entries = Vec::new();
    let mut prev = ZERO_HASH.to_string();
    let mut ended = false;
    for (i, raw) in lines(log).into_iter().enumerate() {
        let v: Value = serde_json::from_slice(raw).map_err(|e| fail(i, format!("not JSON: {e}")))?;
        let canonical = canon::canonical_value(&v).map_err(|e| fail(i, e.to_string()))?;
        if canonical != raw {
            return Err(fail(i, "entry is not in canonical form".into()));
        }
        let e: Entry = serde_json::from_value(v).map_err(|e| fail(i, format!("not a log entry: {e}")))?;
        if e.seq != i as u64 {
            return Err(fail(i, format!("seq {} where {} was expected", e.seq, i)));
        }
        if ended {
            return Err(fail(i, "entry after the end entry".into()));
        }
        if (i == 0) != (e.kind == Kind::Header) {
            return Err(fail(i, "the header must be the first entry and only the first".into()));
        }
        if e.prev != prev {
            return Err(fail(i, "prev does not match the previous entry's hash".into()));
        }
        let expect = entry_hash(e.seq, e.t, e.kind, &e.body, &e.prev).map_err(|x| fail(i, x.to_string()))?;
        if e.hash != expect {
            return Err(fail(i, "hash does not match the entry's contents".into()));
        }
        if e.kind == Kind::End {
            ended = true;
        }
        prev = e.hash.clone();
        entries.push(e);
    }
    if entries.is_empty() {
        return Err(fail(0, "empty log".into()));
    }
    let mut anchors_checked = 0;
    if let Some(a) = anchors {
        for (i, raw) in lines(a).into_iter().enumerate() {
            let anchor: Anchor = serde_json::from_slice(raw).map_err(|e| fail(i, format!("anchors: not an anchor: {e}")))?;
            let Some(entry) = entries.get(anchor.seq as usize) else {
                return Err(fail(
                    i,
                    format!("anchors: witness names entry {} but the log has only {} (truncated?)", anchor.seq, entries.len()),
                ));
            };
            if entry.hash != anchor.hash {
                return Err(fail(i, format!("anchors: entry {} does not match its witnessed hash (history rewritten?)", anchor.seq)));
            }
            anchors_checked += 1;
        }
    }
    Ok(Verified { head: prev, complete: ended, anchors_checked, entries })
}
