// Trial conduct — Hackshaw, A Concise Guide to Clinical Trials.
//  • Non-compliance: ITT, per-protocol, as-treated and the complier average causal effect (CACE)
//  • Group-sequential monitoring: naive repeated testing vs Pocock vs O'Brien–Fleming boundaries

import { makePopulation, infectionRisk, table2x2, riskRatio, toVE } from './design.js';
import { normInv } from './dist.js';

const expit = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(p / (1 - p));

/**
 * Vaccine trial with one-sided non-compliance: some participants randomised to vaccine
 * never receive it. Non-adherers are more often frail and incautious, and both raise
 * infection risk (the "healthy adherer" effect).
 */
export function complianceTrial(o, rng) {
  const people = makePopulation(2 * o.nPerArm, rng);
  const rows = people.map((p, i) => {
    const arm = i % 2;
    const refuseP = expit(logit(Math.max(1e-4, o.refusal)) + Math.log(o.refusalOR) * ((1 - p.caution) - 0.6 + p.frail - 0.25));
    const received = arm === 1 && !rng.bernoulli(o.refusal > 0 ? refuseP : 0) ? 1 : 0;
    const risk = Math.min(0.99, infectionRisk(p, received, o.ve, { baseRisk: [o.p0 * 0.8, o.p0, o.p0 * 1.4], cautionEffect: 0.4 }) * (p.frail ? 2.5 : 1));
    return { arm, received, case: rng.bernoulli(risk) };
  });
  return analyseCompliance(rows);
}

export function analyseCompliance(rows) {
  const t = sel => table2x2(sel.map(r => ({ vax: r.k, case: r.case })));
  const itt = riskRatio(t(rows.map(r => ({ k: r.arm, case: r.case }))));
  const pp = riskRatio(t(rows.filter(r => r.arm === 0 || r.received).map(r => ({ k: r.arm, case: r.case }))));
  const at = riskRatio(t(rows.map(r => ({ k: r.received, case: r.case }))));
  const cace = caceVE(rows);
  const vaxArm = rows.filter(r => r.arm === 1);
  return {
    itt: toVE(itt), pp: toVE(pp), at: toVE(at), cace,
    compliance: vaxArm.filter(r => r.received).length / vaxArm.length,
    riskRefusers: (() => { const r = vaxArm.filter(x => !x.received); return r.length ? r.filter(x => x.case).length / r.length : NaN; })(),
    riskControl: (() => { const r = rows.filter(x => x.arm === 0); return r.filter(x => x.case).length / r.length; })(),
    rows,
  };
}

/**
 * CACE under one-sided non-compliance (instrumental variable / principal stratification):
 *   compliers' untreated risk  r_c0 = (r_control − (1 − c)·r_never) / c
 *   compliers' treated risk    r_c1 = risk among vaccinated in the vaccine arm
 *   VE_CACE = 1 − r_c1 / r_c0
 */
export function caceVE(rows) {
  const v = rows.filter(r => r.arm === 1), ctl = rows.filter(r => r.arm === 0);
  const comp = v.filter(r => r.received), never = v.filter(r => !r.received);
  const c = comp.length / v.length;
  const risk = a => (a.length ? a.filter(r => r.case).length / a.length : 0);
  const rc0 = (risk(ctl) - (1 - c) * risk(never)) / c;
  return 1 - risk(comp) / rc0;
}

/** Percentile bootstrap CI for the CACE. */
export function caceBootstrap(rows, rng, B = 200) {
  const v = rows.filter(r => r.arm === 1), ctl = rows.filter(r => r.arm === 0);
  const ests = [];
  for (let b = 0; b < B; b++) {
    const res = [];
    for (let i = 0; i < v.length; i++) res.push(v[Math.floor(rng.uniform() * v.length)]);
    for (let i = 0; i < ctl.length; i++) res.push(ctl[Math.floor(rng.uniform() * ctl.length)]);
    const e = caceVE(res);
    if (isFinite(e)) ests.push(e);
  }
  ests.sort((a, b) => a - b);
  return { lo: ests[Math.floor(0.025 * ests.length)], hi: ests[Math.floor(0.975 * ests.length)] };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Two-sided α = 0.05 boundary constants (Jennison & Turnbull 2000, Table 2.1/2.3). */
const POCOCK = { 1: 1.960, 2: 2.178, 3: 2.289, 4: 2.361, 5: 2.413 };
const OBF = { 1: 1.960, 2: 1.977, 3: 2.004, 4: 2.024, 5: 2.040 };

/** Critical |z| at look k of K (equally spaced information). */
export function boundary(method, k, K) {
  if (method === 'naive') return normInv(0.975);
  if (method === 'pocock') return POCOCK[K];
  return OBF[K] * Math.sqrt(K / k);
}

/**
 * Simulate group-sequential vaccine trials. At each of K equally spaced looks the
 * two-proportion z statistic (placebo minus vaccine) is compared with the boundary.
 */
export function sequentialTrials(o, rng) {
  const { nPerArm, p0, ve, K, nSim } = o;
  const p1 = p0 * (1 - ve);
  const methods = ['naive', 'pocock', 'obf'];
  const out = Object.fromEntries(methods.map(m => [m, { reject: 0, stopLook: new Array(K).fill(0), n: 0 }]));
  const paths = [];
  for (let s = 0; s < nSim; s++) {
    let c0 = 0, c1 = 0, n = 0;
    const zs = [];
    for (let k = 1; k <= K; k++) {
      const add = Math.round(nPerArm * k / K) - n;
      c0 += rng.binomial(add, p0); c1 += rng.binomial(add, p1); n += add;
      const pb = (c0 + c1) / (2 * n);
      const z = pb > 0 && pb < 1 ? (c0 / n - c1 / n) / Math.sqrt(pb * (1 - pb) * 2 / n) : 0;
      zs.push(z);
    }
    if (s < 40) paths.push(zs);
    for (const m of methods) {
      let stopped = K;
      for (let k = 1; k <= K; k++) if (Math.abs(zs[k - 1]) >= boundary(m, k, K)) { stopped = k; out[m].reject++; break; }
      out[m].stopLook[stopped - 1]++;
      out[m].n += 2 * Math.round(nPerArm * stopped / K);
    }
  }
  for (const m of methods) { out[m].rate = out[m].reject / nSim; out[m].expectedN = out[m].n / nSim; }
  return { ...out, paths, K };
}
