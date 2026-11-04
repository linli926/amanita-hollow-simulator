// Seedable pseudo-random number generator and random variate generators.
// Mulberry32 core: fast, 32-bit state, good enough for simulation games and
// fully reproducible — the same seed always gives the same outbreak.

import { lgamma } from './dist.js';

export function makeRng(seed = Date.now()) {
  let a = (seed >>> 0) || 0x9e3779b9;
  let spareNormal = null;

  /** Uniform on the open interval (0, 1). */
  function uniform() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  }

  /** Standard normal via the Marsaglia polar method. */
  function normal(mean = 0, sd = 1) {
    if (spareNormal !== null) { const s = spareNormal; spareNormal = null; return mean + sd * s; }
    let u, v, s;
    do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spareNormal = v * m;
    return mean + sd * u * m;
  }

  function exponential(rate = 1) { return -Math.log(uniform()) / rate; }

  /** Gamma(shape, scale) — Marsaglia & Tsang. */
  function gamma(shape, scale = 1) {
    if (shape < 1) return gamma(shape + 1, scale) * Math.pow(uniform(), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = uniform();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  /** Poisson — Knuth for small λ, Hörmann's PTRS transformed rejection for large λ. */
  function poisson(lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= uniform(); } while (p > L);
      return k - 1;
    }
    const slam = Math.sqrt(lambda), loglam = Math.log(lambda);
    const b = 0.931 + 2.53 * slam, aa = -0.059 + 0.02483 * b;
    const invalpha = 1.1239 + 1.1328 / (b - 3.4), vr = 0.9277 - 3.6224 / (b - 2);
    for (;;) {
      const U = uniform() - 0.5, V = uniform();
      const us = 0.5 - Math.abs(U);
      const k = Math.floor((2 * aa / us + b) * U + lambda + 0.43);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || (us < 0.013 && V > us)) continue;
      if (Math.log(V) + Math.log(invalpha) - Math.log(aa / (us * us) + b) <= -lambda + k * loglam - lgamma(k + 1)) return k;
    }
  }

  /** Binomial(n, p) — inversion when n·p is small, Poisson/normal approximations otherwise. */
  function binomial(n, p) {
    n = Math.round(n);
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - binomial(n, 1 - p);
    const np = n * p;
    if (np < 25) {
      const q = 1 - p, s = p / q, aa = (n + 1) * s;
      let r = Math.pow(q, n), u = uniform(), x = 0;
      while (u > r) {
        u -= r; x++;
        if (x > n) return n;
        r *= aa / x - s;
        if (r <= 0) break;
      }
      return x;
    }
    if (p < 0.02) return Math.min(n, poisson(np));
    const x = Math.round(np + Math.sqrt(np * (1 - p)) * normal());
    return Math.min(n, Math.max(0, x));
  }

  /** Negative binomial with mean mu and dispersion k (Gamma–Poisson mixture). */
  function negBin(mu, k) {
    if (!(mu > 0)) return 0;
    if (!isFinite(k)) return poisson(mu);
    return poisson(gamma(k, mu / k));
  }

  function bernoulli(p) { return uniform() < p ? 1 : 0; }
  function int(lo, hi) { return lo + Math.floor(uniform() * (hi - lo + 1)); }
  function range(lo, hi) { return lo + uniform() * (hi - lo); }
  function pick(arr) { return arr[Math.floor(uniform() * arr.length)]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(uniform() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  return { uniform, normal, exponential, gamma, poisson, binomial, negBin, bernoulli, int, range, pick, shuffle };
}

export function randomSeed() { return (Math.random() * 2 ** 31) >>> 0; }
