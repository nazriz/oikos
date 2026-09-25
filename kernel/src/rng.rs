//! The kernel's only source of randomness.
//!
//! One seed (from the world config), owned by the kernel. Rather than a single
//! sequential stream, which makes every draw depend on every earlier draw,
//! randomness is *keyed*: `Randomness::stream(&["citizen", id, "move", t])`
//! derives an independent xoshiro256** stream from SHA-256(seed, key). So
//! adding a consumer (one more citizen, a new behaviour rule) doesn't perturb
//! anyone else's draws, and looking at a citizen can never change the outcome.
//! Each (key) must be used for one purpose only; include the time or a counter
//! in the key when drawing repeatedly.
//!
//! The algorithms are implemented here (not taken from `rand`) so a dependency
//! upgrade can never change a run's randomness.

use sha2::{Digest, Sha256};

const DOMAIN: &[u8] = b"terrarium.rng.v1\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Randomness {
    seed: u64,
}

impl Randomness {
    pub fn new(seed: u64) -> Self {
        Randomness { seed }
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// An independent stream for `key`. Key parts are length-prefixed, so
    /// ["ab","c"] and ["a","bc"] give different streams.
    pub fn stream(&self, key: &[&str]) -> Rng {
        let mut h = Sha256::new();
        h.update(DOMAIN);
        h.update(self.seed.to_le_bytes());
        for part in key {
            h.update((part.len() as u64).to_le_bytes());
            h.update(part.as_bytes());
        }
        let d = h.finalize();
        let mut s = [0u64; 4];
        for (i, w) in s.iter_mut().enumerate() {
            let mut b = [0u8; 8];
            b.copy_from_slice(&d[i * 8..i * 8 + 8]);
            *w = u64::from_le_bytes(b);
        }
        if s == [0; 4] {
            s[0] = 0x9E37_79B9_7F4A_7C15; // xoshiro's all-zero state is a fixed point
        }
        Rng { s }
    }
}

/// xoshiro256** (Blackman & Vigna, 2018).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform integer in [0, n) without modulo bias (Lemire 2019). n must be > 0.
    pub fn below(&mut self, n: u64) -> u64 {
        assert!(n > 0, "below(0)");
        let mut m = (self.next_u64() as u128) * (n as u128);
        let mut low = m as u64;
        if low < n {
            let threshold = n.wrapping_neg() % n;
            while low < threshold {
                m = (self.next_u64() as u128) * (n as u128);
                low = m as u64;
            }
        }
        (m >> 64) as u64
    }

    /// True with probability num/den, exactly, in integers.
    pub fn chance(&mut self, num: u64, den: u64) -> bool {
        self.below(den) < num
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_answer_vector() {
        // Freezes the algorithm: if this changes, every published run changes.
        let mut r = Randomness::new(20260925).stream(&["test", "kat"]);
        let got: Vec<u64> = (0..4).map(|_| r.next_u64()).collect();
        assert_eq!(got, KAT.to_vec(), "PRNG output changed: {got:?}");
    }

    const KAT: [u64; 4] = [1279016643545707308, 14278355414776164234, 10710452481135636343, 17500029201716531815];

    #[test]
    fn matches_reference_xoshiro256starstar() {
        // Reference implementation (Blackman & Vigna), state {1, 2, 3, 4}.
        let mut r = Rng { s: [1, 2, 3, 4] };
        assert_eq!([r.next_u64(), r.next_u64(), r.next_u64()], [11520, 0, 1509978240]);
    }

    #[test]
    fn streams_are_independent_and_reproducible() {
        let g = Randomness::new(7);
        let a1: Vec<u64> = {
            let mut r = g.stream(&["a"]);
            (0..8).map(|_| r.next_u64()).collect()
        };
        let a2: Vec<u64> = {
            let mut r = g.stream(&["a"]);
            (0..8).map(|_| r.next_u64()).collect()
        };
        let b: Vec<u64> = {
            let mut r = g.stream(&["b"]);
            (0..8).map(|_| r.next_u64()).collect()
        };
        assert_eq!(a1, a2);
        assert_ne!(a1, b);
        assert_ne!(g.stream(&["ab", "c"]), g.stream(&["a", "bc"]));
        assert_ne!(Randomness::new(8).stream(&["a"]), g.stream(&["a"]));
    }

    #[test]
    fn below_is_in_range_and_roughly_uniform() {
        let mut r = Randomness::new(1).stream(&["uniform"]);
        let mut counts = [0u32; 6];
        for _ in 0..60_000 {
            counts[r.below(6) as usize] += 1;
        }
        for c in counts {
            assert!((9_000..11_000).contains(&c), "{counts:?}");
        }
        for n in [1u64, 2, 3, u64::MAX] {
            assert!(r.below(n) < n);
        }
    }
}
