//! Records as they are held (docs/design/tiered-storage.md): in memory while they are read, and on disk once they are
//! cold, read back when they are asked for.
//!
//! A record is immutable once filed. Every holder of one (the world's store, perception's index, what was delivered, the
//! actors' books) holds a `Rec`: a handle to the record's one slot, shared by all of them. The slot holds the record in
//! memory (hot) or says where its canonical bytes are in the run's cold file (cold), or both. A `Tier` (the kernel's)
//! moves records out of memory when they have been filed long enough and nobody has read them for a while
//! (`Policy`); reading one (`Rec::load`) brings it back. What a record is never depends on where it is held: its bytes
//! on disk are exactly its canonical bytes, read back to the same record, so nothing anyone sees, logs or hashes changes
//! (`Rec::write_canonical` writes a cold one's bytes as they are, without reading it back). Disk decides nothing: a
//! failure to read the cold file back stops the run.

use crate::blocks::{Id, Record};
use oikos_core::canon::{self, CanonError};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

/// A record, as held: cheap to clone (one shared slot), read with `load`.
#[derive(Clone)]
pub struct Rec(Arc<Slot>);

struct Slot {
    /// The record in memory, while it is (hot).
    hot: RwLock<Option<Arc<Record>>>,
    /// Where its canonical bytes are on disk, once they have been written there (they never move).
    cold: OnceLock<ColdAt>,
    /// Read since the tier last looked (`Tier::pass`).
    touched: AtomicBool,
    /// When it was made (the record's `at`): what a reader that goes by time asks, without reading the record.
    at: i64,
}

struct ColdAt {
    file: Arc<ColdFile>,
    block: u32,
    index: u32,
    /// Its place in its tier (`Tier::slots`), for a record read back into memory to be looked at again.
    place: u32,
}

/// A lock's guard, whatever became of another holder (what is kept behind these is only ever whole).
fn held<T>(lock: Result<T, std::sync::PoisonError<T>>) -> T {
    lock.unwrap_or_else(|e| e.into_inner())
}

impl Rec {
    pub fn new(r: Record) -> Rec {
        Rec::from_arc(Arc::new(r))
    }

    /// A record already shared (the config's, at the start): the same one is held, not a copy.
    pub fn from_arc(r: Arc<Record>) -> Rec {
        let at = r.at;
        Rec(Arc::new(Slot { hot: RwLock::new(Some(r)), cold: OnceLock::new(), touched: AtomicBool::new(false), at }))
    }

    /// The record, read: from memory, or back from disk (and then held in memory again, until its tier finds it cold
    /// again). Marks it read.
    pub fn load(&self) -> Arc<Record> {
        if !self.0.touched.load(Ordering::Relaxed) {
            self.0.touched.store(true, Ordering::Relaxed);
            if who::on() {
                who::count(&self.peek());
            }
        }
        if let Some(r) = held(self.0.hot.read()).as_ref() {
            return r.clone();
        }
        let at = self.0.cold.get().expect("a record neither in memory nor on disk");
        let r = Arc::new(at.file.record(at.block, at.index));
        let mut hot = held(self.0.hot.write());
        // (Read back by another meanwhile: theirs is kept, and given.)
        if let Some(r) = hot.as_ref() {
            return r.clone();
        }
        *hot = Some(r.clone());
        drop(hot);
        held(at.file.warmed.lock()).push(at.place);
        r
    }

    /// The record, without marking it read or holding it in memory again (for writing the state out, and comparing).
    pub fn peek(&self) -> Arc<Record> {
        if let Some(r) = held(self.0.hot.read()).as_ref() {
            return r.clone();
        }
        let at = self.0.cold.get().expect("a record neither in memory nor on disk");
        Arc::new(at.file.record(at.block, at.index))
    }

    /// When it was made (its `at`), without reading it.
    pub fn at(&self) -> i64 {
        self.0.at
    }

    /// Its id (read without marking it read).
    pub fn id(&self) -> Id {
        self.peek().id
    }

    /// Whether it is in memory now.
    pub fn is_hot(&self) -> bool {
        held(self.0.hot.read()).is_some()
    }

    /// The same slot: the same record, held by both.
    pub fn same(&self, other: &Rec) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    /// Where its slot is in memory: the same for every holder of it, and never another record's while it is held.
    pub fn addr(&self) -> usize {
        Arc::as_ptr(&self.0) as *const u8 as usize
    }

    /// Its canonical bytes (`canon::canonical` of the record), appended to `out`: a cold record's as they are on disk,
    /// without making the record again.
    pub fn write_canonical(&self, out: &mut Vec<u8>) -> Result<(), CanonError> {
        if let Some(r) = held(self.0.hot.read()).as_ref() {
            out.extend_from_slice(&canon::canonical(&**r)?);
            return Ok(());
        }
        let at = self.0.cold.get().expect("a record neither in memory nor on disk");
        at.file.with_bytes(at.block, at.index, |b| out.extend_from_slice(b));
        Ok(())
    }
}

impl std::fmt::Debug for Rec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.peek().fmt(f)
    }
}

impl PartialEq for Rec {
    fn eq(&self, other: &Rec) -> bool {
        self.same(other) || *self.peek() == *other.peek()
    }
}
impl Eq for Rec {}

impl Serialize for Rec {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.peek().serialize(s)
    }
}

impl<'de> Deserialize<'de> for Rec {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Record::deserialize(d).map(Rec::new)
    }
}

/// For whoever measures (`OIKOS_COLD_WHO`): who keeps the world's records in memory, by reading them. Each first read
/// of a record since the tier last looked is counted, by who read it (the kind of actor the engine is stepping on this
/// thread, `reading_as`; else the kernel) and the record's kind. Nothing reads these counts but a person measuring.
pub mod who {
    use super::held;
    use crate::blocks::{Record, RecordBody};
    use std::cell::Cell;
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::{Mutex, OnceLock};

    static ON: OnceLock<bool> = OnceLock::new();
    static NAMES: Mutex<BTreeSet<&'static str>> = Mutex::new(BTreeSet::new());
    static COUNTS: Mutex<BTreeMap<(&'static str, &'static str), u64>> = Mutex::new(BTreeMap::new());
    thread_local! {
        static READER: Cell<&'static str> = const { Cell::new("kernel") };
    }

    pub fn on() -> bool {
        *ON.get_or_init(|| std::env::var_os("OIKOS_COLD_WHO").is_some())
    }

    fn name(s: &str) -> &'static str {
        let mut names = held(NAMES.lock());
        if let Some(n) = names.get(s) {
            return n;
        }
        let n: &'static str = Box::leak(s.to_string().into_boxed_str());
        names.insert(n);
        n
    }

    /// Reads on this thread are `who`'s until the guard goes.
    pub struct ReadingAs(&'static str);
    pub fn reading_as(who: &str) -> Option<ReadingAs> {
        on().then(|| ReadingAs(READER.with(|r| r.replace(name(who)))))
    }
    impl Drop for ReadingAs {
        fn drop(&mut self) {
            READER.with(|r| r.set(self.0));
        }
    }

    /// The day the tier last looked (records read that were filed a fortnight before it are counted apart, as old).
    static TODAY: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
    pub(super) fn set_day(day: i64) {
        TODAY.store(day, std::sync::atomic::Ordering::Relaxed);
    }

    pub(super) fn count(r: &Record) {
        let kind = match &r.body {
            RecordBody::Statement { kind, .. } => kind.text(),
            b => b.kind_name(),
        };
        let old = TODAY.load(std::sync::atomic::Ordering::Relaxed) - r.at.div_euclid(86_400) >= 14;
        let kind = if old { name(&format!("{kind} (old)")) } else { kind };
        let who = READER.with(Cell::get);
        *held(COUNTS.lock()).entry((who, kind)).or_default() += 1;
        // (And where in the code, for one reader named by OIKOS_COLD_WHO_STACK: the actors' frames that read it.)
        static STACK_OF: OnceLock<Option<String>> = OnceLock::new();
        if old && STACK_OF.get_or_init(|| std::env::var("OIKOS_COLD_WHO_STACK").ok()).as_deref().is_some_and(|l| l.split(',').any(|w| w == who)) {
            let bt = std::backtrace::Backtrace::force_capture().to_string();
            let frames: Vec<&str> = bt
                .lines()
                .map(str::trim)
                .filter(|l| (l.contains("oikos_actors::") || l.contains("oikos_sight::") || l.contains("oikos_kernel::")) && !l.contains("held::"))
                .map(|l| l.split_once(": ").map_or(l, |(_, f)| f))
                .take(5)
                .collect();
            let at = name(&format!("{kind} @ {}", frames.join(" < ")));
            *held(COUNTS.lock()).entry((who, at)).or_default() += 1;
        }
    }

    /// The counts so far, the largest first.
    pub fn counts() -> Vec<(String, String, u64)> {
        let mut v: Vec<(String, String, u64)> = held(COUNTS.lock()).iter().map(|((w, k), n)| (w.to_string(), k.to_string(), *n)).collect();
        v.sort_by(|a, b| b.2.cmp(&a.2));
        v
    }
}

// ------------------------------------------------------------------------------------------------ the cold file

/// The run's cold records: blocks of records' canonical bytes, each compressed, appended to one file and never edited.
/// Removed when nothing refers to it any more (the run is over).
pub struct ColdFile {
    path: PathBuf,
    file: Mutex<File>,
    /// Each block's (offset, compressed length).
    blocks: RwLock<Vec<(u64, u32)>>,
    /// Blocks read lately, decompressed, the latest last (bounded by `CACHED_BYTES`).
    cache: Mutex<VecDeque<(u32, Arc<Block>)>>,
    /// Places (in the tier) of records read back into memory since the tier last looked.
    warmed: Mutex<Vec<u32>>,
    /// Records read back from disk, ever (for whoever measures).
    pub reads: AtomicU64,
}

/// A block as it is read: its records' canonical bytes, one after another, and where each ends.
struct Block {
    bytes: Vec<u8>,
    ends: Vec<u32>,
}

impl Block {
    fn get(&self, i: u32) -> &[u8] {
        let start = if i == 0 { 0 } else { self.ends[i as usize - 1] as usize };
        &self.bytes[start..self.ends[i as usize] as usize]
    }
    fn size(&self) -> usize {
        self.bytes.len() + self.ends.len() * 4
    }
}

/// How many bytes of decompressed blocks are kept for reading again.
const CACHED_BYTES: usize = 8 << 20;
/// How many records go in a block at most, and how many bytes (before compression).
const BLOCK_RECORDS: usize = 64;
const BLOCK_BYTES: usize = 32 << 10;
/// The compression level (zstd's output is the same for the same input and level; it decides nothing here).
const LEVEL: i32 = 3;

impl ColdFile {
    fn create(path: &Path) -> std::io::Result<ColdFile> {
        let file = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(true).open(path)?;
        Ok(ColdFile {
            path: path.to_path_buf(),
            file: Mutex::new(file),
            blocks: RwLock::new(vec![]),
            cache: Mutex::new(VecDeque::new()),
            warmed: Mutex::new(vec![]),
            reads: AtomicU64::new(0),
        })
    }

    /// Writes a block of records' canonical bytes (or of any other things' bytes, one after another: an office's file
    /// of payments); returns its number.
    pub fn append(&self, records: &[Vec<u8>]) -> std::io::Result<u32> {
        let mut raw = Vec::with_capacity(4 + records.len() * 4 + records.iter().map(Vec::len).sum::<usize>());
        raw.extend_from_slice(&(records.len() as u32).to_le_bytes());
        let mut end = 0u32;
        for r in records {
            end += r.len() as u32;
            raw.extend_from_slice(&end.to_le_bytes());
        }
        for r in records {
            raw.extend_from_slice(r);
        }
        let packed = zstd::bulk::compress(&raw, LEVEL)?;
        let mut file = held(self.file.lock());
        let at = file.seek(SeekFrom::End(0))?;
        file.write_all(&packed)?;
        let mut blocks = held(self.blocks.write());
        blocks.push((at, packed.len() as u32));
        Ok(blocks.len() as u32 - 1)
    }

    fn block(&self, n: u32) -> Arc<Block> {
        if let Some((_, b)) = held(self.cache.lock()).iter().rev().find(|(k, _)| *k == n) {
            return b.clone();
        }
        let (at, len) = held(self.blocks.read())[n as usize];
        let mut packed = vec![0u8; len as usize];
        {
            let mut file = held(self.file.lock());
            let read = file.seek(SeekFrom::Start(at)).and_then(|_| file.read_exact(&mut packed));
            if let Err(e) = read {
                panic!("the cold records' file {} could not be read back: {e}", self.path.display());
            }
        }
        let raw = zstd::decode_all(&packed[..]).unwrap_or_else(|e| panic!("a block of {} could not be decompressed: {e}", self.path.display()));
        let count = u32::from_le_bytes(raw[0..4].try_into().expect("four bytes")) as usize;
        let ends: Vec<u32> = (0..count).map(|i| u32::from_le_bytes(raw[4 + i * 4..8 + i * 4].try_into().expect("four bytes"))).collect();
        let bytes = raw[4 + count * 4..].to_vec();
        let b = Arc::new(Block { bytes, ends });
        let mut cache = held(self.cache.lock());
        if !cache.iter().any(|(k, _)| *k == n) {
            cache.push_back((n, b.clone()));
            let mut size: usize = cache.iter().map(|(_, b)| b.size()).sum();
            while size > CACHED_BYTES && cache.len() > 1 {
                if let Some((_, gone)) = cache.pop_front() {
                    size -= gone.size();
                }
            }
        }
        b
    }

    /// Every item of a block, as written (`append`), in order.
    pub fn items(&self, block: u32) -> Vec<Vec<u8>> {
        let b = self.block(block);
        (0..b.ends.len() as u32).map(|i| b.get(i).to_vec()).collect()
    }

    fn with_bytes<T>(&self, block: u32, index: u32, f: impl FnOnce(&[u8]) -> T) -> T {
        let b = self.block(block);
        f(b.get(index))
    }

    fn record(&self, block: u32, index: u32) -> Record {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.with_bytes(block, index, |b| serde_json::from_slice(b))
            .unwrap_or_else(|e| panic!("a record in {} could not be read back: {e}", self.path.display()))
    }

    /// Its size on disk.
    pub fn len(&self) -> u64 {
        held(self.blocks.read()).last().map_or(0, |(at, n)| at + u64::from(*n))
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Drop for ColdFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// ------------------------------------------------------------------------------------------------ the tier

/// When a record is cold: filed `after_days` ago or more, and not read for `idle_days`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub after_days: i64,
    pub idle_days: i64,
}

impl Default for Policy {
    fn default() -> Self {
        Policy { after_days: 30, idle_days: 14 }
    }
}

impl Policy {
    /// The default, or as `OIKOS_COLD_AFTER_DAYS` and `OIKOS_COLD_IDLE_DAYS` say (a test moves records out after a day).
    pub fn from_env() -> Policy {
        let days = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<i64>().ok()).filter(|d| *d >= 0);
        let d = Policy::default();
        Policy { after_days: days("OIKOS_COLD_AFTER_DAYS").unwrap_or(d.after_days), idle_days: days("OIKOS_COLD_IDLE_DAYS").unwrap_or(d.idle_days) }
    }
}

/// What a pass did, and what is held (for whoever measures).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tally {
    pub records: u64,
    pub hot: u64,
    /// Moved to disk in this pass, and written there for the first time.
    pub cooled: u64,
    pub written: u64,
    /// Read back from disk since the run began.
    pub reads: u64,
    pub disk_bytes: u64,
}

/// The kernel's tier of records: every record of the world's store, in the order filed, with when each was last read (in
/// days; when it was made its slot knows), and the run's cold file. Off (no file): every record stays in memory, as before.
pub struct Tier {
    file: Option<Arc<ColdFile>>,
    policy: Policy,
    slots: Vec<Rec>,
    last: Vec<i32>,
    /// Places of the records that may be in memory.
    hot: Vec<u32>,
    pub tally: Tally,
}

impl Default for Tier {
    fn default() -> Self {
        Tier::off()
    }
}

impl Tier {
    pub fn off() -> Tier {
        Tier { file: None, policy: Policy::default(), slots: vec![], last: vec![], hot: vec![], tally: Tally::default() }
    }

    /// A tier whose cold file is `path` (made anew; removed when the run is over).
    pub fn on(path: &Path, policy: Policy) -> std::io::Result<Tier> {
        Ok(Tier { file: Some(Arc::new(ColdFile::create(path)?)), ..Tier::off() }.with_policy(policy))
    }

    fn with_policy(mut self, policy: Policy) -> Tier {
        self.policy = policy;
        self
    }

    /// The run's cold file, if the tier is on (for an office's file of payments held there too).
    pub fn file(&self) -> Option<Arc<ColdFile>> {
        self.file.clone()
    }

    pub fn is_on(&self) -> bool {
        self.file.is_some()
    }

    pub fn policy(&self) -> Policy {
        self.policy
    }

    /// How many records it holds (every record filed, once it has been told of them).
    pub fn len(&self) -> usize {
        self.slots.len()
    }
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// A record filed on `day` (in the order filed).
    pub fn add(&mut self, r: &Rec, day: i64) {
        if self.file.is_none() {
            return;
        }
        let day = day as i32;
        self.hot.push(self.slots.len() as u32);
        self.slots.push(r.clone());
        self.last.push(day);
    }

    /// Looks at every record that may be in memory on `day`: one read since it last looked was read today; one that
    /// is cold (`Policy`) is written to disk if it is not there yet, and let go of in memory.
    pub fn pass(&mut self, day: i64) -> std::io::Result<Tally> {
        let Some(file) = self.file.clone() else { return Ok(self.tally) };
        let today = day as i32;
        who::set_day(day);
        let mut hot = std::mem::take(&mut self.hot);
        hot.append(&mut *held(file.warmed.lock()));
        hot.sort_unstable();
        hot.dedup();
        let mut keep: Vec<u32> = Vec::with_capacity(hot.len());
        let mut cool: Vec<u32> = vec![];
        for i in hot {
            let slot = &self.slots[i as usize].0;
            if slot.touched.swap(false, Ordering::Relaxed) {
                self.last[i as usize] = today;
            }
            if held(slot.hot.read()).is_none() {
                continue;
            }
            // (Filed on the day its record was made: the slot knows when.)
            let filed = slot.at.div_euclid(86_400);
            let ready = i64::from(today) - filed >= self.policy.after_days && i64::from(today - self.last[i as usize]) >= self.policy.idle_days;
            if ready {
                cool.push(i);
            } else {
                keep.push(i);
            }
        }
        // Written (those never written before), a block at a time, then let go of.
        let mut written = 0u64;
        let mut pending: Vec<(u32, Vec<u8>)> = vec![];
        let mut size = 0usize;
        let flush = |pending: &mut Vec<(u32, Vec<u8>)>, size: &mut usize| -> std::io::Result<()> {
            if pending.is_empty() {
                return Ok(());
            }
            let bytes: Vec<Vec<u8>> = pending.iter_mut().map(|(_, b)| std::mem::take(b)).collect();
            let block = file.append(&bytes)?;
            for (index, (place, _)) in pending.iter().enumerate() {
                let slot = &self.slots[*place as usize].0;
                let _ = slot.cold.set(ColdAt { file: file.clone(), block, index: index as u32, place: *place });
            }
            pending.clear();
            *size = 0;
            Ok(())
        };
        for &i in &cool {
            let slot = &self.slots[i as usize].0;
            if slot.cold.get().is_some() {
                continue;
            }
            let r = held(slot.hot.read()).clone().expect("hot");
            let bytes = canon::canonical(&*r).map_err(|e| std::io::Error::other(e.to_string()))?;
            #[cfg(debug_assertions)]
            {
                let back: Record = serde_json::from_slice(&bytes).expect("a record's canonical bytes read back");
                assert_eq!(back, *r, "a record read back from its canonical bytes is not the record");
            }
            size += bytes.len();
            pending.push((i, bytes));
            written += 1;
            if pending.len() >= BLOCK_RECORDS || size >= BLOCK_BYTES {
                flush(&mut pending, &mut size)?;
            }
        }
        flush(&mut pending, &mut size)?;
        for &i in &cool {
            let slot = &self.slots[i as usize].0;
            *held(slot.hot.write()) = None;
        }
        self.hot = keep;
        self.tally = Tally {
            records: self.slots.len() as u64,
            hot: self.hot.len() as u64,
            cooled: cool.len() as u64,
            written,
            reads: file.reads.load(Ordering::Relaxed),
            disk_bytes: file.len(),
        };
        Ok(self.tally)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(i: u64) -> Rec {
        let v = serde_json::json!({ "id": format!("rec.{i}"), "author": "p1", "at": (i / 100) as i64 * 86_400, "visible_to": "public", "record": "statement", "kind": "note", "text": format!("the {i}th: \"quoted\" é"), "data": { "n": i, "list": [1, 2, { "deep": "x" }] } });
        Rec::new(serde_json::from_value(v).expect("a record"))
    }

    #[test]
    fn a_cold_record_reads_back_the_same_and_writes_its_same_bytes() {
        let dir = std::env::temp_dir().join(format!("oikos-held-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let path = dir.join("t.cold");
        let mut tier = Tier::on(&path, Policy { after_days: 2, idle_days: 1 }).expect("tier");
        let recs: Vec<Rec> = (0..600).map(rec).collect();
        let before: Vec<(Record, Vec<u8>)> = recs.iter().map(|r| (r.peek().as_ref().clone(), canon::canonical(&*r.peek()).expect("bytes"))).collect();
        for (i, r) in recs.iter().enumerate() {
            tier.add(r, (i / 100) as i64);
        }
        // Day 5: the first four days' records are old enough, and none read since: cold.
        let t = tier.pass(5).expect("pass");
        assert_eq!(t.cooled, 400);
        assert!(!recs[0].is_hot() && !recs[399].is_hot() && recs[400].is_hot());
        for (r, (rec, bytes)) in recs.iter().zip(&before) {
            assert_eq!(*r.peek(), *rec);
            let mut out = vec![];
            r.write_canonical(&mut out).expect("bytes");
            assert_eq!(&out, bytes);
        }
        // Read: in memory again, and kept there while read; let go of when it is not, without being written again.
        assert_eq!(*recs[7].load(), before[7].0);
        assert!(recs[7].is_hot());
        let t = tier.pass(6).expect("pass");
        assert!(recs[7].is_hot(), "read on day 6");
        assert_eq!(t.written, 100, "day 4's, old enough now");
        let t = tier.pass(8).expect("pass");
        assert!(!recs[7].is_hot());
        assert_eq!((t.cooled, t.written), (101, 100), "day 5's, and the one read on day 6, not written again");
        assert_eq!(*recs[7].load(), before[7].0);
        drop(recs);
        drop(tier);
        assert!(!path.exists(), "the cold file goes with the run");
    }
}
