import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskRatio, oddsRatio, mantelHaenszelRR, chiSquare2x2, toVE, sampleSizeTwoProportions, powerTwoProportions,
  sampleSizeVELowerBound, powerVELowerBound, simulateVETrial, runConfoundingStudy, runCaseControlStudy,
  randomise, balance, orFromRisks } from '../js/stats/design.js';
import { makeRng } from '../js/stats/rng.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('2×2 measures', () => {
  const t = { a: 20, b: 80, c: 40, d: 60 };
  close(riskRatio(t).est, 0.5, 1e-12);
  close(oddsRatio(t).est, (20 * 60) / (80 * 40), 1e-12);
  close(oddsRatio(t).se, Math.sqrt(1 / 20 + 1 / 80 + 1 / 40 + 1 / 60), 1e-12);
  close(chiSquare2x2(t).chi2, 200 * (20 * 60 - 80 * 40) ** 2 / (100 * 100 * 60 * 140), 1e-9);
  const ve = toVE(riskRatio(t));
  close(ve.est, 0.5, 1e-12);
  assert.ok(ve.lo < 0.5 && ve.hi > 0.5);
});

test('Mantel–Haenszel RR equals the common RR and differs from a confounded crude RR (Simpson)', () => {
  // Two strata, each with RR = 0.5, but exposure concentrated in the high-risk stratum.
  const s1 = { a: 5, b: 95, c: 90, d: 810 };   // low risk: 5% vs 10%
  const s2 = { a: 180, b: 720, c: 40, d: 60 }; // high risk: 20% vs 40%
  close(mantelHaenszelRR([s1, s2]).est, 0.5, 1e-9);
  const crude = riskRatio({ a: 185, b: 815, c: 130, d: 870 });
  assert.ok(crude.est > 1, 'crude points the wrong way');
});

test('sample size formula matches the textbook value', () => {
  assert.equal(sampleSizeTwoProportions(0.02, 0.01, 0.05, 0.8), 2319); // 2318.4 rounded up
  close(powerTwoProportions(0.02, 0.01, 2318), 0.8, 0.005);
  const n = sampleSizeVELowerBound(0.05, 0.7, 0.3, 0.9);
  close(powerVELowerBound(0.05, 0.7, n, 0.3), 0.9, 0.01);
});

test('simulated VE trials agree with the analytic power', () => {
  const rng = makeRng(4);
  const n = 1500, p0 = 0.04, ve = 0.6;
  let ok = 0;
  for (let i = 0; i < 1000; i++) if (simulateVETrial(n, p0, ve, rng).ve.lo > 0.3) ok++;
  close(ok / 1000, powerVELowerBound(p0, ve, n, 0.3), 0.06);
});

test('observational estimate is biased by confounding; RCT and full adjustment are not', () => {
  const rng = makeRng(8);
  const o = { n: 60000, ve: 0.5, orAge: 1, orCaution: 4 };
  const r = runConfoundingStudy(o, rng);
  assert.ok(1 - r.est.crude.est > 0.56, `crude VE ${1 - r.est.crude.est} should be inflated`);
  close(1 - r.est.rct.est, 0.5, 0.06, 'RCT');
  close(1 - r.est.fullAdj.est, 0.5, 0.06, 'adjusted for age + caution');
});

test('case–control OR ≈ RR when rare; test-negative removes health-seeking bias', () => {
  const rng = makeRng(12);
  const r = runCaseControlStudy({ n: 80000, ve: 0.6, attackScale: 0.2, controlsPerCase: 4, seekOR: 3, otherIllness: 0.2, veOther: 0 }, rng);
  close(1 - r.est.cc.est, 0.6, 0.08, 'case-control');
  close(1 - r.est.tnd.est, 0.6, 0.08, 'test-negative');
  close(1 - r.est.cohort.est, 0.6, 0.06, 'full cohort');
  assert.ok(Math.abs(orFromRisks(0.3, 0.5) - 0.6) > 0.15, 'OR diverges from RR when common');
});

test('stratified block randomisation balances arms within strata', () => {
  const rng = makeRng(3);
  const ages = Array.from({ length: 101 }, () => rng.int(0, 2));
  for (let k = 0; k < 50; k++) {
    const b = balance(ages, randomise(ages, 'block', rng));
    assert.ok(b.sizeDiff <= 2);
    const s = randomise(ages, 'stratified', rng);
    for (const g of [0, 1, 2]) {
      const idx = ages.map((a, i) => (a === g ? i : -1)).filter(i => i >= 0);
      const ones = idx.filter(i => s[i] === 1).length;
      assert.ok(Math.abs(2 * ones - idx.length) <= 2);
    }
  }
});
