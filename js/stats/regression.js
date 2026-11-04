// Regression models for controlled epidemiological studies.
//  • Logistic regression by IRLS, with optional case weights and robust (sandwich) variance
//  • Conditional logistic regression for 1:m matched sets (nested case–control)
//  • Weighted Cox regression on counting-process data (start, stop] with Lin–Wei robust
//    variance, used for case–cohort designs with Barlow weights

import { invert } from './optim.js';
import { normCdf } from './dist.js';

const Z975 = 1.959963984540054;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function summarise(beta, cov, names) {
  return beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    return { name: names?.[j] ?? `x${j}`, beta: b, se, or: Math.exp(b), lo: Math.exp(b - Z975 * se), hi: Math.exp(b + Z975 * se), p: 2 * (1 - normCdf(Math.abs(b / se))) };
  });
}

function sandwich(Iinv, meat) {
  const p = Iinv.length;
  const A = Iinv.map(row => Array.from({ length: p }, (_, j) => row.reduce((s, v, k) => s + v * meat[k][j], 0)));
  return A.map(row => Array.from({ length: p }, (_, j) => row.reduce((s, v, k) => s + v * Iinv[k][j], 0)));
}

/**
 * Logistic regression. X: rows of covariates (an intercept is added), y: 0/1.
 * w: optional case weights (e.g. inverse sampling probabilities); robust: sandwich SEs.
 */
export function logistic(X, y, { w = null, robust = false, names = null } = {}) {
  const n = y.length;
  const Z = X.map(r => [1, ...r]);
  const p = Z[0].length;
  let beta = new Array(p).fill(0);
  let info = null;
  for (let it = 0; it < 60; it++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const mu = 1 / (1 + Math.exp(-dot(Z[i], beta)));
      const wi = (w ? w[i] : 1);
      const v = wi * mu * (1 - mu);
      for (let a = 0; a < p; a++) {
        g[a] += wi * (y[i] - mu) * Z[i][a];
        for (let b = 0; b < p; b++) H[a][b] += v * Z[i][a] * Z[i][b];
      }
    }
    info = H;
    const Hinv = invert(H);
    if (!Hinv) break;
    const step = Hinv.map(row => dot(row, g));
    beta = beta.map((b, j) => b + step[j]);
    if (step.reduce((s, v) => s + Math.abs(v), 0) < 1e-10) break;
  }
  let cov = invert(info);
  if (robust) {
    const meat = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const mu = 1 / (1 + Math.exp(-dot(Z[i], beta)));
      const s = (w ? w[i] : 1) * (y[i] - mu);
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) meat[a][b] += s * s * Z[i][a] * Z[i][b];
    }
    cov = sandwich(cov, meat);
  }
  return { coefs: summarise(beta, cov, ['(intercept)', ...(names ?? X[0].map((_, j) => `x${j + 1}`))]), beta, cov };
}

/**
 * Conditional logistic regression for matched sets with one case each.
 * sets: [{ x: [caseRow, controlRow1, ...] }] (case first).
 * Equivalent to a Cox model stratified by matched set.
 */
export function clogit(sets, names) {
  const p = sets[0].x[0].length;
  let beta = new Array(p).fill(0);
  const evalAt = b => {
    let ll = 0;
    const U = new Array(p).fill(0), I = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const s of sets) {
      let S0 = 0; const S1 = new Array(p).fill(0), S2 = Array.from({ length: p }, () => new Array(p).fill(0));
      for (const x of s.x) {
        const e = Math.exp(dot(x, b));
        S0 += e;
        for (let a = 0; a < p; a++) { S1[a] += e * x[a]; for (let c = 0; c < p; c++) S2[a][c] += e * x[a] * x[c]; }
      }
      const xc = s.x[0];
      ll += dot(xc, b) - Math.log(S0);
      for (let a = 0; a < p; a++) {
        U[a] += xc[a] - S1[a] / S0;
        for (let c = 0; c < p; c++) I[a][c] += S2[a][c] / S0 - S1[a] * S1[c] / (S0 * S0);
      }
    }
    return { ll, U, I };
  };
  let cur = evalAt(beta);
  for (let it = 0; it < 50; it++) {
    const Iinv = invert(cur.I); if (!Iinv) break;
    const step = Iinv.map(row => dot(row, cur.U));
    let sc = 1, nb, nx;
    for (let h = 0; h < 20; h++) { nb = beta.map((v, j) => v + sc * step[j]); nx = evalAt(nb); if (nx.ll >= cur.ll - 1e-12) break; sc /= 2; }
    const d = Math.abs(nx.ll - cur.ll);
    beta = nb; cur = nx;
    if (d < 1e-10) break;
  }
  return { coefs: summarise(beta, invert(cur.I), names), beta, ll: cur.ll };
}

/**
 * Weighted Cox regression for counting-process records
 *   { id, start, stop, event, w, x }   (at risk on (start, stop])
 * Breslow partial likelihood; robust variance from weighted score residuals
 * aggregated by subject (Lin & Wei 1989; Barlow 1994).
 */
export function coxCountingProcess(records, names) {
  const p = records[0].x.length;
  const events = records.filter(r => r.event).sort((a, b) => a.stop - b.stop);

  function pass(beta, wantResid) {
    const ex = records.map(r => Math.exp(dot(r.x, beta)));
    let ll = 0;
    const U = new Array(p).fill(0), I = Array.from({ length: p }, () => new Array(p).fill(0));
    const per = wantResid ? new Map() : null;
    const add = (id, vec) => { if (!per.has(id)) per.set(id, new Array(p).fill(0)); const a = per.get(id); vec.forEach((v, j) => { a[j] += v; }); };
    for (const e of events) {
      const t = e.stop;
      let S0 = 0; const S1 = new Array(p).fill(0), S2 = Array.from({ length: p }, () => new Array(p).fill(0));
      const risk = [];
      records.forEach((r, i) => {
        if (r.start < t && t <= r.stop) {
          const we = r.w * ex[i];
          S0 += we;
          for (let a = 0; a < p; a++) { S1[a] += we * r.x[a]; for (let c = 0; c < p; c++) S2[a][c] += we * r.x[a] * r.x[c]; }
          if (wantResid) risk.push(i);
        }
      });
      const xbar = S1.map(v => v / S0);
      ll += e.w * (dot(e.x, beta) - Math.log(S0));
      for (let a = 0; a < p; a++) {
        U[a] += e.w * (e.x[a] - xbar[a]);
        for (let c = 0; c < p; c++) I[a][c] += e.w * (S2[a][c] / S0 - xbar[a] * xbar[c]);
      }
      if (wantResid) {
        add(e.id, e.x.map((v, j) => e.w * (v - xbar[j])));
        for (const i of risk) {
          const r = records[i];
          const f = e.w * r.w * ex[i] / S0;
          add(r.id, r.x.map((v, j) => -f * (v - xbar[j])));
        }
      }
    }
    return { ll, U, I, per };
  }

  let beta = new Array(p).fill(0);
  let cur = pass(beta, false);
  for (let it = 0; it < 40; it++) {
    const Iinv = invert(cur.I); if (!Iinv) break;
    const step = Iinv.map(row => dot(row, cur.U));
    let sc = 1, nb, nx;
    for (let h = 0; h < 20; h++) { nb = beta.map((v, j) => v + sc * step[j]); nx = pass(nb, false); if (nx.ll >= cur.ll - 1e-12) break; sc /= 2; }
    const d = Math.abs(nx.ll - cur.ll);
    beta = nb; cur = nx;
    if (d < 1e-10) break;
  }
  const fin = pass(beta, true);
  const Iinv = invert(fin.I);
  const meat = Array.from({ length: p }, () => new Array(p).fill(0));
  for (const L of fin.per.values()) for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) meat[a][c] += L[a] * L[c];
  return { coefs: summarise(beta, sandwich(Iinv, meat), names), naive: summarise(beta, Iinv, names), beta };
}
