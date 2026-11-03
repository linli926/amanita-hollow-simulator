// Deterministic compartmental models integrated with classical 4th-order Runge–Kutta.

/** One RK4 step for dy/dt = f(t, y). */
export function rk4Step(f, t, y, dt) {
  const n = y.length;
  const k1 = f(t, y);
  const y2 = new Array(n), y3 = new Array(n), y4 = new Array(n);
  for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * dt * k1[i];
  const k2 = f(t + 0.5 * dt, y2);
  for (let i = 0; i < n; i++) y3[i] = y[i] + 0.5 * dt * k2[i];
  const k3 = f(t + 0.5 * dt, y3);
  for (let i = 0; i < n; i++) y4[i] = y[i] + dt * k3[i];
  const k4 = f(t + dt, y4);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

/**
 * SEIRD(V) model.
 *   dS/dt = −β(t) S I / N − ν(t, S)
 *   dE/dt =  β(t) S I / N − σ E
 *   dI/dt =  σ E − γ I
 *   dR/dt =  γ (1 − p) I
 *   dD/dt =  γ p I
 *   dV/dt =  ν(t, S)
 * β = R₀·γ, σ = 1/latent, γ = 1/infectious, p = case fatality ratio.
 * latent = 0 collapses the model to SIRD (infection goes straight to I).
 *
 * @param {object} o
 * @param {number} o.N            population
 * @param {number} o.I0           initially infectious individuals
 * @param {number} o.R0           basic reproduction number
 * @param {number} o.latent       mean latent period (days), 0 for SIRD
 * @param {number} o.infectious   mean infectious period (days)
 * @param {number} o.cfr          case fatality ratio in [0, 1]
 * @param {number} [o.immune]     fraction initially immune (enters R)
 * @param {number} o.days         horizon (days)
 * @param {number} [o.dt]         RK4 step (days)
 * @param {(t:number)=>number} [o.betaMult]  time-varying multiplier on β (interventions)
 * @param {(t:number)=>number} [o.vaccRate]  per-capita vaccination rate of S (per day)
 * @returns daily series {days,S,E,I,R,D,V,incidence,cumInc} (counts, not fractions)
 */
export function simulateSEIRD(o) {
  const { N, R0, latent, infectious, cfr, days } = o;
  const dt = o.dt ?? 0.1;
  const gamma = 1 / infectious;
  const sigma = latent > 0 ? 1 / latent : 0;
  const beta0 = R0 * gamma;
  const p = cfr;
  const betaMult = o.betaMult ?? (() => 1);
  const vaccRate = o.vaccRate ?? (() => 0);
  const immune = o.immune ?? 0;
  const I0 = Math.min(o.I0, N * (1 - immune));

  // state: S, E, I, R, D, V, C (cumulative infections)
  const f = (t, y) => {
    const [S, E, I] = y;
    const foi = beta0 * betaMult(t) * I / N;
    const inf = foi * Math.max(S, 0);
    const vac = vaccRate(t) * Math.max(S, 0);
    if (sigma > 0) {
      return [-inf - vac, inf - sigma * E, sigma * E - gamma * I, gamma * (1 - p) * I, gamma * p * I, vac, inf];
    }
    return [-inf - vac, 0, inf - gamma * I, gamma * (1 - p) * I, gamma * p * I, vac, inf];
  };

  let y = [N * (1 - immune) - I0, 0, I0, N * immune, 0, 0, 0];
  const out = { days: [0], S: [y[0]], E: [0], I: [I0], R: [y[3]], D: [0], V: [0], incidence: [0], cumInc: [0] };
  const perDay = Math.max(1, Math.round(1 / dt));
  const h = 1 / perDay;
  let t = 0;
  for (let d = 1; d <= days; d++) {
    for (let s = 0; s < perDay; s++) { y = rk4Step(f, t, y, h); t += h; }
    out.days.push(d);
    out.S.push(y[0]); out.E.push(y[1]); out.I.push(y[2]); out.R.push(y[3]);
    out.D.push(y[4]); out.V.push(y[5]);
    out.incidence.push(Math.max(0, y[6] - out.cumInc[d - 1]));
    out.cumInc.push(y[6]);
  }
  return out;
}

/** Summary statistics of a daily trajectory. */
export function summarise(traj) {
  let peak = -1, peakDay = 0;
  traj.I.forEach((v, i) => { if (v > peak) { peak = v; peakDay = traj.days[i]; } });
  const last = traj.days.length - 1;
  return {
    peakI: peak,
    peakDay,
    totalInfected: traj.cumInc[last],
    deaths: traj.D[last],
    endDay: traj.days[last],
  };
}
