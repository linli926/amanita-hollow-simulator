// Sampling designs within a cohort ("study base") — Reilly, Controlled Epidemiological Studies.
//  • Cohort with time-to-infection (Weibull-free exponential hazards)
//  • Nested case–control by risk-set (incidence-density) sampling
//  • Case–cohort with a random subcohort and Barlow weights
//  • Reuse of case–control data for a secondary outcome (naive / controls-only / IPW)

import { coxPH } from './survival.js';
import { clogit, coxCountingProcess, logistic } from './regression.js';

const expit = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(p / (1 - p));

/**
 * A cohort of n residents followed for up to `days`.
 * Hazard: h = λ₀ · HR_vax^vax · HR_age^(band−1). Older residents vaccinate more (confounding).
 */
export function makeCohort(o, rng) {
  const days = o.days ?? 365;
  const lambda0 = -Math.log(1 - (o.baseRisk ?? 0.08)) / days;
  const hrVax = 1 - o.ve, hrAge = o.hrAge ?? 1.8;
  const drop = o.dropoutPerYear ?? 0.1;
  const people = [];
  for (let i = 0; i < o.n; i++) {
    const u = rng.uniform();
    const ag = u < 0.42 ? 0 : u < 0.8 ? 1 : 2;
    const vax = rng.bernoulli(expit(logit(0.45) + 0.6 * (ag - 1)));
    const h = lambda0 * Math.pow(hrVax, vax) * Math.pow(hrAge, ag - 1);
    const T = rng.exponential(h);
    const C = Math.min(days, drop > 0 ? rng.exponential(-Math.log(1 - drop) / 365) : Infinity);
    people.push({ id: i, ag, vax, time: Math.min(T, C), event: T <= C ? 1 : 0 });
  }
  return people;
}

const covs = p => [p.vax, p.ag];
export const COX_NAMES = ['Vaccinated', 'Age band'];

export function fullCohortCox(people) {
  return coxPH(people.map(p => p.time), people.map(p => p.event), people.map(covs), COX_NAMES);
}

/** Nested case–control: for each case, m controls drawn from those still at risk at the case's event time. */
export function nestedCaseControl(people, m, rng) {
  const sorted = people.slice().sort((a, b) => a.time - b.time);
  const sets = [];
  const measured = new Set();
  for (let k = 0; k < sorted.length; k++) {
    const c = sorted[k];
    if (!c.event) continue;
    const riskSet = sorted.length - k - 1; // indices k+1.. are at risk (continuous times, no ties)
    const chosen = new Set();
    const want = Math.min(m, riskSet);
    while (chosen.size < want) chosen.add(k + 1 + Math.floor(rng.uniform() * riskSet));
    const ctrls = [...chosen].map(j => sorted[j]);
    sets.push({ x: [covs(c), ...ctrls.map(covs)] });
    measured.add(c.id); ctrls.forEach(p => measured.add(p.id));
  }
  return { fit: clogit(sets, COX_NAMES), measured: measured.size, sets: sets.length };
}

/** Case–cohort: random subcohort (fraction alpha) plus all cases; Barlow-weighted Cox with robust SE. */
export function caseCohort(people, alpha, rng) {
  const recs = [];
  const eps = 1e-6;
  let measured = 0, sub = 0;
  for (const p of people) {
    const inSub = rng.uniform() < alpha;
    if (inSub) sub++;
    if (!inSub && !p.event) continue;
    measured++;
    const x = covs(p);
    if (inSub && !p.event) recs.push({ id: p.id, start: 0, stop: p.time, event: 0, w: 1 / alpha, x });
    else if (inSub && p.event) {
      recs.push({ id: p.id, start: 0, stop: p.time - eps, event: 0, w: 1 / alpha, x });
      recs.push({ id: p.id, start: p.time - eps, stop: p.time, event: 1, w: 1, x });
    } else recs.push({ id: p.id, start: p.time - eps, stop: p.time, event: 1, w: 1, x });
  }
  return { fit: coxCountingProcess(recs, COX_NAMES), measured, subcohort: sub };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Secondary-outcome reuse (Reilly et al. 2005).
 * X = vaccinated, Y = secondary outcome (e.g. raised liver enzymes), D = primary disease
 * (hospitalised Amanita infection). The case–control sample was drawn on D; we want OR(X→Y)
 * in the population.
 */
export function secondaryOutcomeStudy(o, rng) {
  const N = o.N ?? 60000;
  const pop = [];
  for (let i = 0; i < N; i++) {
    const x = rng.bernoulli(0.5);
    const y = rng.bernoulli(expit(logit(o.pY ?? 0.15) + Math.log(o.orXY) * (x - 0.5)));
    const d = rng.bernoulli(expit(logit(o.pD ?? 0.02) + Math.log(o.orXD) * (x - 0.5) + Math.log(o.orYD) * (y - 0.15)));
    pop.push({ x, y, d });
  }
  const cases = pop.filter(p => p.d);
  const non = pop.filter(p => !p.d);
  const m = o.controlsPerCase ?? 2;
  const nCtrl = Math.min(non.length, cases.length * m);
  const ctrls = [];
  for (let i = 0; i < nCtrl; i++) ctrls.push(non[Math.floor(rng.uniform() * non.length)]);
  const sample = [...cases, ...ctrls];
  const wCase = 1, wCtrl = non.length / nCtrl; // inverse sampling probabilities
  const fit = (rows, opts = {}) => logistic(rows.map(r => [r.x]), rows.map(r => r.y), { names: ['Vaccinated'], ...opts }).coefs[1];
  const fitAdj = rows => logistic(rows.map(r => [r.x, r.d]), rows.map(r => r.y), { names: ['Vaccinated', 'Case status'] }).coefs[1];
  return {
    truth: fit(pop),
    naive: fit(sample),
    adjD: fitAdj(sample),
    controls: fit(ctrls),
    ipw: fit(sample, { w: sample.map(r => (r.d ? wCase : wCtrl)), robust: true }),
    nCases: cases.length, nControls: nCtrl, prevalence: cases.length / N,
    pYcases: cases.filter(c => c.y).length / Math.max(1, cases.length),
    pYcontrols: ctrls.filter(c => c.y).length / Math.max(1, ctrls.length),
  };
}
