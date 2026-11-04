// Outbreak Response game engine: a stochastic metapopulation SEIRD across the
// villages of Amanita Hollow, driven week by week by the player's policy.
// Pure logic (no DOM) so it can be unit-tested and replayed for counterfactuals.

import { makeRng } from '../stats/rng.js';
import { spectralRadius } from '../stats/optim.js';
import { gravityMixing, metapopInit, metapopStepDay, metapopNGM } from './stochastic.js';

export const VILLAGES = [
  { name: 'Sporeford', N: 12000, x: 0.50, y: 0.50, desc: 'Market town, clinic and the valley\'s only hospital' },
  { name: 'Mossbank', N: 5200, x: 0.21, y: 0.33, desc: 'Farming village on the western slope' },
  { name: "Gill's Crossing", N: 3600, x: 0.78, y: 0.27, desc: 'River ford and trading post' },
  { name: 'Ringmere', N: 4400, x: 0.30, y: 0.77, desc: 'Lake village, fishing and peat cutting' },
  { name: 'Capstone', N: 2600, x: 0.83, y: 0.72, desc: 'Quarry town in the eastern hills' },
  { name: 'Veil Hollow', N: 1800, x: 0.09, y: 0.62, desc: 'Remote hamlet near the cavern mouth' },
];

export const DIFFICULTY = {
  easy: { R0: [1.8, 2.3], cfr: [0.012, 0.02], budget: 180, seeds: 2 },
  normal: { R0: [2.2, 2.9], cfr: [0.02, 0.03], budget: 135, seeds: 3 },
  hard: { R0: [2.8, 3.6], cfr: [0.03, 0.045], budget: 100, seeds: 4 },
};

export const WEEKS = 20;
export const MOBILITY = 0.08;
export const COMPASSIONATE_WEEK = 10;
const OVERLOAD = 0.03; // prevalence above which a village's wards overflow

export const ACTIONS = {
  lockdown: { label: 'Lockdown', hint: 'transmission −60%', cost: v => Math.round(v.N / 1000 * 1.2 * 10) / 10 },
  travel: { label: 'Travel ban', hint: 'outside contact −85%', cost: () => 2 },
  test: { label: 'Test & isolate', hint: 'transmission −25%, reporting 80%', cost: v => Math.round(v.N / 1000 * 0.6 * 10) / 10 },
  vaccine: { label: 'Vaccinate', hint: '2% of residents per day', cost: () => 6 }, // only once licensed (Vaccine Lab)
};
export const TREATMENT_COST = 8;

const EVENT_TYPES = ['festival', 'flood', 'traveller', 'nurses', 'distrust', 'grant'];

export function createWorld(difficulty = 'normal', seed = 1, opts = {}) {
  const setup = makeRng(seed);
  const D = DIFFICULTY[difficulty];
  const hidden = {
    R0: Math.round(setup.range(...D.R0) * 100) / 100,
    latent: setup.pick([2, 3, 3, 4]),
    infectious: setup.pick([4, 5, 6, 7]),
    cfr: Math.round(setup.range(...D.cfr) * 1000) / 1000,
  };
  // The pathogen designed in Outbreak Architect, if any, replaces the random one.
  // (The draws above still happen so seeding and events stay identical.)
  if (opts.pathogen) {
    const p = opts.pathogen;
    Object.assign(hidden, { R0: p.R0, latent: Math.max(1, p.latent), infectious: p.infectious, cfr: p.cfr });
  }
  const seedVillage = setup.int(1, VILLAGES.length - 1); // never starts in the town itself
  const types = setup.shuffle(EVENT_TYPES.slice()).slice(0, 4);
  const weeks = setup.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).slice(0, 4).sort((a, b) => a - b);
  const events = types.map((type, i) => ({ type, week: weeks[i], village: setup.int(0, VILLAGES.length - 1) }));
  const villages = VILLAGES.map(v => ({ ...v }));
  const world = {
    seed, difficulty, hidden, seedVillage, events, villages,
    treatmentHR: opts.treatmentHR ?? null,
    pathogen: opts.pathogen ?? null,
    // No vaccine reaches the villages until a Phase III trial has licensed it.
    vaccineWeek: opts.vaccine?.week ?? Infinity,
    vaccineEff: opts.vaccine?.ve ?? 0,
    rng: makeRng(seed ^ 0x2545f491),
    state: metapopInit(villages, seedVillage, D.seeds),
    day: 0, week: 0,
    credits: D.budget, budget: D.budget, spent: 0,
    policy: villages.map(() => ({ lockdown: false, travel: false, test: false, vaccine: false })),
    treatment: false,
    effects: [],       // active event effects {type, village, until}
    history: [],       // per-day records
    log: [],
    over: false,
  };
  refreshMixing(world);
  return world;
}

/** Recompute the contact matrix from current travel bans (used for drawing roads). */
export function refreshMixing(world) {
  world._C = gravityMixing(world.villages, MOBILITY, world.policy.map(p => p.travel));
  return world._C;
}

export function weeklyCost(world) {
  let c = 0;
  world.policy.forEach((p, k) => {
    for (const a of Object.keys(ACTIONS)) if (p[a]) c += ACTIONS[a].cost(world.villages[k]);
  });
  if (world.treatment) c += TREATMENT_COST;
  return Math.round(c * 10) / 10;
}

export function actionAvailable(world, action) {
  if (action === 'treatment') return world.treatmentHR !== null || world.week >= COMPASSIONATE_WEEK;
  if (action === 'vaccine') return world.week + 1 >= world.vaccineWeek;
  const u = ACTIONS[action].unlock;
  return !u || world.week >= u;
}

function say(world, cls, msg, week = world.week + 1) { world.log.push({ week, cls, msg }); }


/** Start-of-week: fire events, charge for the week's policy. */
function beginWeek(world, silent) {
  const w = world.week + 1; // the week about to be played (1-based)
  for (const ev of world.events) {
    const v = world.villages[ev.village];
    if (ev.type === 'festival' && ev.week - 1 === w && !silent) {
      say(world, 'ev', `Notice posted: ${v.name} will hold the Chanterelle Festival next week. Crowds expected.`);
    }
    if (ev.week !== w) continue;
    if (ev.type === 'festival') {
      if (world.policy[ev.village].lockdown) say(world, 'ok', `The ${v.name} festival is cancelled under lockdown.`);
      else { world.effects.push({ type: 'festival', village: ev.village, until: w }); say(world, 'alert', `Festival week in ${v.name}: transmission there is up 80%.`); }
    } else if (ev.type === 'flood') {
      world.effects.push({ type: 'flood', village: ev.village, until: w + 1 });
      say(world, 'ev', `Flash floods wash out the roads to ${v.name} for two weeks.`);
    } else if (ev.type === 'traveller') {
      const st = world.state[ev.village];
      const n = Math.min(st.S, 4);
      st.S -= n; st.E += n; st.cumInc += n;
      say(world, 'alert', `A travelling spore-trader has passed through ${v.name}.`);
    } else if (ev.type === 'nurses') {
      world.effects.push({ type: 'nurses', village: -1, until: w + 2 });
      say(world, 'ok', 'Volunteer nurses arrive from the capital. Case fatality falls 25% for three weeks.');
    } else if (ev.type === 'distrust') {
      world.effects.push({ type: 'distrust', village: -1, until: w + 1 });
      say(world, 'ev', 'Rumours spread that the clinic is poisoning people. Fewer cases are reported, and testing helps less, for two weeks.');
    } else if (ev.type === 'grant') {
      world.credits += 25;
      say(world, 'ok', 'An emergency grant from the capital adds 25 credits.');
    }
  }
  // Charge for the week, dropping actions (most expensive first) if funds run short.
  let cost = weeklyCost(world);
  while (cost > world.credits + 1e-9) {
    let best = null;
    world.policy.forEach((p, k) => Object.keys(ACTIONS).forEach(a => {
      if (p[a]) { const c = ACTIONS[a].cost(world.villages[k]); if (!best || c > best.c) best = { k, a, c }; }
    }));
    if (world.treatment && (!best || TREATMENT_COST > best.c)) { world.treatment = false; say(world, 'alert', 'Out of credits: treatment programme suspended.'); }
    else if (best) { world.policy[best.k][best.a] = false; say(world, 'alert', `Out of credits: ${ACTIONS[best.a].label.toLowerCase()} in ${world.villages[best.k].name} lifted.`); }
    else break;
    cost = weeklyCost(world);
  }
  world.credits = Math.round((world.credits - cost) * 10) / 10;
  world.spent = Math.round((world.spent + cost) * 10) / 10;
}

/** Transmission & reporting parameters for today given policy and events. */
function dayParams(world) {
  const { hidden, villages, policy } = world;
  const w = world.week + 1;
  const distrust = world.effects.some(e => e.type === 'distrust' && e.until >= w);
  const nurses = world.effects.some(e => e.type === 'nurses' && e.until >= w);
  const betaMult = villages.map((v, k) => {
    let m = 1;
    if (policy[k].lockdown) m *= 0.4;
    if (policy[k].test) m *= distrust ? 0.9 : 0.75;
    if (world.effects.some(e => e.type === 'festival' && e.village === k && e.until >= w)) m *= 1.8;
    return m;
  });
  villages.forEach((v, k) => { v.mobilityScale = world.effects.some(e => e.type === 'flood' && e.village === k && e.until >= w) ? 0.2 : 1; });
  const C = gravityMixing(villages, MOBILITY, policy.map(p => p.travel));
  const overloaded = world.state.map((s, k) => s.I / villages[k].N > OVERLOAD);
  const cfr = villages.map((v, k) => {
    let p = hidden.cfr;
    if (world.treatment) p *= world.treatmentHR ?? 0.85;
    if (nurses) p *= 0.75;
    if (overloaded[k]) p *= 1.6;
    return Math.min(0.9, p);
  });
  const rho = villages.map((v, k) => (policy[k].test ? 0.8 : 0.35) * (distrust ? 0.6 : 1));
  const vaccDoses = villages.map((v, k) => (policy[k].vaccine ? 0.02 * v.N : 0));
  return {
    beta: hidden.R0 / hidden.infectious, sigma: 1 / hidden.latent, gamma: 1 / hidden.infectious,
    betaMult, C, cfr, rho, vaccDoses, vaccEff: world.vaccineEff, overloaded,
  };
}

function stepDay(world) {
  const p = dayParams(world);
  const { newInf, newDeaths } = metapopStepDay(world.villages, world.state, p, world.rng);
  const reported = newInf.map((n, k) => world.rng.binomial(n, p.rho[k]));
  const Rt = spectralRadius(metapopNGM(world.villages, world.state, p));
  world._C = p.C;
  world.day++;
  world.history.push({
    day: world.day, week: world.week + 1, newInf, newDeaths, reported, Rt,
    I: world.state.map(s => s.I), overloaded: p.overloaded,
  });
}

/** Play one week (7 days). Returns true when the campaign is over. */
export function playWeek(world, opts = {}) {
  if (world.over) return true;
  beginWeek(world, opts.silent);
  for (let d = 0; d < 7; d++) { stepDay(world); opts.onDay?.(world); }
  world.week++;
  world.effects = world.effects.filter(e => e.until > world.week - 1);
  const active = world.state.reduce((s, v) => s + v.E + v.I, 0);
  if (world.week >= WEEKS || (world.week >= 3 && active === 0)) {
    world.over = true;
    if (!opts.silent) say(world, active === 0 ? 'ok' : 'ev', active === 0 ? 'No infectious cases remain. The outbreak is over.' : `Week ${WEEKS}: the campaign ends.`, world.week);
  }
  return world.over;
}

export function totals(world) {
  const sum = key => world.history.reduce((s, h) => s + h[key].reduce((a, b) => a + b, 0), 0);
  return {
    infections: world.state.reduce((s, v) => s + v.cumInc, 0),
    deaths: world.state.reduce((s, v) => s + v.D, 0),
    reported: sum('reported'),
    vaccinated: world.state.reduce((s, v) => s + v.V, 0),
  };
}

/**
 * Replay the same valley (same hidden parameters, seeding and events) with no
 * interventions, nRep times, to estimate what doing nothing would have cost.
 */
export function counterfactual(world, nRep = 30) {
  const deaths = [], infections = [];
  for (let r = 0; r < nRep; r++) {
    const w = createWorld(world.difficulty, world.seed, { treatmentHR: null, pathogen: world.pathogen });
    w.rng = makeRng((world.seed ^ 0x2545f491) + 7919 * (r + 1));
    while (!playWeek(w, { silent: true }));
    const t = totals(w);
    deaths.push(t.deaths); infections.push(t.infections);
  }
  deaths.sort((a, b) => a - b); infections.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return {
    deaths: { median: q(deaths, 0.5), lo: q(deaths, 0.05), hi: q(deaths, 0.95) },
    infections: { median: q(infections, 0.5), lo: q(infections, 0.05), hi: q(infections, 0.95) },
  };
}

export function grade(deaths, cfDeaths) {
  const ratio = cfDeaths > 0 ? deaths / cfDeaths : 0;
  if (ratio < 0.15) return { letter: 'S', ratio, note: 'Legendary. The Hollow will name a mushroom after you.' };
  if (ratio < 0.3) return { letter: 'A', ratio, note: 'Outstanding containment.' };
  if (ratio < 0.5) return { letter: 'B', ratio, note: 'Solid response: you halved the toll.' };
  if (ratio < 0.75) return { letter: 'C', ratio, note: 'You saved lives, but the spores often got there first.' };
  return { letter: 'D', ratio, note: 'Little better than doing nothing. Act earlier and target the hubs.' };
}
