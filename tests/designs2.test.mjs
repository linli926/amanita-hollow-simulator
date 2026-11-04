import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logistic, clogit, coxCountingProcess } from '../js/stats/regression.js';
import { makeCohort, fullCohortCox, nestedCaseControl, caseCohort, secondaryOutcomeStudy } from '../js/stats/sampling.js';
import { complianceTrial, caceBootstrap, sequentialTrials, boundary } from '../js/stats/trials.js';
import { coxPH } from '../js/stats/survival.js';
import { oddsRatio } from '../js/stats/design.js';
import { makeRng } from '../js/stats/rng.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('logistic regression with one binary covariate reproduces the 2×2 odds ratio and Woolf SE', () => {
  const X = [], y = [];
  const add = (x, yy, k) => { for (let i = 0; i < k; i++) { X.push([x]); y.push(yy); } };
  add(1, 1, 20); add(1, 0, 80); add(0, 1, 40); add(0, 0, 60);
  const c = logistic(X, y).coefs[1];
  const or = oddsRatio({ a: 20, b: 80, c: 40, d: 60 });
  close(c.or, or.est, 1e-8); close(c.se, or.se, 1e-6);
});

test('conditional logistic regression on 1:1 pairs gives the McNemar OR b/c', () => {
  // discordant pairs: case exposed/control not (b = 30), case not/control exposed (c = 10)
  const sets = [];
  for (let i = 0; i < 30; i++) sets.push({ x: [[1], [0]] });
  for (let i = 0; i < 10; i++) sets.push({ x: [[0], [1]] });
  for (let i = 0; i < 25; i++) sets.push({ x: [[1], [1]] });
  for (let i = 0; i < 25; i++) sets.push({ x: [[0], [0]] });
  const c = clogit(sets).coefs[0];
  close(c.or, 3, 1e-6); close(c.se, Math.sqrt(1 / 30 + 1 / 10), 1e-4);
});

test('counting-process Cox with unit weights matches the standard Cox fit', () => {
  const rng = makeRng(5);
  const ppl = makeCohort({ n: 1500, ve: 0.5 }, rng);
  const a = coxPH(ppl.map(p => p.time), ppl.map(p => p.event), ppl.map(p => [p.vax, p.ag]));
  const b = coxCountingProcess(ppl.map(p => ({ id: p.id, start: 0, stop: p.time, event: p.event, w: 1, x: [p.vax, p.ag] })));
  close(b.beta[0], a.coefs[0].beta, 1e-6);
  close(b.naive[0].se, a.coefs[0].se, 1e-6);
  close(b.coefs[0].se, a.coefs[0].se, 0.15 * a.coefs[0].se, 'robust ≈ model SE when the model is right');
});

test('nested case–control and case–cohort recover the full-cohort hazard ratio', () => {
  const rng = makeRng(21);
  const ppl = makeCohort({ n: 8000, ve: 0.6, baseRisk: 0.08 }, rng);
  const full = fullCohortCox(ppl).coefs[0].hr;
  const ncc = nestedCaseControl(ppl, 4, rng);
  const cc = caseCohort(ppl, 0.15, rng);
  close(ncc.fit.coefs[0].or, full, 0.12, 'NCC');
  close(cc.fit.coefs[0].or, full, 0.12, 'case-cohort');
  assert.ok(ncc.measured < 8000 / 2 && cc.measured < 8000 / 2);
});

test('secondary outcome: IPW recovers the population OR, naive analysis is biased', () => {
  const rng = makeRng(31);
  const r = secondaryOutcomeStudy({ N: 200000, orXY: 0.5, orXD: 0.4, orYD: 6, pD: 0.03, controlsPerCase: 2 }, rng);
  close(r.ipw.or, r.truth.or, 0.08, 'IPW');
  assert.ok(Math.abs(r.naive.or - r.truth.or) > 0.08, `naive ${r.naive.or} vs truth ${r.truth.or}`);
});

test('CACE recovers the efficacy among compliers; per-protocol is biased', () => {
  const rng = makeRng(41);
  const r = complianceTrial({ nPerArm: 40000, p0: 0.05, ve: 0.7, refusal: 0.3, refusalOR: 4 }, rng);
  close(r.cace, 0.7, 0.05, 'CACE');
  assert.ok(r.itt.est < 0.6, 'ITT diluted');
  assert.ok(r.pp.est > 0.72, `per-protocol inflated: ${r.pp.est}`);
  const ci = caceBootstrap(r.rows.slice(0, 8000), rng, 50);
  assert.ok(ci.lo < ci.hi);
});

test('group-sequential boundaries: naive looks inflate α; Pocock and O\'Brien–Fleming hold it at 5%', () => {
  const rng = makeRng(51);
  const r = sequentialTrials({ nPerArm: 4000, p0: 0.1, ve: 0, K: 5, nSim: 4000 }, rng);
  close(r.naive.rate, 0.142, 0.025, 'naive with 5 looks ≈ 14.2%');
  close(r.pocock.rate, 0.05, 0.015, 'Pocock');
  close(r.obf.rate, 0.05, 0.015, 'OBF');
  close(boundary('obf', 1, 5), 2.04 * Math.sqrt(5), 1e-9);
});
