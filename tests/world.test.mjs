import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, playWeek, totals, counterfactual, weeklyCost, WEEKS } from '../js/models/world.js';

test('a campaign runs to completion and conserves population', () => {
  const w = createWorld('normal', 123);
  const N = w.villages.reduce((s, v) => s + v.N, 0);
  while (!playWeek(w, { silent: true }));
  assert.ok(w.week <= WEEKS);
  const tot = w.state.reduce((s, v) => s + v.S + v.E + v.I + v.R + v.D + v.V, 0);
  assert.equal(tot, N);
  assert.ok(w.history.every(h => h.Rt >= 0));
});

test('same seed ⇒ identical campaign (reproducible)', () => {
  const a = createWorld('hard', 77), b = createWorld('hard', 77);
  while (!playWeek(a, { silent: true }));
  while (!playWeek(b, { silent: true }));
  assert.deepEqual(totals(a), totals(b));
});

test('early valley-wide lockdown + testing beats doing nothing', () => {
  let better = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = createWorld('normal', seed);
    w.credits = 1e6;
    w.policy.forEach(p => { p.lockdown = true; p.test = true; });
    assert.ok(weeklyCost(w) > 0);
    while (!playWeek(w, { silent: true }));
    const cf = counterfactual(w, 8);
    if (totals(w).deaths < cf.deaths.median) better++;
  }
  assert.ok(better >= 5, `better in ${better}/6`);
});

test('running out of credits lifts actions', () => {
  const w = createWorld('normal', 9);
  w.credits = 5;
  w.policy.forEach(p => { p.lockdown = true; });
  playWeek(w, { silent: true });
  assert.ok(w.credits >= 0);
  assert.ok(w.policy.filter(p => p.lockdown).length < w.policy.length);
});

test('budgets by difficulty, and a one-time warning below 30% of the budget', async () => {
  const { DIFFICULTY } = await import('../js/models/world.js');
  assert.equal(DIFFICULTY.easy.budget, 300);
  assert.equal(DIFFICULTY.normal.budget, 180);
  assert.equal(DIFFICULTY.hard.budget, 120);
  const w = createWorld('normal', 4);
  w.policy[0].lockdown = true; w.policy[0].test = true; // ~21.6 credits a week
  let warnings = 0;
  for (let k = 0; k < 12 && !w.over; k++) {
    playWeek(w, { silent: true });
    if (w.budgetWarning) { warnings++; w.budgetWarning = false; assert.ok(w.credits < 0.3 * w.budget); }
  }
  assert.equal(warnings, 1);
  assert.equal(w.log.filter(l => l.msg.startsWith('Budget warning')).length, 1);
});
