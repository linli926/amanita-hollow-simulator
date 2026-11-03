// Stochastic epidemic models.
//  • Gillespie's direct method (exact continuous-time Markov chain simulation)
//  • Binomial tau-leaping (chain-binomial approximation, much faster for large N)
//  • Metapopulation SEIRD on a mobility network (used by Outbreak Response)

import { quantile } from '../stats/dist.js';

function emptyTraj() {
  return { days: [], S: [], E: [], I: [], R: [], D: [], incidence: [], cumInc: [] };
}

/**
 * Exact stochastic SEIRD via Gillespie's direct method (1977).
 * Events: infection S→E (β S I / N), onset E→I (σ E), recovery I→R (γ(1−p) I), death I→D (γ p I).
 * Returns daily snapshots (counts).
 */
export function gillespieSEIRD(o, rng) {
  const { N, R0, latent, infectious, cfr, days } = o;
  const gamma = 1 / infectious;
  const sigma = latent > 0 ? 1 / latent : Infinity;
  const beta = R0 * gamma;
  let I = Math.round(o.I0), R = Math.round(N * (o.immune ?? 0));
  let S = Math.max(0, Math.round(N) - I - R), E = 0, D = 0, cum = 0;
  const out = emptyTraj();
  let t = 0, nextDay = 0, lastCum = 0;
  const record = () => {
    out.days.push(nextDay); out.S.push(S); out.E.push(E); out.I.push(I); out.R.push(R); out.D.push(D);
    out.incidence.push(cum - lastCum); out.cumInc.push(cum); lastCum = cum;
    nextDay++;
  };
  record();
  while (nextDay <= days) {
    const aInf = beta * S * I / N;
    const aOnset = isFinite(sigma) ? sigma * E : 0;
    const aRem = gamma * I;
    const a0 = aInf + aOnset + aRem;
    if (a0 <= 0) { while (nextDay <= days) record(); break; }
    t += rng.exponential(a0);
    while (nextDay <= days && t >= nextDay) record();
    if (nextDay > days) break;
    const u = rng.uniform() * a0;
    if (u < aInf) {
      S--; cum++;
      if (isFinite(sigma)) E++; else I++;
    } else if (u < aInf + aOnset) {
      E--; I++;
    } else {
      I--;
      if (rng.uniform() < cfr) D++; else R++;
    }
  }
  return out;
}

/** Chain-binomial tau-leap SEIRD with step dt (days). */
export function tauLeapSEIRD(o, rng, dt = 0.25) {
  const { N, R0, latent, infectious, cfr, days } = o;
  const gamma = 1 / infectious;
  const sigma = latent > 0 ? 1 / latent : 0;
  const beta = R0 * gamma;
  const betaMult = o.betaMult ?? (() => 1);
  let I = Math.round(o.I0), R = Math.round(N * (o.immune ?? 0));
  let S = Math.max(0, Math.round(N) - I - R), E = 0, D = 0, cum = 0;
  const out = emptyTraj();
  const push = (d, inc) => {
    out.days.push(d); out.S.push(S); out.E.push(E); out.I.push(I); out.R.push(R); out.D.push(D);
    out.incidence.push(inc); out.cumInc.push(cum);
  };
  push(0, 0);
  const steps = Math.round(1 / dt);
  let t = 0;
  for (let d = 1; d <= days; d++) {
    const before = cum;
    for (let s = 0; s < steps; s++) {
      const pInf = 1 - Math.exp(-beta * betaMult(t) * I / N * dt);
      const newInf = rng.binomial(S, pInf);
      const newOnset = sigma > 0 ? rng.binomial(E, 1 - Math.exp(-sigma * dt)) : 0;
      const leaving = rng.binomial(I, 1 - Math.exp(-gamma * dt));
      const deaths = rng.binomial(leaving, cfr);
      S -= newInf; cum += newInf;
      if (sigma > 0) { E += newInf - newOnset; I += newOnset - leaving; }
      else { I += newInf - leaving; }
      R += leaving - deaths; D += deaths;
      t += dt;
    }
    push(d, cum - before);
  }
  return out;
}

/**
 * Run an ensemble of stochastic realisations and summarise them.
 * Uses the exact Gillespie algorithm when N is small enough, tau-leaping otherwise.
 */
export function runEnsemble(o, rng, nRuns = 40, opts = {}) {
  const exactLimit = opts.exactLimit ?? 8000;
  const method = o.N <= exactLimit ? 'gillespie' : 'tau-leap';
  const runs = [];
  for (let r = 0; r < nRuns; r++) {
    runs.push(method === 'gillespie' ? gillespieSEIRD(o, rng) : tauLeapSEIRD(o, rng));
  }
  // A "major outbreak" = more than 10% of the deterministic expectation or > 50 infections.
  const threshold = opts.majorThreshold ?? Math.max(50, 0.02 * o.N);
  const final = runs.map(r => r.cumInc[r.cumInc.length - 1]);
  const major = final.filter(x => x >= threshold).length;
  const nDays = runs[0].days.length;
  const band = (key) => {
    const lo = [], mid = [], hi = [];
    for (let d = 0; d < nDays; d++) {
      const vals = runs.map(r => r[key][d]).sort((a, b) => a - b);
      lo.push(quantile(vals, 0.05)); mid.push(quantile(vals, 0.5)); hi.push(quantile(vals, 0.95));
    }
    return { lo, mid, hi };
  };
  return {
    method, runs, threshold,
    pMajor: major / nRuns,
    finalSizes: final,
    bandI: band('I'),
    bandD: band('D'),
    days: runs[0].days,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metapopulation model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gravity-model mobility (Zipf 1946; Xia et al. 2004): flow_kj ∝ N_k N_j / d_kj².
 * Returns a row-stochastic contact matrix C where C[k][j] is the fraction of
 * village k's contacts made with residents of village j.
 */
export function gravityMixing(villages, mobility, restrict = []) {
  const K = villages.length;
  const C = [];
  for (let k = 0; k < K; k++) {
    const w = villages.map((v, j) => {
      if (j === k) return 0;
      const dx = v.x - villages[k].x, dy = v.y - villages[k].y;
      const d2 = Math.max(dx * dx + dy * dy, 1e-4);
      let flow = villages[k].N * v.N / d2;
      if (restrict[k] || restrict[j]) flow *= 0.15;
      return flow;
    });
    const tot = w.reduce((a, b) => a + b, 0);
    const scale = villages[k].mobilityScale ?? 1;
    // Village-level outflow: travel bans shrink the share of contacts made outside.
    const m = mobility * scale * (restrict[k] ? 0.15 : 1);
    C.push(w.map((x, j) => (j === k ? 1 - m : (tot > 0 ? m * x / tot : 0))));
    if (tot === 0) C[k][k] = 1;
  }
  return C;
}

/** Fresh state for the metapopulation model. */
export function metapopInit(villages, seedVillage, seedCount) {
  return villages.map((v, k) => ({
    S: v.N - (k === seedVillage ? seedCount : 0),
    E: 0,
    I: k === seedVillage ? seedCount : 0,
    R: 0, D: 0, V: 0,
    cumInc: 0,
  }));
}

/**
 * Advance the metapopulation SEIRD by one day using binomial tau-leaping.
 * Force of infection in village k: λ_k = β·b_k · Σ_j C_kj I_j / N_j.
 * @param state     array of {S,E,I,R,D,V,cumInc}
 * @param p         {beta, sigma, gamma, cfr: number[] | number, betaMult:number[], C:number[][], vaccDoses:number[], vaccEff}
 */
export function metapopStepDay(villages, state, p, rng, dt = 0.25) {
  const K = villages.length;
  const steps = Math.round(1 / dt);
  const newInf = new Array(K).fill(0);
  const newDeaths = new Array(K).fill(0);
  for (let s = 0; s < steps; s++) {
    const prevalence = state.map((x, j) => x.I / villages[j].N);
    for (let k = 0; k < K; k++) {
      const st = state[k];
      let mix = 0;
      for (let j = 0; j < K; j++) mix += p.C[k][j] * prevalence[j];
      const lambda = p.beta * p.betaMult[k] * mix;
      const inf = rng.binomial(st.S, 1 - Math.exp(-lambda * dt));
      const onset = rng.binomial(st.E, 1 - Math.exp(-p.sigma * dt));
      const leave = rng.binomial(st.I, 1 - Math.exp(-p.gamma * dt));
      const cfrK = Array.isArray(p.cfr) ? p.cfr[k] : p.cfr;
      const die = rng.binomial(leave, cfrK);
      st.S -= inf; st.E += inf - onset; st.I += onset - leave; st.R += leave - die; st.D += die;
      st.cumInc += inf;
      newInf[k] += inf; newDeaths[k] += die;
      // Vaccination: doses spread evenly across the day, given to people who are
      // still susceptible-looking (S, E, R are indistinguishable without testing);
      // only doses landing on S with successful seroconversion move people to V.
      const doses = (p.vaccDoses?.[k] ?? 0) * dt;
      if (doses > 0 && st.S > 0) {
        const eligible = st.S + st.E + st.R;
        const toS = Math.min(st.S, Math.round(doses * st.S / Math.max(1, eligible)));
        const protectedN = rng.binomial(toS, p.vaccEff ?? 0.9);
        st.S -= protectedN; st.V += protectedN;
      }
    }
  }
  return { newInf, newDeaths };
}

/**
 * Next-generation matrix for the metapopulation (Diekmann, Heesterbeek & Metz 1990):
 *   K_kj = (β b_k / γ) · C_kj · S_k / N_j
 * Its spectral radius is the (effective) reproduction number of the whole network.
 */
export function metapopNGM(villages, state, p) {
  return villages.map((vk, k) => villages.map((vj, j) =>
    p.beta * p.betaMult[k] / p.gamma * p.C[k][j] * (state ? state[k].S : vk.N) / vj.N));
}
