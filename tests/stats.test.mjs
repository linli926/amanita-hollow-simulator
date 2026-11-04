import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kaplanMeier, kmMedian, nelsonAalen, logRank, coxPH, concordance, schoenfeldEvents, schoenfeldPower, simulateTrial, simulatePower } from '../js/stats/survival.js';
import { fitMLE, profileR0, poissonGrowthGLM, coriRt, expectedCases } from '../js/stats/inference.js';
import { generationInterval, growthRateFromR0 } from '../js/models/theory.js';
import { makeRng } from '../js/stats/rng.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

// Classic textbook example: remission times, 6-MP arm
const t6mp = [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35];
const e6mp = [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];
const tPla = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
const ePla = new Array(21).fill(1);

test('Kaplan–Meier matches the Gehan 6-MP textbook values', () => {
  const km = kaplanMeier(t6mp, e6mp);
  const at = t => km.curve.filter(p => p.t <= t).at(-1).s;
  close(at(6), 0.8571, 1e-4);
  close(at(7), 0.8067, 1e-4);
  close(at(10), 0.7529, 1e-4);
  close(at(13), 0.6902, 1e-4);
  close(at(23), 0.4482, 1e-4);
  // Greenwood SE at t = 6 is 0.0764
  close(km.curve[1].se, 0.0764, 1e-4);
  assert.equal(kmMedian(km).median, 23);
});

test('Nelson–Aalen increments are d/n', () => {
  const na = nelsonAalen([1, 2, 2, 3], [1, 1, 0, 1]);
  close(na[1].H, 1 / 4, 1e-12);
  close(na[2].H, 1 / 4 + 1 / 3, 1e-12);
  close(na[3].H, 1 / 4 + 1 / 3 + 1, 1e-12);
});

test('log-rank test on the Gehan data (χ² = 16.79)', () => {
  const times = [...t6mp, ...tPla], events = [...e6mp, ...ePla];
  const groups = [...t6mp.map(() => 1), ...tPla.map(() => 0)];
  const lr = logRank(times, events, groups);
  close(lr.chi2, 16.79, 0.01);
  assert.ok(lr.p < 0.0001);
});

test('Cox model on the Gehan data (Breslow): β = −1.509, SE = 0.410', () => {
  const times = [...t6mp, ...tPla], events = [...e6mp, ...ePla];
  const X = [...t6mp.map(() => [1]), ...tPla.map(() => [0])];
  const fit = coxPH(times, events, X, ['6-MP']);
  close(fit.coefs[0].beta, -1.509, 0.002);
  close(fit.coefs[0].se, 0.410, 0.002);
  assert.ok(fit.converged);
});

test('Cox recovers simulated hazard ratios', () => {
  const rng = makeRng(2024);
  const { patients } = simulateTrial({ n: 3000, hr: 0.6, hrAgePer10: 1.4, hrComorb: 2, controlMortality: 0.5, shape: 1.3, followUpDays: 90 }, rng);
  const X = patients.map(p => [p.trt, (p.age - 55) / 10, p.comorb]);
  const fit = coxPH(patients.map(p => p.time), patients.map(p => p.event), X);
  close(fit.coefs[0].hr, 0.6, 0.06, 'treatment');
  close(fit.coefs[1].hr, 1.4, 0.07, 'age');
  close(fit.coefs[2].hr, 2.0, 0.15, 'comorb');
  const c = concordance(patients.map(p => p.time), patients.map(p => p.event), fit.linearPredictor);
  assert.ok(c > 0.6 && c < 0.8, `C-index ${c}`);
});

test('Schoenfeld formula: HR 0.7, 80% power needs ~247 events', () => {
  close(schoenfeldEvents(0.7, 0.05, 0.8), 247, 1);
  close(schoenfeldPower(0.7, 247), 0.8, 0.005);
});

test('simulated power is close to Schoenfeld prediction', () => {
  const rng = makeRng(11);
  const o = { n: 300, hr: 0.6, controlMortality: 0.5, shape: 1, followUpDays: 60, accrualDays: 0, hrAgePer10: 1, hrComorb: 1 };
  const events = simulateTrial({ ...o, n: 20000 }, rng).patients.reduce((s, p) => s + p.event, 0) / 20000 * o.n;
  const pred = schoenfeldPower(0.6, events);
  const sim = simulatePower(o, rng, 300);
  close(sim.power, pred, 0.08);
});

test('Poisson GLM recovers the growth rate and MLE recovers R0', () => {
  const known = { N: 50000, latent: 3, infectious: 5 };
  const truth = { R0: 2.2, rho: 0.4, I0: 5, k: 30 };
  const rng = makeRng(3);
  const mu = expectedCases(truth, known, 70);
  const y = mu.map((m, t) => (t === 0 ? 0 : rng.negBin(m, truth.k)));
  const glm = poissonGrowthGLM(y, 10, 40);
  close(glm.r, growthRateFromR0(2.2, 3, 5), 0.02);
  const mle = fitMLE(y, known);
  close(mle.R0, 2.2, 0.15, 'R0');
  close(mle.rho, 0.4, 0.08, 'rho');
  const prof = profileR0(y, known, mle, 15);
  assert.ok(prof.ciLo < 2.2 && prof.ciHi > 2.2, `CI ${prof.ciLo}–${prof.ciHi}`);
});

test('Cori Rt is ~R0 during exponential growth', () => {
  const known = { N: 1e7, latent: 3, infectious: 5 };
  const mu = expectedCases({ R0: 2, rho: 1, I0: 10, k: 1e4 }, known, 60);
  const w = generationInterval(3, 5, 60);
  const rt = coriRt(mu.map(x => Math.round(x)), w, 7);
  const late = rt.filter(r => r.t > 40);
  late.forEach(r => close(r.mean, 2, 0.15, `t=${r.t}`));
});

test('non-collapsibility: the unadjusted Cox HR is closer to 1 when prognostic covariates matter', async () => {
  const { marginalHR } = await import('../js/stats/survival.js');
  const base = { hr: 0.6, controlMortality: 0.4, shape: 1.2, followUpDays: 60, accrualDays: 30, dropoutRate: 0 };
  const none = marginalHR({ ...base, hrAgePer10: 1, hrComorb: 1 }, makeRng(1), 30000);
  close(none, 0.6, 0.03, 'no prognostic factors: marginal = conditional');
  const strong = marginalHR({ ...base, hrAgePer10: 1.8, hrComorb: 4 }, makeRng(2), 30000);
  assert.ok(strong > 0.64, `marginal HR ${strong.toFixed(3)} should be pulled towards 1`);
});
