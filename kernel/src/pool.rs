//! Threads kept for the whole process, to share a moment's work over (observations made ready, actors deciding): one
//! pool for each number of threads asked for, made once, and each item a task of its own, so a thread takes the next
//! item not yet taken (one actor's step can take a hundred times another's). Every result goes in its item's place, so
//! the results are the same however the work falls out. (Threads started per round cost 30 to 50 us each, as much as
//! a small round's work; docs/design/performance.md.)

use rayon::prelude::*;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

/// The pool of this many threads (made the first time it is asked for); `None` if the threads can't be had.
fn pool(threads: usize) -> Option<Arc<rayon::ThreadPool>> {
    static POOLS: OnceLock<Mutex<BTreeMap<usize, Option<Arc<rayon::ThreadPool>>>>> = OnceLock::new();
    let mut pools = POOLS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    pools
        .entry(threads)
        .or_insert_with(|| rayon::ThreadPoolBuilder::new().num_threads(threads).thread_name(|i| format!("oikos {}", i + 1)).build().ok().map(Arc::new))
        .clone()
}

/// `f` of each item, in the items' order, on up to `threads` threads.
pub fn each<T: Sync, R: Send>(items: &[T], threads: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    match (threads >= 2 && items.len() >= 2).then(|| pool(threads)).flatten() {
        Some(p) => p.install(|| items.par_iter().with_max_len(1).map(|x| f(x)).collect()),
        None => items.iter().map(f).collect(),
    }
}

/// Each item given to `f` once, mutably, on up to `threads` threads; the results in the items' order.
pub fn each_mut<T: Send, R: Send>(items: &mut [T], threads: usize, f: impl Fn(&mut T) -> R + Sync) -> Vec<R> {
    match (threads >= 2 && items.len() >= 2).then(|| pool(threads)).flatten() {
        Some(p) => p.install(|| items.par_iter_mut().with_max_len(1).map(|x| f(x)).collect()),
        None => items.iter_mut().map(f).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn results_are_in_place_whatever_the_threads() {
        for threads in [1, 2, 5, 14] {
            let items: Vec<u64> = (0..1000).collect();
            let r = each(&items, threads, |x| x * x);
            assert_eq!(r, items.iter().map(|x| x * x).collect::<Vec<_>>());
            let mut m: Vec<u64> = (0..777).collect();
            let r = each_mut(&mut m, threads, |x| {
                *x += 1;
                *x
            });
            assert_eq!(r, (1..778).collect::<Vec<_>>());
            assert_eq!(m, (1..778).collect::<Vec<_>>());
        }
    }
}
