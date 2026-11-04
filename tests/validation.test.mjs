// Monte Carlo validation of the basic Vaccine Lab experiments.
// Each test repeats a study many times and checks bias and 95% CI coverage against the
// known truth of the simulation. Coverage tolerances allow for Monte Carlo error
// (with R repetitions, the SE of a 95% coverage estimate is sqrt(.95·.05/R)).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConfoundingStudy, runCaseControlStudy, toVE, mantelHaenszelRR, table2x2, simulatePhase3, phase3Truth,
  simulateVETrial, powerVELowerBound } from '../js/stats/design.js';
import { logistic } from '../js/stats/regression.js';
import { makeRng } from '../js/stats/rng.js';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const covers = (ci, truth) => ci.lo <= truth && truth <= ci.hi;
const inRange = (x, lo, hi, msg) => assert.ok(x >= lo && x <= hi, `${msg}: ${x.toFixed(3)} not in [${lo}, ${hi}]`);

test('Case study 1 — RCT and fully adjusted MH are unbiased with ~95% coverage; crude is biased', () => {
  const rng = makeRng(101);
  const ve = 0.6, R = 200;
  const est = { crude: [], ageAdj: [], fullAdj: [], rct: [] }, cov = { fullAdj: 0, rct: 0 };
  for (let i = 0; i < R; i++) {
    const r = runConfoundingStudy({ n: 8000, ve, orAge: 2.5, orCaution: 3 }, rng);
    for (const k of Object.keys(est)) est[k].push(1 - r.est[k].est);
    if (covers(toVE(r.est.rct), ve)) cov.rct++;
    if (covers(toVE(r.est.fullAdj), ve)) cov.fullAdj++;
  }
  inRange(mean(est.rct) - ve, -0.015, 0.015, 'RCT bias');
  inRange(mean(est.fullAdj) - ve, -0.015, 0.015, 'fully adjusted bias');
  inRange(cov.rct / R, 0.91, 0.99, 'RCT coverage');
  inRange(cov.fullAdj / R, 0.91, 0.99, 'MH coverage');
  // Unmeasured caution (OR 3) inflates VE even after age adjustment.
  assert.ok(mean(est.ageAdj) - ve > 0.03, `age-adjusted should stay biased upward, got ${(mean(est.ageAdj) - ve).toFixed(3)}`);
});

test('Case study 1 — with no confounding, crude = adjusted = truth', () => {
  const rng = makeRng(102);
  const xs = [];
  for (let i = 0; i < 100; i++) xs.push(1 - runConfoundingStudy({ n: 8000, ve: 0.5, orAge: 1, orCaution: 1 }, rng).est.crude.est);
  inRange(mean(xs) - 0.5, -0.02, 0.02, 'crude bias without confounders');
});

test('Case study 2 — age-adjusted case–control and test-negative recover VE when the disease is rare', () => {
  const rng = makeRng(103);
  const ve = 0.6, R = 120;
  const adj = rows => {
    const c = logistic(rows.map(x => [x.vax, x.ag === 1 ? 1 : 0, x.ag === 2 ? 1 : 0]), rows.map(x => (x.case ? 1 : 0))).coefs[1];
    return { est: 1 - c.or, lo: 1 - c.hi, hi: 1 - c.lo };
  };
  const cc = [], tnd = [], crude = [], surv = [];
  let covCC = 0;
  for (let i = 0; i < R; i++) {
    const r = runCaseControlStudy({ n: 30000, ve, attackScale: 0.3, controlsPerCase: 4, seekOR: 3, veOther: 0, otherIllness: 0.15, orAge: 2.5 }, rng);
    const a = adj(r.ccRows); cc.push(a.est); if (covers(a, ve)) covCC++;
    tnd.push(adj(r.testedRows).est);
    crude.push(1 - r.est.cc.est);
    surv.push(1 - mantelHaenszelRR([0, 1, 2].map(ag => table2x2(r.rows.filter(x => x.ag === ag).map(x => ({ vax: x.vax, case: x.case && x.tested }))))).est);
  }
  // With attack rates of ~2–5% the OR exceeds the RR slightly; allow for that.
  inRange(mean(cc) - ve, -0.01, 0.03, 'case–control (logistic, age-adjusted) bias');
  inRange(mean(tnd) - ve, -0.01, 0.03, 'test-negative (logistic, age-adjusted) bias');
  inRange(covCC / R, 0.88, 0.99, 'case–control CI coverage');
  assert.ok(mean(crude) < mean(cc) - 0.03, 'crude case–control OR is confounded by age (VE too low)');
  assert.ok(mean(surv) < ve - 0.05, 'clinic-confirmed cohort shows detection bias even after age adjustment');
});

test('Sample size case study — simulated power matches the analytic licensure-criterion power', () => {
  const rng = makeRng(104);
  for (const [n, p0, ve] of [[1500, 0.04, 0.6], [3000, 0.02, 0.7]]) {
    let ok = 0;
    for (let i = 0; i < 1500; i++) if (simulateVETrial(n, p0, ve, rng).ve.lo > 0.3) ok++;
    inRange(ok / 1500 - powerVELowerBound(p0, ve, n, 0.3), -0.04, 0.04, `power n=${n}`);
  }
});

test('Phase III — truth formulas match a large simulation; ITT 95% CI covers the ITT estimand', () => {
  const rng = makeRng(105);
  const h = { ve: 0.75, elderlyFactor: 0.75, p0: 0.05 };
  const T = phase3Truth(h);
  // Very large trial: point estimates should sit on the analytic truths.
  const big = simulatePhase3(h, 150000, 'block', rng);
  inRange(1 - big.rr.est - T.ittVE, -0.015, 0.015, 'ITT VE vs truth');
  inRange(big.rr.r0 - T.placeboAttack, -0.002, 0.002, 'placebo attack rate vs truth');
  big.sub.forEach((s, ag) => inRange(1 - s.est - T.subgroupITT[ag], -0.04, 0.04, `subgroup ${ag}`));
  // Coverage over repeated realistic trials.
  let cov = 0; const R = 300;
  for (let i = 0; i < R; i++) if (covers(toVE(simulatePhase3(h, 2500, 'stratified', rng).rr), T.ittVE)) cov++;
  inRange(cov / R, 0.92, 0.98, 'ITT CI coverage');
});
