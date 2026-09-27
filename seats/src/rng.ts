// The kernel's randomness, ported exactly (kernel/src/rng.rs): one seed, keyed
// streams. stream(key) derives an independent xoshiro256** stream from
// SHA-256("terrarium.rng.v1\n" || seed_le || for each part: len_le || utf8).
// Code participants draw randomness only from here, so re-runs are reproducible
// (D30). Checked against the Rust known-answer vectors in test/rng.test.ts.

const MASK = (1n << 64n) - 1n;
const DOMAIN = new TextEncoder().encode("terrarium.rng.v1\n");

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n & MASK, true);
  return b;
}

const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & MASK;

export class Rng {
  private s: [bigint, bigint, bigint, bigint];

  constructor(state: [bigint, bigint, bigint, bigint]) {
    this.s = state;
  }

  nextU64(): bigint {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }

  /** Uniform integer in [0, n) without modulo bias (Lemire 2019), exactly as the kernel. */
  below(n: number | bigint): number {
    const nb = BigInt(n);
    if (nb <= 0n) throw new Error("below(0)");
    let m = this.nextU64() * nb;
    let low = m & MASK;
    if (low < nb) {
      const threshold = ((MASK + 1n) - nb) % nb;
      while (low < threshold) {
        m = this.nextU64() * nb;
        low = m & MASK;
      }
    }
    return Number(m >> 64n);
  }

  /** True with probability num/den, exactly. */
  chance(num: number, den: number): boolean {
    return this.below(den) < num;
  }

  /** A uniform pick from a non-empty list. */
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty list");
    return xs[this.below(xs.length)]!;
  }
}

export class Randomness {
  constructor(readonly seed: bigint) {}

  stream(key: readonly string[]): Rng {
    const h = new Bun.CryptoHasher("sha256");
    h.update(DOMAIN);
    h.update(u64le(this.seed));
    for (const part of key) {
      const bytes = new TextEncoder().encode(part);
      h.update(u64le(BigInt(bytes.length)));
      h.update(bytes);
    }
    const d = new DataView(h.digest().buffer);
    const s: [bigint, bigint, bigint, bigint] = [0, 1, 2, 3].map((i) => d.getBigUint64(i * 8, true)) as [bigint, bigint, bigint, bigint];
    if (s.every((x) => x === 0n)) s[0] = 0x9e3779b97f4a7c15n;
    return new Rng(s);
  }
}
