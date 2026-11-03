import { test } from 'node:test';
import assert from 'node:assert/strict';

import { simulateSEIRD, summarise } from '../js/models/ode.js';
import { gillespieSEIRD, tauLeapSEIRD, runEnsemble, gravityMixing, metapopNGM, metapopInit, metapopStepDay } from '../js/models/stochastic.js';
import { finalSize, growthRateFromR0, R0FromGrowthRate, extinctionProbability, generationInterval, meanOf } from '../js/models/theory.js';
import { spectralRadius } from '../js/stats/optim.js';
import { makeRng } from '../js/stats/rng.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
const base = { N: 10000, I0: 10, R0: 2.5, latent: 3, infectious: 6, cfr: 0.03, days: 250 };

test('SEIRD conserves population', () => {
  const tr = simulateSEIRD(base);
  for (let d = 0; d < tr.days.length; d += 25) {
    close(tr.S[d] + tr.E[d] + tr.I[d] + tr.R[d] + tr.D[d] + tr.V[d], base.N, 1e-6);
  }
});

test('ODE attack rate agrees with the final-size equation', () => {
  for (const R0 of [1.5, 2.5, 4]) {
    for (const immune of [0, 0.3]) {
      const tr = simulateSEIRD({ ...base, R0, immune, I0: 1, days: 4000, dt: 0.25 });
      const z = finalSize(R0, 1 - immune);
      close(summarise(tr).totalInfected / base.N, z, 0.01, `R0=${R0} immune=${immune}`);
    }
  }
});

test('deaths are CFR × infections', () => {
  const tr = simulateSEIRD({ ...base, days: 600 });
  const s = summarise(tr);
  close(s.deaths / (s.totalInfected + base.I0), base.cfr, 1e-4);
});

test('Wallinga–Lipsitch: growth rate round-trips and matches the ODE', () => {
  const r = growthRateFromR0(2.5, 3, 6);
  close(R0FromGrowthRate(r, 3, 6), 2.5, 1e-12);
  const tr = simulateSEIRD({ ...base, N: 1e8, I0: 1 });
  const slope = Math.log(tr.incidence[60] / tr.incidence[40]) / 20;
  close(slope, r, 0.002);
});

test('generation interval mean is latent + infectious', () => {
  close(meanOf(generationInterval(3, 6, 200)), 9.5, 0.1); // discretisation shifts mean by ~½ day
});

test('Gillespie and tau-leap reproduce the deterministic final size for large outbreaks', () => {
  const rng = makeRng(1);
  const z = finalSize(2.5);
  const o = { ...base, N: 4000, I0: 20 };
  for (const sim of [gillespieSEIRD, tauLeapSEIRD]) {
    const finals = [];
    for (let i = 0; i < 20; i++) finals.push(sim(o, rng).cumInc.at(-1) / o.N);
    const m = finals.reduce((a, b) => a + b, 0) / finals.length;
    close(m, z, 0.03, sim.name);
  }
});

test('probability of a minor outbreak ≈ (1/R0)^I0 (branching process)', () => {
  const rng = makeRng(99);
  const o = { ...base, N: 3000, I0: 1, R0: 2, days: 200 };
  const ens = runEnsemble(o, rng, 400, { majorThreshold: 100 });
  close(1 - ens.pMajor, extinctionProbability(2, 1), 0.07);
  assert.equal(ens.method, 'gillespie');
});

test('metapopulation NGM reduces to R0 for a single well-mixed patch', () => {
  const villages = [{ N: 1000, x: 0, y: 0 }];
  const C = gravityMixing(villages, 0.1);
  const K = metapopNGM(villages, null, { beta: 0.5, gamma: 0.2, betaMult: [1], C });
  close(spectralRadius(K), 2.5, 1e-9);
});

test('metapopulation: identical coupled patches have NGM radius R0; epidemic spreads between them', () => {
  const villages = [{ N: 2000, x: 0, y: 0 }, { N: 2000, x: 1, y: 0 }, { N: 2000, x: 0.5, y: 0.8 }];
  const C = gravityMixing(villages, 0.1);
  C.forEach(row => close(row.reduce((a, b) => a + b, 0), 1, 1e-12));
  const p = { beta: 0.5, gamma: 0.2, sigma: 1 / 3, cfr: 0.01, betaMult: [1, 1, 1], C };
  close(spectralRadius(metapopNGM(villages, null, p)), 2.5, 1e-6);
  const rng = makeRng(5);
  const st = metapopInit(villages, 0, 10);
  for (let d = 0; d < 150; d++) metapopStepDay(villages, st, p, rng);
  assert.ok(st.every(v => v.cumInc > 500), 'all villages infected');
  const total = st.reduce((s, v) => s + v.S + v.E + v.I + v.R + v.D + v.V, 0);
  assert.equal(total, 6000);
});
