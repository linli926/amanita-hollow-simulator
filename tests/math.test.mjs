import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normCdf, normInv, chi2Sf, gammaInv, gammaCdf, lgamma } from '../js/stats/dist.js';
import { makeRng } from '../js/stats/rng.js';
import { nelderMead, invert, spectralRadius } from '../js/stats/optim.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('normal CDF and quantile', () => {
  close(normCdf(0), 0.5, 1e-7);
  close(normCdf(1.959964), 0.975, 1e-6);
  close(normInv(0.975), 1.959964, 1e-5);
  close(normInv(0.001), -3.090232, 1e-5);
  for (const p of [0.01, 0.2, 0.5, 0.77, 0.999]) close(normCdf(normInv(p)), p, 1e-6);
});

test('log-gamma matches factorials', () => {
  close(lgamma(1), 0, 1e-10);
  close(lgamma(6), Math.log(120), 1e-10);
  close(lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10);
});

test('chi-squared survival function', () => {
  close(chi2Sf(3.841459, 1), 0.05, 1e-6);
  close(chi2Sf(5.991465, 2), 0.05, 1e-6);
  close(chi2Sf(0, 1), 1, 0);
});

test('gamma quantile inverts the gamma CDF', () => {
  for (const [shape, scale] of [[1, 1], [2.5, 0.3], [40, 0.05], [0.7, 4]]) {
    for (const p of [0.025, 0.5, 0.975]) close(gammaCdf(gammaInv(p, shape, scale), shape, scale), p, 1e-8);
  }
});

test('RNG is reproducible and variates have correct moments', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 10; i++) assert.equal(a.uniform(), b.uniform());
  const r = makeRng(7);
  const n = 40000;
  const mean = (f) => { let s = 0; for (let i = 0; i < n; i++) s += f(); return s / n; };
  close(mean(() => r.poisson(3.2)), 3.2, 0.05, 'poisson small');
  close(mean(() => r.poisson(150)), 150, 0.4, 'poisson PTRS');
  close(mean(() => r.binomial(40, 0.3)), 12, 0.1, 'binomial inversion');
  close(mean(() => r.binomial(5000, 0.4)), 2000, 1.5, 'binomial normal');
  close(mean(() => r.gamma(2.5, 2)), 5, 0.08, 'gamma');
  close(mean(() => r.negBin(10, 2)), 10, 0.25, 'negbin');
  let s2 = 0; for (let i = 0; i < n; i++) { const x = r.negBin(10, 2); s2 += (x - 10) ** 2; }
  close(s2 / n, 10 + 100 / 2, 3, 'negbin variance mu + mu^2/k');
});

test('Nelder–Mead finds the Rosenbrock minimum', () => {
  const f = ([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2;
  const r = nelderMead(f, [-1.2, 1], { maxIter: 5000, tol: 1e-14 });
  close(r.x[0], 1, 1e-3); close(r.x[1], 1, 2e-3);
});

test('matrix inverse and spectral radius', () => {
  const M = [[4, 7], [2, 6]];
  const inv = invert(M);
  close(inv[0][0], 0.6, 1e-12); close(inv[0][1], -0.7, 1e-12);
  close(spectralRadius([[2, 1], [1, 2]]), 3, 1e-8);
});
