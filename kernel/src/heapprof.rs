//! A sampling heap profiler for whoever measures memory (`--features heapprof`; never in a run that is kept).
//!
//! Wraps the allocator: about one allocation per `OIKOS_HEAPPROF_RATE` bytes allocated (default 256 KiB), and every
//! allocation at least that large, is sampled with its call stack (return addresses, from the libc `backtrace`); a
//! sample stands for `max(size, rate)` bytes while it lives. Every `OIKOS_HEAPPROF_EVERY` seconds (default 30), and at
//! the high-water mark of what the samples stand for (each time it passes the last by 2%), the live samples summed by
//! stack are written to `OIKOS_HEAPPROF_OUT` (default `heapprof`) as `<out>.<n>.txt` and `<out>.peak.txt` (and, by
//! `oikos-kernel world`, `<out>.end.txt` at the run's end, the world still held), with the image's load address, for `atos` to name (scripts/heapprof.ts). The run's results do not depend on any of this (a
//! 10,000-person month under it ended at the same state hash and log). macOS and Linux (libc's `backtrace`).

use std::alloc::{GlobalAlloc, Layout};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

pub struct Profiled<A>(pub A);

const DEPTH: usize = 48;
const BITS: usize = 1 << 26;

static RATE: AtomicU64 = AtomicU64::new(0);
static ON: AtomicBool = AtomicBool::new(false);
static LIVE: AtomicU64 = AtomicU64::new(0);
static PEAK_WRITTEN: AtomicU64 = AtomicU64::new(0);
static PEAK_BUSY: AtomicBool = AtomicBool::new(false);
static MAYBE: [AtomicU64; BITS / 64] = [const { AtomicU64::new(0) }; BITS / 64];
static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Table {
    live: BTreeMap<usize, (u64, u32)>,
    stacks: Vec<[usize; DEPTH]>,
    index: BTreeMap<[usize; DEPTH], u32>,
}

static TABLE: Mutex<Option<Table>> = Mutex::new(None);

thread_local! {
    static INSIDE: Cell<bool> = const { Cell::new(false) };
    static UNTIL: Cell<i64> = const { Cell::new(0) };
}

extern "C" {
    fn backtrace(buf: *mut *mut std::ffi::c_void, size: i32) -> i32; }
#[cfg(target_os = "macos")]
extern "C" {
    fn _dyld_get_image_vmaddr_slide(image: u32) -> isize; }

/// Where the binary is loaded: macOS, its link address and dyld's slide; Linux, the main object's base (`dl_iterate_phdr`
/// gives it first), so an address less it is the binary's own, for `llvm-symbolizer`.
#[cfg(target_os = "macos")]
fn load_address() -> usize {
    // SAFETY: dyld's slide of the main image (image 0) is always there to read.
    (0x1_0000_0000usize as isize + unsafe { _dyld_get_image_vmaddr_slide(0) }) as usize
}
#[cfg(not(target_os = "macos"))]
fn load_address() -> usize {
    #[repr(C)]
    struct Info {
        addr: usize,
    }
    extern "C" {
        fn dl_iterate_phdr(cb: extern "C" fn(*mut Info, usize, *mut std::ffi::c_void) -> i32, data: *mut std::ffi::c_void) -> i32;
    }
    extern "C" fn first(info: *mut Info, _: usize, data: *mut std::ffi::c_void) -> i32 {
        // SAFETY: the loader hands a valid info (its first member the object's base) and our `data`, a `usize`.
        unsafe { *(data as *mut usize) = (*info).addr };
        1
    }
    let mut base = 0usize;
    // SAFETY: the callback writes one usize through the pointer it is given, ours, and stops at the first object.
    unsafe { dl_iterate_phdr(first, &mut base as *mut usize as *mut std::ffi::c_void) };
    base
}

fn bit(p: usize) -> (usize, u64) {
    let h = (p >> 4).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> (64 - 26);
    (h / 64, 1u64 << (h % 64))
}

/// Starts sampling (call once, early in main), and the thread that writes the tables.
pub fn start() {
    let rate = std::env::var("OIKOS_HEAPPROF_RATE").ok().and_then(|s| s.parse().ok()).unwrap_or(256 * 1024u64);
    let every = std::env::var("OIKOS_HEAPPROF_EVERY").ok().and_then(|s| s.parse().ok()).unwrap_or(30u64);
    RATE.store(rate, Ordering::Relaxed);
    *TABLE.lock().unwrap() = Some(Table { live: BTreeMap::new(), stacks: vec![], index: BTreeMap::new() });
    ON.store(true, Ordering::Release);
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(every));
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        dump(&format!("{n}"));
    });
}

fn out_path(tag: &str) -> String {
    format!("{}.{tag}.txt", std::env::var("OIKOS_HEAPPROF_OUT").unwrap_or_else(|_| "heapprof".into()))
}

/// Writes the live samples by stack: `bytes count addr addr ...`, largest first.
pub fn dump(tag: &str) {
    INSIDE.with(|i| i.set(true));
    let rows: Vec<(u64, u64, [usize; DEPTH])> = {
        let g = TABLE.lock().unwrap();
        let Some(t) = g.as_ref() else { return };
        let mut by: BTreeMap<u32, (u64, u64)> = BTreeMap::new();
        for (w, s) in t.live.values() {
            let e = by.entry(*s).or_default();
            e.0 += w;
            e.1 += 1;
        }
        let mut rows: Vec<_> = by.into_iter().map(|(s, (w, c))| (w, c, t.stacks[s as usize])).collect();
        rows.sort_by(|a, b| b.0.cmp(&a.0));
        rows
    };
    if let Ok(mut f) = std::fs::File::create(out_path(tag)) {
        let total: u64 = rows.iter().map(|r| r.0).sum();
        let _ = writeln!(f, "# load 0x{:x} live {} rate {}", load_address(), total, RATE.load(Ordering::Relaxed));
        for (w, c, s) in rows {
            let addrs: Vec<String> = s.iter().take_while(|a| **a != 0).map(|a| format!("0x{a:x}")).collect();
            let _ = writeln!(f, "{w} {c} {}", addrs.join(" "));
        }
    }
    INSIDE.with(|i| i.set(false));
}

impl<A: GlobalAlloc> Profiled<A> {
    #[inline]
    fn sampled(&self, size: usize) -> Option<u64> {
        if !ON.load(Ordering::Relaxed) {
            return None;
        }
        let rate = RATE.load(Ordering::Relaxed) as i64;
        if size as i64 >= rate {
            return Some(size as u64);
        }
        UNTIL.with(|u| {
            let left = u.get() - size as i64;
            if left <= 0 {
                u.set(left + rate);
                Some(rate as u64)
            } else {
                u.set(left);
                None
            }
        })
    }

    fn note(&self, p: *mut u8, weight: u64) {
        if INSIDE.with(|i| i.replace(true)) {
            return;
        }
        let mut s = [0usize; DEPTH];
        // SAFETY: `s` has room for DEPTH return addresses; `backtrace` writes at most that many.
        unsafe { backtrace(s.as_mut_ptr().cast(), DEPTH as i32) };
        {
            let mut g = TABLE.lock().unwrap();
            if let Some(t) = g.as_mut() {
                let id = match t.index.get(&s) {
                    Some(id) => *id,
                    None => {
                        t.stacks.push(s);
                        let id = (t.stacks.len() - 1) as u32;
                        t.index.insert(s, id);
                        id
                    }
                };
                t.live.insert(p as usize, (weight, id));
            }
        }
        let (w, b) = bit(p as usize);
        MAYBE[w].fetch_or(b, Ordering::Relaxed);
        let live = LIVE.fetch_add(weight, Ordering::Relaxed) + weight;
        if live > PEAK_WRITTEN.load(Ordering::Relaxed) / 50 * 51 + (64 << 20) && !PEAK_BUSY.swap(true, Ordering::Acquire) {
            PEAK_WRITTEN.store(live, Ordering::Relaxed);
            dump("peak");
            PEAK_BUSY.store(false, Ordering::Release);
        }
        INSIDE.with(|i| i.set(false));
    }

    fn forget(&self, p: *mut u8) {
        let (w, b) = bit(p as usize);
        if MAYBE[w].load(Ordering::Relaxed) & b == 0 {
            return;
        }
        if INSIDE.with(|i| i.replace(true)) {
            return;
        }
        if let Some(t) = TABLE.lock().unwrap().as_mut() {
            if let Some((weight, _)) = t.live.remove(&(p as usize)) {
                LIVE.fetch_sub(weight, Ordering::Relaxed);
            }
        }
        INSIDE.with(|i| i.set(false));
    }
}

// SAFETY: every call is passed to the inner allocator unchanged; the profiler only records pointers it was given.
unsafe impl<A: GlobalAlloc> GlobalAlloc for Profiled<A> {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = self.0.alloc(l);
        if !p.is_null() {
            if let Some(w) = self.sampled(l.size()) {
                self.note(p, w);
            }
        }
        p
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        let p = self.0.alloc_zeroed(l);
        if !p.is_null() {
            if let Some(w) = self.sampled(l.size()) {
                self.note(p, w);
            }
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        self.forget(p);
        self.0.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, new: usize) -> *mut u8 {
        let q = self.0.realloc(p, l, new);
        if !q.is_null() {
            self.forget(p);
            if let Some(w) = self.sampled(new) {
                self.note(q, w);
            }
        }
        q
    }
}
