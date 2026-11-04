// Survival analysis toolkit.
//  • Kaplan–Meier estimator with Greenwood variance and log–log confidence bands
//  • Median survival with Brookmeyer–Crowley-type CI
//  • Nelson–Aalen cumulative hazard
//  • Log-rank (Mantel–Haenszel) test
//  • Cox proportional hazards regression (Newton–Raphson, Breslow ties)
//  • Harrell's concordance index
//  • Schoenfeld (1983) sample size / power formula
//  • Trial simulator: Weibull PH survival, block randomisation, staggered accrual, dropout

import { normCdf, normInv, chi2Sf } from './dist.js';
import { invert } from './optim.js';

const Z975 = 1.959963984540054;

/** Group subjects by distinct times (ascending): returns [{t, d, c, nRisk}]. */
function riskTable(times, events) {
  const idx = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const rows = [];
  let nRisk = times.length, i = 0;
  while (i < idx.length) {
    const t = times[idx[i]];
    let d = 0, c = 0;
    while (i < idx.length && times[idx[i]] === t) { if (events[idx[i]]) d++; else c++; i++; }
    rows.push({ t, d, c, nRisk });
    nRisk -= d + c;
  }
  return rows;
}

/** Kaplan–Meier product-limit estimator. Returns step points {t, s, lo, hi, nRisk, d, c}. */
export function kaplanMeier(times, events) {
  const rows = riskTable(times, events);
  let s = 1, gw = 0;
  const curve = [{ t: 0, s: 1, lo: 1, hi: 1, nRisk: times.length, d: 0, c: 0, se: 0 }];
  const censorMarks = [];
  for (const r of rows) {
    if (r.d > 0) {
      s *= 1 - r.d / r.nRisk;
      if (r.nRisk > r.d) gw += r.d / (r.nRisk * (r.nRisk - r.d));
      let lo = s, hi = s;
      if (s > 0 && s < 1) {
        // log(−log S) transformed interval keeps the band inside [0, 1]
        const v = gw / Math.pow(Math.log(s), 2);
        const e = Math.exp(Z975 * Math.sqrt(v));
        lo = Math.pow(s, e); hi = Math.pow(s, 1 / e);
      }
      curve.push({ t: r.t, s, lo, hi, nRisk: r.nRisk, d: r.d, c: r.c, se: s * Math.sqrt(gw) });
    }
    if (r.c > 0) censorMarks.push({ t: r.t, s });
  }
  const tMax = rows.length ? rows[rows.length - 1].t : 0;
  return { curve, censorMarks, tMax, n: times.length, events: events.reduce((a, b) => a + b, 0) };
}

/** S(t) read off a KM curve (right-continuous step function). */
export function kmAt(km, t) {
  let s = 1;
  for (const p of km.curve) { if (p.t <= t) s = p.s; else break; }
  return s;
}

/** Number at risk just before time t. */
export function atRisk(times, t) { return times.filter(x => x >= t).length; }

/** Median survival and its 95% CI from the KM log–log band. null = not reached. */
export function kmMedian(km) {
  const first = key => { const p = km.curve.find(q => q[key] <= 0.5); return p ? p.t : null; };
  return { median: first('s'), lo: first('lo'), hi: first('hi') };
}

/** Nelson–Aalen estimator of the cumulative hazard H(t) = Σ d_i / n_i. */
export function nelsonAalen(times, events) {
  let H = 0;
  const out = [{ t: 0, H: 0 }];
  for (const r of riskTable(times, events)) {
    if (r.d > 0) { H += r.d / r.nRisk; out.push({ t: r.t, H }); }
  }
  return out;
}

/** Two-sample log-rank test. groups[i] ∈ {0, 1}. */
export function logRank(times, events, groups) {
  const idx = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  let n0 = groups.filter(g => g === 0).length, n1 = groups.length - n0;
  let O1 = 0, E1 = 0, V = 0, O0 = 0, E0 = 0;
  let i = 0;
  while (i < idx.length) {
    const t = times[idx[i]];
    let d0 = 0, d1 = 0, r0 = 0, r1 = 0;
    while (i < idx.length && times[idx[i]] === t) {
      const k = idx[i];
      if (groups[k] === 1) { r1++; if (events[k]) d1++; } else { r0++; if (events[k]) d0++; }
      i++;
    }
    const n = n0 + n1, d = d0 + d1;
    if (d > 0 && n > 0) {
      const e1 = d * n1 / n;
      E1 += e1; E0 += d - e1; O1 += d1; O0 += d0;
      if (n > 1) V += d * (n1 / n) * (n0 / n) * (n - d) / (n - 1);
    }
    n0 -= r0; n1 -= r1;
  }
  const chi2 = V > 0 ? (O1 - E1) ** 2 / V : 0;
  return { chi2, p: chi2Sf(chi2, 1), O1, E1, O0, E0, V, hrLogRank: (O1 / E1) / (O0 / E0) };
}

/**
 * Cox proportional hazards model fitted by Newton–Raphson on the Breslow partial likelihood.
 * X is an n × p design matrix (rows = subjects). Covariates are centred internally.
 */
export function coxPH(times, events, X, names) {
  const n = times.length, p = X[0].length;
  const means = Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const Xc = X.map(r => r.map((v, j) => v - means[j]));
  const order = times.map((_, i) => i).sort((a, b) => times[b] - times[a]); // descending

  function evaluate(beta) {
    let ll = 0;
    const U = new Array(p).fill(0);
    const I = Array.from({ length: p }, () => new Array(p).fill(0));
    let S0 = 0;
    const S1 = new Array(p).fill(0);
    const S2 = Array.from({ length: p }, () => new Array(p).fill(0));
    let i = 0;
    while (i < n) {
      const t = times[order[i]];
      const tied = [];
      // add everyone with this time to the risk set first (Breslow)
      while (i < n && times[order[i]] === t) {
        const k = order[i];
        const x = Xc[k];
        let eta = 0; for (let j = 0; j < p; j++) eta += x[j] * beta[j];
        const w = Math.exp(eta);
        S0 += w;
        for (let a = 0; a < p; a++) { S1[a] += w * x[a]; for (let b = 0; b < p; b++) S2[a][b] += w * x[a] * x[b]; }
        if (events[k]) tied.push({ k, eta });
        i++;
      }
      for (const { k, eta } of tied) {
        ll += eta - Math.log(S0);
        for (let a = 0; a < p; a++) {
          U[a] += Xc[k][a] - S1[a] / S0;
          for (let b = 0; b < p; b++) I[a][b] += S2[a][b] / S0 - (S1[a] * S1[b]) / (S0 * S0);
        }
      }
    }
    return { ll, U, I };
  }

  let beta = new Array(p).fill(0);
  let cur = evaluate(beta);
  const ll0 = cur.ll;
  let iter = 0, converged = false;
  for (; iter < 50; iter++) {
    const Iinv = invert(cur.I);
    if (!Iinv) break;
    const step = Iinv.map(row => row.reduce((s, v, j) => s + v * cur.U[j], 0));
    let scale = 1, next, nb;
    for (let h = 0; h < 20; h++) {
      nb = beta.map((b, j) => b + scale * step[j]);
      next = evaluate(nb);
      if (next.ll >= cur.ll - 1e-12) break;
      scale /= 2; // step halving
    }
    const delta = Math.abs(next.ll - cur.ll);
    beta = nb; cur = next;
    if (delta < 1e-10) { converged = true; break; }
  }
  const cov = invert(cur.I) ?? cur.I.map(r => r.map(() => NaN));
  const coefs = beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    const z = b / se;
    return {
      name: names?.[j] ?? `x${j + 1}`,
      beta: b, se, z,
      p: 2 * (1 - normCdf(Math.abs(z))),
      hr: Math.exp(b), lo: Math.exp(b - Z975 * se), hi: Math.exp(b + Z975 * se),
    };
  });
  const lrStat = 2 * (cur.ll - ll0);
  return {
    coefs, ll: cur.ll, ll0, iterations: iter + 1, converged,
    lrStat, lrP: chi2Sf(lrStat, p),
    linearPredictor: Xc.map(r => r.reduce((s, v, j) => s + v * beta[j], 0)),
  };
}

/**
 * Harrell's concordance index: among usable pairs (the shorter time is an event),
 * the fraction where the subject with the shorter time has the higher risk score.
 */
export function concordance(times, events, risk) {
  let conc = 0, usable = 0;
  const n = times.length;
  for (let i = 0; i < n; i++) {
    if (!events[i]) continue;
    for (let j = 0; j < n; j++) {
      if (times[j] > times[i]) {
        usable++;
        if (risk[i] > risk[j]) conc++;
        else if (risk[i] === risk[j]) conc += 0.5;
      }
    }
  }
  return usable ? conc / usable : NaN;
}

/** Schoenfeld (1983): events needed for a two-sided level-α log-rank test with given power. */
export function schoenfeldEvents(hr, alpha = 0.05, power = 0.8, alloc = 0.5) {
  const z = normInv(1 - alpha / 2) + normInv(power);
  return (z * z) / (alloc * (1 - alloc) * Math.log(hr) ** 2);
}

/** Power of the log-rank test given an expected number of events D. */
export function schoenfeldPower(hr, events, alpha = 0.05, alloc = 0.5) {
  if (hr === 1 || events <= 0) return alpha;
  const z = Math.sqrt(events * alloc * (1 - alloc)) * Math.abs(Math.log(hr)) - normInv(1 - alpha / 2);
  return normCdf(z);
}

/** Patient mix in the trial: age ~ N(55, 16²) truncated to 18–90, 35% with a comorbidity. */
const AGE_MEAN = 55, AGE_SD = 16, P_COMORB = 0.35;

/**
 * Baseline cumulative hazard at day 60, H₀(60), such that the AVERAGE placebo-arm 60-day
 * mortality over the patient mix equals m60:  E[1 − exp(−H₀(60)·e^{lp})] = m60.
 * The expectation is a deterministic quadrature over age quantiles × comorbidity, solved by bisection.
 */
export function baselineHazardFor(m60, bAge, bCom) {
  const lps = [];
  for (let i = 0; i < 40; i++) {
    const age = Math.min(90, Math.max(18, AGE_MEAN + AGE_SD * normInv((i + 0.5) / 40)));
    for (const [c, w] of [[0, 1 - P_COMORB], [1, P_COMORB]]) lps.push({ e: Math.exp(bAge * (age - 55) / 10 + bCom * c), w: w / 40 });
  }
  const mort = H => lps.reduce((s, p) => s + p.w * (1 - Math.exp(-H * p.e)), 0);
  let lo = 0, hi = 50;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (mort(mid) < m60) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * Simulate a randomised two-arm trial with Weibull proportional hazards.
 *   H(t | x) = (t / scale)^shape · exp(β_trt·trt + β_age·(age−55)/10 + β_com·comorb)
 * The baseline scale is calibrated so that the average control-arm patient mix has the
 * requested mortality by day 60 (see baselineHazardFor).
 */
export function simulateTrial(o, rng) {
  const shape = o.shape ?? 1.2;
  const m60 = Math.min(0.95, Math.max(0.01, o.controlMortality ?? 0.3));
  const bTrt = Math.log(o.hr);
  const bAge = Math.log(o.hrAgePer10 ?? 1.3);
  const bCom = Math.log(o.hrComorb ?? 1.8);
  const H60 = baselineHazardFor(m60, bAge, bCom);
  const scale = 60 / Math.pow(H60, 1 / shape);
  const accrual = o.accrualDays ?? 30;
  const followUp = o.followUpDays ?? 60;
  const dropRate = o.dropoutRate ?? 0;
  const n = o.n;

  // Permuted-block randomisation (blocks of 4) keeps the arms balanced throughout accrual.
  const arms = [];
  while (arms.length < n) arms.push(...rng.shuffle([0, 0, 1, 1]));
  arms.length = n;

  const patients = [];
  for (let i = 0; i < n; i++) {
    const age = Math.min(90, Math.max(18, Math.round(rng.normal(AGE_MEAN, AGE_SD))));
    const comorb = rng.bernoulli(P_COMORB);
    const trt = arms[i];
    const lp = bTrt * trt + bAge * (age - 55) / 10 + bCom * comorb;
    const T = scale * Math.pow(rng.exponential(1) / Math.exp(lp), 1 / shape);
    const enrol = rng.uniform() * accrual;
    const adminCensor = followUp + (accrual - enrol);
    const drop = dropRate > 0 ? rng.exponential(dropRate) : Infinity;
    const C = Math.min(adminCensor, drop);
    const time = Math.max(0.01, Math.round(Math.min(T, C) * 10) / 10);
    patients.push({ id: i + 1, trt, age, comorb, enrol, time, event: T <= C ? 1 : 0, dropped: drop < adminCensor && drop < T });
  }
  return { patients, scale, shape };
}

/** Fraction of patients expected to die during the trial (Monte Carlo, large sample). */
export function expectedEventFraction(o, rng, nSim = 6000) {
  const { patients } = simulateTrial({ ...o, n: nSim }, rng);
  return patients.reduce((s, p) => s + p.event, 0) / nSim;
}

/** Empirical power: run many trials, count log-rank rejections at level α. */
export function simulatePower(o, rng, nTrials = 200, alpha = 0.05) {
  let reject = 0, rejectRight = 0;
  for (let k = 0; k < nTrials; k++) {
    const { patients } = simulateTrial(o, rng);
    const lr = logRank(patients.map(p => p.time), patients.map(p => p.event), patients.map(p => p.trt));
    if (lr.p < alpha) { reject++; if (lr.O1 < lr.E1) rejectRight++; }
  }
  return { power: reject / nTrials, powerBeneficial: rejectRight / nTrials, nTrials };
}
