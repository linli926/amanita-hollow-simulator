// Statistical inference for outbreak data.
//  • Maximum likelihood fit of a SEIR model to negative-binomial case counts (Nelder–Mead)
//  • Profile likelihood confidence interval for R₀ (Wilks' theorem)
//  • Poisson GLM growth-rate estimate via IRLS, with quasi-Poisson overdispersion
//  • Instantaneous reproduction number Rt (Cori et al. 2013)

import { simulateSEIRD } from '../models/ode.js';
import { R0FromGrowthRate, growthRateFromR0 } from '../models/theory.js';
import { nelderMead, goldenSection, invert } from './optim.js';
import { negBinLogPmf, gammaInv, normInv, chi2Sf } from './dist.js';

const logit = p => Math.log(p / (1 - p));
const expit = x => 1 / (1 + Math.exp(-x));

/** Expected reported cases for days 1..T: ρ × daily infections from the SEIR ODE. */
export function expectedCases(par, known, T) {
  const traj = simulateSEIRD({
    N: known.N, I0: par.I0, R0: par.R0, latent: known.latent, infectious: known.infectious,
    cfr: 0, days: T, dt: 0.5,
  });
  return traj.incidence.map(x => x * par.rho);
}

/** NB log-likelihood of the observed counts y[1..T]. */
export function logLik(par, y, known) {
  const T = y.length - 1;
  const mu = expectedCases(par, known, T);
  let ll = 0;
  for (let t = 1; t <= T; t++) ll += negBinLogPmf(y[t], Math.max(mu[t], 1e-9), par.k);
  return ll;
}

function unpack(theta, fixed = {}) {
  let i = 0;
  const R0 = fixed.R0 ?? Math.exp(theta[i++]);
  const rho = fixed.rho ?? expit(theta[i++]);
  const I0 = Math.exp(theta[i++]);
  const k = fixed.k ?? Math.exp(theta[i++]);
  return { R0, rho, I0, k };
}

function pack(par, fixed = {}) {
  const th = [];
  if (fixed.R0 === undefined) th.push(Math.log(par.R0));
  if (fixed.rho === undefined) th.push(logit(Math.min(0.99, Math.max(0.01, par.rho))));
  th.push(Math.log(par.I0));
  if (fixed.k === undefined) th.push(Math.log(par.k));
  return th;
}

function boundedNegLL(par, y, known) {
  if (par.R0 < 0.2 || par.R0 > 12 || par.I0 > known.N * 0.2 || par.I0 < 0.01 || par.k < 0.2 || par.k > 1e4) return 1e12;
  return -logLik(par, y, known);
}

/** Maximise the likelihood over a subset of parameters (others held in `fixed`). */
export function fit(y, known, start, fixed = {}) {
  const f = th => boundedNegLL(unpack(th, fixed), y, known);
  let best = null;
  const starts = Array.isArray(start) ? start : [start];
  for (const s of starts) {
    const r = nelderMead(f, pack(s, fixed), { step: 0.4, maxIter: 600, tol: 1e-9 });
    // Restart once from the optimum to escape premature simplex collapse
    const r2 = nelderMead(f, r.x, { step: 0.1, maxIter: 400, tol: 1e-10 });
    const rr = r2.fx < r.fx ? r2 : r;
    if (!best || rr.fx < best.fx) best = rr;
  }
  return { ...unpack(best.x, fixed), ll: -best.fx };
}

/** Full maximum likelihood estimate with a few sensible starting points. */
export function fitMLE(y, known) {
  const glm = poissonGrowthGLM(y);
  const r0g = glm ? Math.min(8, Math.max(0.8, R0FromGrowthRate(glm.r, known.latent, known.infectious))) : 2;
  const starts = [
    { R0: r0g, rho: 0.3, I0: 5, k: 10 },
    { R0: r0g * 1.2, rho: 0.7, I0: 2, k: 5 },
    { R0: 2.0, rho: 0.15, I0: 20, k: 20 },
  ];
  return fit(y, known, starts);
}

/**
 * Variance inflation for model misspecification. The NB likelihood treats days as
 * independent, but a stochastic epidemic wanders away from the ODE mean, so
 * residuals are over-dispersed and serially correlated. We estimate
 *   ĉ = max(1, φ̂ · (1 + r₁)/(1 − r₁))
 * from the Pearson dispersion φ̂ and the lag-1 autocorrelation r₁ of the Pearson
 * residuals (quasi-likelihood with an AR(1) effective-sample-size correction).
 */
export function misspecificationFactor(y, known, mle) {
  const T = y.length - 1;
  const mu = expectedCases(mle, known, T);
  const res = [];
  for (let t = 1; t <= T; t++) {
    const m = Math.max(mu[t], 1e-6);
    if (m < 0.5 && y[t] === 0) continue;
    res.push((y[t] - m) / Math.sqrt(m + m * m / mle.k));
  }
  const n = res.length;
  if (n < 8) return { c: 1, phi: 1, r1: 0 };
  const phi = res.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 4);
  const mean = res.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (res[i] - mean) ** 2; if (i > 0) num += (res[i] - mean) * (res[i - 1] - mean); }
  const r1 = Math.max(0, Math.min(0.9, den > 0 ? num / den : 0));
  return { c: Math.max(1, phi * (1 + r1) / (1 - r1)), phi, r1 };
}

/**
 * Profile likelihood for R₀: for each R₀ on a grid maximise over (ρ, I₀) with k
 * fixed at its MLE. The 95% CI is {R₀ : 2[ℓ(θ̂) − ℓ_p(R₀)] ≤ ĉ · χ²₁(0.95)},
 * where ĉ ≥ 1 is the misspecification factor (ĉ = 1 gives the textbook 3.84 cut-off).
 */
export function profileR0(y, known, mle, nGrid = 25, opts = {}) {
  const adj = opts.adjust === false ? { c: 1, phi: 1, r1: 0 } : misspecificationFactor(y, known, mle);
  const span = Math.max(0.35, 0.45 * mle.R0) * Math.min(3, Math.sqrt(adj.c));
  const lo = Math.max(0.5, mle.R0 - span), hi = mle.R0 + span;
  const grid = Array.from({ length: nGrid }, (_, i) => lo + (hi - lo) * i / (nGrid - 1));
  const crit = 3.841458820694124 * adj.c;
  // March outwards from the MLE so every fit is warm-started from its neighbour.
  const iMle = grid.reduce((bi, g, i) => (Math.abs(g - mle.R0) < Math.abs(grid[bi] - mle.R0) ? i : bi), 0);
  const prof = new Array(nGrid);
  const run = (i, warm) => {
    const r = fit(y, known, warm, { R0: grid[i], k: mle.k });
    prof[i] = { R0: grid[i], ll: r.ll, rho: r.rho, I0: r.I0, k: mle.k };
    return r;
  };
  let warm = { ...mle };
  for (let i = iMle; i < nGrid; i++) warm = run(i, warm);
  warm = { ...mle };
  for (let i = iMle - 1; i >= 0; i--) warm = run(i, warm);
  const llMax = Math.max(mle.ll, ...prof.map(p => p.ll));
  prof.forEach(p => { p.dev = 2 * (llMax - p.ll); });

  // Interpolate the crossings of the χ² cut-off
  let ciLo = null, ciHi = null;
  for (let i = iMle; i > 0; i--) {
    if (prof[i].dev <= crit && prof[i - 1].dev > crit) {
      const a = prof[i - 1], b = prof[i];
      ciLo = a.R0 + (crit - a.dev) / (b.dev - a.dev) * (b.R0 - a.R0); break;
    }
  }
  for (let i = iMle; i < nGrid - 1; i++) {
    if (prof[i].dev <= crit && prof[i + 1].dev > crit) {
      const a = prof[i], b = prof[i + 1];
      ciHi = a.R0 + (crit - a.dev) / (b.dev - a.dev) * (b.R0 - a.R0); break;
    }
  }
  return { grid: prof, ciLo, ciHi, crit, llMax, adj, open: { lo: ciLo === null, hi: ciHi === null } };
}

/**
 * Score a user's guess: the log-likelihood with R₀ and ρ fixed at the guess,
 * maximised over I₀ only (golden-section search), k fixed at the MLE.
 */
export function guessLogLik(y, known, R0, rho, k) {
  const f = lx => -logLik({ R0, rho, I0: Math.exp(lx), k }, y, known);
  const r = goldenSection(f, Math.log(0.05), Math.log(Math.max(1, known.N * 0.05)), 1e-3);
  return { ll: -r.fx, I0: Math.exp(r.x) };
}

/**
 * Exponential growth rate from a Poisson log-linear GLM, log E[y_t] = a + r t,
 * fitted by iteratively reweighted least squares (Nelder & Wedderburn 1972).
 * Standard errors are inflated by the Pearson dispersion (quasi-Poisson).
 * Fits days [from, to]; by default from the first case to the peak of the 7-day mean.
 */
export function poissonGrowthGLM(y, from, to) {
  const T = y.length - 1;
  if (from === undefined) { from = 1; while (from < T && y[from] === 0) from++; }
  if (to === undefined) {
    let best = from, bestV = -1;
    for (let t = from; t <= T; t++) {
      let s = 0, n = 0;
      for (let u = Math.max(1, t - 3); u <= Math.min(T, t + 3); u++) { s += y[u]; n++; }
      if (s / n > bestV) { bestV = s / n; best = t; }
    }
    to = best;
  }
  const ts = [], ys = [];
  for (let t = from; t <= to; t++) { ts.push(t - from); ys.push(y[t]); }
  const n = ts.length;
  if (n < 5 || ys.reduce((a, b) => a + b, 0) < 10) return null;
  let a = Math.log(Math.max(0.5, ys.slice(0, 3).reduce((s, v) => s + v, 0) / 3)), r = 0.05;
  let cov = null;
  for (let it = 0; it < 50; it++) {
    let s00 = 0, s01 = 0, s11 = 0, b0 = 0, b1 = 0;
    for (let i = 0; i < n; i++) {
      const eta = a + r * ts[i], mu = Math.exp(eta);
      const z = eta + (ys[i] - mu) / mu, w = mu;
      s00 += w; s01 += w * ts[i]; s11 += w * ts[i] * ts[i];
      b0 += w * z; b1 += w * ts[i] * z;
    }
    cov = invert([[s00, s01], [s01, s11]]);
    if (!cov) return null;
    const na = cov[0][0] * b0 + cov[0][1] * b1;
    const nr = cov[1][0] * b0 + cov[1][1] * b1;
    const done = Math.abs(na - a) + Math.abs(nr - r) < 1e-10;
    a = na; r = nr;
    if (done) break;
  }
  let pearson = 0;
  const fitted = ts.map(t => Math.exp(a + r * t));
  for (let i = 0; i < n; i++) pearson += (ys[i] - fitted[i]) ** 2 / fitted[i];
  const phi = Math.max(1, pearson / (n - 2));
  const se = Math.sqrt(cov[1][1] * phi);
  const z = normInv(0.975);
  return { r, a, se, lo: r - z * se, hi: r + z * se, phi, from, to, fitted, n };
}

/** Convert a growth-rate fit into an R₀ estimate with a delta-free (monotone transform) CI. */
export function R0FromGLM(glm, L, D) {
  return {
    R0: R0FromGrowthRate(glm.r, L, D),
    lo: R0FromGrowthRate(glm.lo, L, D),
    hi: R0FromGrowthRate(glm.hi, L, D),
  };
}

/**
 * Instantaneous reproduction number Rt (Cori, Ferguson, Fraser & Cauchemez 2013).
 * Renewal equation: E[I_t] = R_t Λ_t, Λ_t = Σ_s I_{t−s} w_s.
 * With a Gamma(a, b) prior and a sliding window of τ days, the posterior is
 *   Gamma( a + Σ I_s , 1 / (1/b + Σ Λ_s) ).
 */
export function coriRt(cases, w, tau = 7, a = 1, b = 5, minCases = 12) {
  const T = cases.length - 1;
  const Lambda = new Array(T + 1).fill(0);
  for (let t = 1; t <= T; t++) {
    let s = 0;
    for (let k = 1; k < w.length && k <= t; k++) s += cases[t - k] * w[k];
    Lambda[t] = s;
  }
  const out = [];
  let cum = 0;
  for (let t = 0; t <= T; t++) {
    cum += cases[t];
    if (t < tau + 1 || cum < minCases) continue;
    let sI = 0, sL = 0;
    for (let s = t - tau + 1; s <= t; s++) { sI += cases[s]; sL += Lambda[s]; }
    if (sL <= 0) continue;
    const shape = a + sI, scale = 1 / (1 / b + sL);
    out.push({ t, mean: shape * scale, lo: gammaInv(0.025, shape, scale), hi: gammaInv(0.975, shape, scale) });
  }
  return out;
}

export { growthRateFromR0, chi2Sf };
