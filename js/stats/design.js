// Study-design toolkit for the Vaccine Lab.
//  • Synthetic Hollow population with age, frailty and "caution" (health behaviour)
//  • Observational cohort vs randomised trial of a vaccine
//  • 2×2 measures: risk ratio, odds ratio (Woolf CI), vaccine efficacy, χ² test
//  • Mantel–Haenszel stratified risk ratio (Greenland–Robins variance)
//  • Case–control sampling and the test-negative design
//  • Randomisation schemes: simple, permuted block, stratified block
//  • Sample size / power for two proportions and for a VE lower-bound criterion

import { normCdf, normInv, chi2Sf } from './dist.js';
import { simulateSEIRD } from '../models/ode.js';

const Z975 = 1.959963984540054;
const logit = p => Math.log(p / (1 - p));
const expit = x => 1 / (1 + Math.exp(-x));

export const AGE_GROUPS = ['18–39', '40–64', '65+'];

/** Residents of the Hollow: age group (0,1,2), frailty, cautious behaviour. */
export function makePopulation(n, rng, opts = {}) {
  const pAge = opts.pAge ?? [0.42, 0.38, 0.20];
  const pCaution = opts.pCaution ?? 0.4;
  const people = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng.uniform();
    const ag = u < pAge[0] ? 0 : u < pAge[0] + pAge[1] ? 1 : 2;
    people[i] = { ag, caution: rng.bernoulli(pCaution), frail: rng.bernoulli([0.1, 0.25, 0.5][ag]) };
  }
  return people;
}

/**
 * Probability of symptomatic infection over the season.
 * Older residents are at higher risk; cautious people have 40% of the exposure.
 */
export function infectionRisk(p, vax, ve, opts = {}) {
  const base = (opts.baseRisk ?? [0.06, 0.10, 0.18])[p.ag] * (opts.riskScale ?? 1);
  const exposure = p.caution ? (opts.cautionEffect ?? 0.4) : 1;
  return Math.min(0.999, base * exposure * (vax ? 1 - ve : 1));
}

/**
 * Self-selected vaccination: log-odds rise with age group and with caution.
 * orAge: odds ratio per age group step; orCaution: odds ratio for cautious people.
 */
export function vaccinationProbability(p, orAge, orCaution, baseline = 0.4) {
  return expit(logit(baseline) + Math.log(orAge) * (p.ag - 1) + Math.log(orCaution) * (p.caution - 0.4));
}

/** Counts of a 2×2 table: a = vax cases, b = vax non-cases, c = unvax cases, d = unvax non-cases. */
export function table2x2(rows) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const r of rows) {
    if (r.vax) { if (r.case) a++; else b++; } else { if (r.case) c++; else d++; }
  }
  return { a, b, c, d };
}

/** Risk ratio with log-scale Wald CI. */
export function riskRatio({ a, b, c, d }) {
  const r1 = a / (a + b), r0 = c / (c + d);
  const rr = r1 / r0;
  const se = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  return { est: rr, lo: rr * Math.exp(-Z975 * se), hi: rr * Math.exp(Z975 * se), se, r1, r0 };
}

/** Odds ratio with Woolf (log-scale) CI. */
export function oddsRatio({ a, b, c, d }) {
  const or = (a * d) / (b * c);
  const se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  return { est: or, lo: or * Math.exp(-Z975 * se), hi: or * Math.exp(Z975 * se), se };
}

/** Pearson χ² test for a 2×2 table (no continuity correction). */
export function chiSquare2x2({ a, b, c, d }) {
  const n = a + b + c + d;
  const chi2 = n * (a * d - b * c) ** 2 / ((a + b) * (c + d) * (a + c) * (b + d));
  return { chi2, p: chi2Sf(chi2, 1) };
}

/** Vaccine efficacy = 1 − ratio; the CI flips because VE is decreasing in the ratio. */
export function toVE(m) {
  return { est: 1 - m.est, lo: 1 - m.hi, hi: 1 - m.lo };
}

/**
 * Mantel–Haenszel pooled risk ratio across strata, with the Greenland–Robins
 * variance of log RR_MH. strata: array of {a, b, c, d}.
 */
export function mantelHaenszelRR(strata) {
  let num = 0, den = 0, v = 0;
  for (const { a, b, c, d } of strata) {
    const n1 = a + b, n0 = c + d, N = n1 + n0;
    if (N === 0) continue;
    num += a * n0 / N;
    den += c * n1 / N;
    v += (n1 * n0 * (a + c) - a * c * N) / (N * N);
  }
  const rr = num / den;
  const se = Math.sqrt(v / (num * den));
  return { est: rr, lo: rr * Math.exp(-Z975 * se), hi: rr * Math.exp(Z975 * se), se };
}

/**
 * Lesson 1 world: one population, two studies.
 *  observational: people choose vaccination (confounded by age and caution)
 *  rct:           a coin decides
 */
export function runConfoundingStudy(o, rng) {
  const people = makePopulation(o.n, rng);
  const obs = people.map(p => {
    const vax = rng.bernoulli(vaccinationProbability(p, o.orAge, o.orCaution));
    return { ...p, vax, case: rng.bernoulli(infectionRisk(p, vax, o.ve)) };
  });
  const rct = people.map(p => {
    const vax = rng.bernoulli(0.5);
    return { ...p, vax, case: rng.bernoulli(infectionRisk(p, vax, o.ve)) };
  });
  const strata = (rows, key, levels) => levels.map(l => table2x2(rows.filter(r => r[key] === l)));
  const ageStrata = strata(obs, 'ag', [0, 1, 2]);
  const fullStrata = [0, 1, 2].flatMap(ag => [0, 1].map(cz => table2x2(obs.filter(r => r.ag === ag && r.caution === cz))));
  const crude = table2x2(obs);
  return {
    obs, rct, crude, ageStrata,
    rctTable: table2x2(rct),
    est: {
      crude: riskRatio(crude),
      ageAdj: mantelHaenszelRR(ageStrata),
      fullAdj: mantelHaenszelRR(fullStrata),
      rct: riskRatio(table2x2(rct)),
    },
    uptake: {
      byAge: [0, 1, 2].map(ag => mean(obs.filter(r => r.ag === ag).map(r => r.vax))),
      byCaution: [0, 1].map(c => mean(obs.filter(r => r.caution === c).map(r => r.vax))),
    },
  };
}

function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN; }

/**
 * Lesson 2 world: a cohort in which we can run a full cohort analysis, a
 * case–control study and a test-negative study.
 * o: { n, ve, attackScale, controlsPerCase, seekOR, otherIllness, veOther, testProb }
 */
export function runCaseControlStudy(o, rng) {
  const people = makePopulation(o.n, rng);
  const rows = people.map(p => {
    const seeker = rng.bernoulli(0.5);
    // Health-care seekers are also more likely to get vaccinated (seekOR).
    const vax = rng.bernoulli(expit(logit(0.45) + Math.log(o.seekOR) * (seeker - 0.5) + Math.log(o.orAge ?? 1) * (p.ag - 1)));
    const infected = rng.bernoulli(infectionRisk(p, vax, o.ve, { riskScale: o.attackScale, cautionEffect: 1 }));
    // Some other febrile illness ("valley fever") that the vaccine shouldn't affect.
    const other = !infected && rng.bernoulli((o.otherIllness ?? 0.15) * (vax ? 1 - (o.veOther ?? 0) : 1));
    const pTest = seeker ? 0.8 : 0.25;
    const tested = (infected || other) && rng.bernoulli(pTest);
    return { ...p, seeker, vax, case: infected, other, tested };
  });

  const cohort = riskRatio(table2x2(rows));
  // Surveillance cohort: only clinic-confirmed infections count as cases.
  const surv = riskRatio(table2x2(rows.map(r => ({ vax: r.vax, case: r.case && r.tested }))));

  // Case–control: all cases, m controls per case sampled from non-cases at the end of the season.
  const cases = rows.filter(r => r.case);
  const noncases = rows.filter(r => !r.case);
  const m = Math.max(1, Math.round(o.controlsPerCase));
  // Controls: a simple random sample of non-cases, without replacement (partial Fisher–Yates).
  const pool = noncases.slice();
  const nCtrl = Math.min(pool.length, cases.length * m);
  for (let i = 0; i < nCtrl; i++) { const j = i + Math.floor(rng.uniform() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const controls = pool.slice(0, nCtrl);
  const cc = { a: cases.filter(r => r.vax).length, c: cases.filter(r => !r.vax).length, b: controls.filter(r => r.vax).length, d: controls.filter(r => !r.vax).length };

  // Test-negative: among the tested, positives are cases and negatives are controls.
  const tested = rows.filter(r => r.tested);
  const tnd = { a: tested.filter(r => r.case && r.vax).length, c: tested.filter(r => r.case && !r.vax).length,
    b: tested.filter(r => !r.case && r.vax).length, d: tested.filter(r => !r.case && !r.vax).length };

  const attack = { vax: cohort.r1, unvax: cohort.r0 };
  return {
    rows, cc, tnd, attack, ccRows: [...cases, ...controls], testedRows: tested,
    nCases: cases.length, nControls: controls.length, nTested: tested.length,
    est: { cohort, surv, cc: oddsRatio(cc), tnd: oddsRatio(tnd) },
  };
}

/** OR implied by risks r1, r0 — shows how far OR drifts from RR as the outcome becomes common. */
export function orFromRisks(r1, r0) { return (r1 / (1 - r1)) / (r0 / (1 - r0)); }

/**
 * Expected Woolf SE of log OR for a case–control study with nCases cases and m controls per case,
 * given exposure prevalence among cases (pc) and controls (pk).
 */
export function expectedLogOrSE(nCases, m, pc, pk) {
  const a = nCases * pc, c = nCases * (1 - pc), b = nCases * m * pk, d = nCases * m * (1 - pk);
  return Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Randomisation

/**
 * Allocate n participants (with age groups) to arms 0/1.
 * scheme: 'simple' (coin flips) | 'block' (permuted blocks of `block`) | 'stratified' (blocks within age group)
 */
export function randomise(ageGroups, scheme, rng, block = 4) {
  const n = ageGroups.length;
  const arms = new Array(n);
  const makeBlock = () => rng.shuffle([...Array(block / 2).fill(0), ...Array(block / 2).fill(1)]);
  if (scheme === 'simple') {
    for (let i = 0; i < n; i++) arms[i] = rng.bernoulli(0.5);
  } else if (scheme === 'block') {
    let buf = [];
    for (let i = 0; i < n; i++) { if (!buf.length) buf = makeBlock(); arms[i] = buf.pop(); }
  } else {
    const bufs = {};
    for (let i = 0; i < n; i++) {
      const g = ageGroups[i];
      if (!bufs[g] || !bufs[g].length) bufs[g] = makeBlock();
      arms[i] = bufs[g].pop();
    }
  }
  return arms;
}

/** Balance diagnostics of one allocation. */
export function balance(ageGroups, arms) {
  const n1 = arms.reduce((s, a) => s + a, 0), n0 = arms.length - n1;
  const old1 = ageGroups.filter((g, i) => g === 2 && arms[i] === 1).length;
  const old0 = ageGroups.filter((g, i) => g === 2 && arms[i] === 0).length;
  return {
    n1, n0,
    sizeDiff: Math.abs(n1 - n0),
    oldDiffPct: Math.abs((n1 ? old1 / n1 : 0) - (n0 ? old0 / n0 : 0)) * 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample size and power

/** Per-arm sample size for comparing two proportions (two-sided α), pooled-variance normal approximation. */
export function sampleSizeTwoProportions(p0, p1, alpha = 0.05, power = 0.8) {
  const za = normInv(1 - alpha / 2), zb = normInv(power);
  const pbar = (p0 + p1) / 2;
  const num = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1));
  return Math.ceil(num * num / (p0 - p1) ** 2);
}

export function powerTwoProportions(p0, p1, n, alpha = 0.05) {
  const za = normInv(1 - alpha / 2);
  const pbar = (p0 + p1) / 2;
  const z = (Math.abs(p0 - p1) * Math.sqrt(n) - za * Math.sqrt(2 * pbar * (1 - pbar))) / Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1));
  return normCdf(z);
}

/**
 * Per-arm sample size so that the lower 95% bound of VE exceeds `veMin`
 * (one-sided α = 0.025 test of H₀: RR ≥ 1 − veMin on the log scale).
 */
export function sampleSizeVELowerBound(p0, ve, veMin = 0.3, power = 0.9) {
  const p1 = p0 * (1 - ve);
  const z = Z975 + normInv(power);
  const v = (1 - p1) / p1 + (1 - p0) / p0;
  const delta = Math.log(1 - veMin) - Math.log(1 - ve);
  if (delta <= 0) return Infinity;
  return Math.ceil(z * z * v / (delta * delta));
}

export function powerVELowerBound(p0, ve, n, veMin = 0.3) {
  const p1 = p0 * (1 - ve);
  const se = Math.sqrt(((1 - p1) / p1 + (1 - p0) / p0) / n);
  const delta = Math.log(1 - veMin) - Math.log(1 - ve);
  return normCdf(delta / se - Z975);
}

/** Simulate a placebo-controlled VE trial; returns 2×2 table and VE with CI. */
export function simulateVETrial(nPerArm, p0, ve, rng) {
  const a = rng.binomial(nPerArm, p0 * (1 - ve)), c = rng.binomial(nPerArm, p0);
  const t = { a, b: nPerArm - a, c, d: nPerArm - c };
  const rr = a > 0 && c > 0 ? riskRatio(t) : riskRatio({ a: a + 0.5, b: t.b + 0.5, c: c + 0.5, d: t.d + 0.5 });
  return { table: t, rr, ve: toVE(rr), test: chiSquare2x2(t) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase III trial (Vaccine Lab case study "Phase III")

export const PHASE3 = {
  pAge: [0.42, 0.38, 0.20],
  riskByAge: [0.8, 1, 1.4],   // multiples of p0
  cautionEffect: 0.6,         // cautious residents' relative exposure
  pCaution: 0.4,
  received: 0.98,             // share of the vaccine arm that actually receives the injection
  lost: 0.03,                 // share with no outcome ascertained (missing completely at random)
};

/**
 * True values the Phase III analyses estimate, for hidden parameters
 * h = { ve (ages 18–64), elderlyFactor, p0 }.
 *  vaccinatedVE: population-average VE among those actually vaccinated (biological effect)
 *  ittVE:        VE of being randomised to vaccine = received × vaccinatedVE
 *  subgroupITT:  ITT VE within each age band
 *  placeboAttack: expected attack rate in the placebo arm
 */
export function phase3Truth(h) {
  const P = PHASE3;
  const veAge = ag => (ag === 2 ? h.ve * h.elderlyFactor : h.ve);
  let rv = 0, ru = 0;
  P.pAge.forEach((pa, ag) => { rv += pa * P.riskByAge[ag] * (1 - veAge(ag)); ru += pa * P.riskByAge[ag]; });
  const vaccinatedVE = 1 - rv / ru; // caution scales both arms equally and cancels
  const meanExposure = P.pCaution * P.cautionEffect + (1 - P.pCaution);
  return {
    vaccinatedVE,
    ittVE: P.received * vaccinatedVE,
    subgroupITT: [0, 1, 2].map(ag => P.received * veAge(ag)),
    placeboAttack: h.p0 * ru * meanExposure,
  };
}

/** Simulate the Phase III trial: screening, randomisation, receipt, losses, outcomes. */
export function simulatePhase3(h, nPerArm, scheme, rng) {
  const P = PHASE3;
  const n = 2 * nPerArm;
  const people = makePopulation(n, rng, { pAge: P.pAge, pCaution: P.pCaution });
  const arms = randomise(people.map(p => p.ag), scheme, rng);
  const excluded = rng.binomial(Math.round(n / 0.82), 0.18);
  const notEligible = rng.binomial(excluded, 0.62), declined = rng.binomial(excluded - notEligible, 0.75);
  const all = people.map((p, i) => {
    const vax = arms[i];
    const received = vax ? rng.bernoulli(P.received) : 0;
    const lost = rng.bernoulli(P.lost);
    const ve = p.ag === 2 ? h.ve * h.elderlyFactor : h.ve;
    const risk = infectionRisk(p, received, ve, { baseRisk: P.riskByAge.map(m => h.p0 * m), cautionEffect: P.cautionEffect });
    return { ag: p.ag, vax, received, lost, case: rng.bernoulli(risk) };
  });
  const rows = all.filter(r => !r.lost); // ITT among everyone with an outcome
  const arm = v => all.filter(r => r.vax === v);
  const consort = {
    screened: n + excluded, excluded, notEligible, declined, other: excluded - notEligible - declined, randomised: n,
    arms: [1, 0].map(v => ({
      allocated: arm(v).length,
      received: v ? arm(v).filter(r => r.received).length : arm(v).length,
      notReceived: v ? arm(v).filter(r => !r.received).length : 0,
      lost: arm(v).filter(r => r.lost).length, analysed: arm(v).filter(r => !r.lost).length,
    })),
  };
  const t = table2x2(rows);
  const strata = [0, 1, 2].map(ag => table2x2(rows.filter(r => r.ag === ag)));
  const safeRR = tb => riskRatio(tb.a && tb.c ? tb : { a: tb.a + 0.5, b: tb.b + 0.5, c: tb.c + 0.5, d: tb.d + 0.5 });
  return {
    t, strata, consort, n, rr: safeRR(t), mh: mantelHaenszelRR(strata), test: chiSquare2x2(t), sub: strata.map(safeRR),
    old: [rows.filter(r => r.vax && r.ag === 2).length, rows.filter(r => !r.vax && r.ag === 2).length],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The Phase III trial runs inside the outbreak

export const TRIAL_TIMELINE = {
  earliestStart: 28,      // days after the flood before trial doses exist
  enrolPerWeek: 3000,     // participants the clinics can enrol each week
  followUpDays: 42,       // each participant is followed for 6 weeks
  reviewDays: 7,          // analysis and licensing decision
  maxShare: 0.6,          // at most 60% of still-susceptible residents can be enrolled
  endpointFraction: 0.25, // share of infections that cause symptomatic, lab-confirmed illness (the endpoint)
};

/** Pathogen used when no outbreak has been released in Outbreak Architect. */
export const DEFAULT_OUTBREAK = { R0: 2.5, latent: 3, infectious: 6, cfr: 0.03, N: 20000, I0: 3, immune: 0 };

/**
 * Where the trial sits on the epidemic curve. Participants are enrolled uniformly from
 * `startDay` over the enrolment period and followed for 6 weeks; their placebo-arm risk is the
 * probability that a still-susceptible resident is infected during their own follow-up window,
 * (C(t + 42) − C(t)) / S(t), averaged over enrolment days t (C = cumulative infections),
 * times the share of infections that produce the trial endpoint.
 * Returns that attack rate, the corresponding p0 for simulatePhase3, and the licensing week.
 */
export function trialEpidemic(outbreak, startDay, nPerArm) {
  const T = TRIAL_TIMELINE;
  const o = outbreak ?? DEFAULT_OUTBREAK;
  const traj = simulateSEIRD({ ...o, days: 400, dt: 0.25 });
  const enrolDays = Math.max(1, Math.ceil((2 * nPerArm) / T.enrolPerWeek * 7));
  let risk = 0, k = 0;
  for (let t = startDay; t < startDay + enrolDays && t + T.followUpDays < traj.days.length; t++) {
    risk += (traj.cumInc[t + T.followUpDays] - traj.cumInc[t]) / Math.max(1, traj.S[t]);
    k++;
  }
  const infectionRisk = k ? risk / k : 0;
  const attack = infectionRisk * T.endpointFraction;
  const P = PHASE3;
  const ru = P.pAge.reduce((s2, pa, ag) => s2 + pa * P.riskByAge[ag], 0);
  const meanExposure = P.pCaution * P.cautionEffect + (1 - P.pCaution);
  const p0 = Math.min(0.66, attack / (ru * meanExposure)); // keeps every individual risk below 1
  const decisionDay = startDay + enrolDays + T.followUpDays + T.reviewDays;
  return {
    traj, enrolDays, attack, infectionRisk, p0, capped: p0 >= 0.66,
    windowEnd: startDay + enrolDays + T.followUpDays,
    decisionDay,
    approvalWeek: Math.floor(decisionDay / 7) + 1,
    maxPerArm: Math.max(100, Math.floor(T.maxShare * traj.S[Math.min(startDay, traj.S.length - 1)] / 2 / 100) * 100),
    outbreak: o, isDefault: !outbreak,
  };
}
