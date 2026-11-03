// Mode II — Field Epidemiologist: estimate R₀ from noisy, incomplete clinic data.

import { simulateSEIRD, summarise } from '../models/ode.js';
import { gillespieSEIRD, tauLeapSEIRD } from '../models/stochastic.js';
import { generationInterval } from '../models/theory.js';
import { fitMLE, profileR0, guessLogLik, expectedCases, poissonGrowthGLM, R0FromGLM, coriRt, misspecificationFactor } from '../stats/inference.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { Chart, COLORS, alpha, niceMax } from '../ui/chart.js';
import { $, slider, fmt, text, html, tabs, downloadCSV, defer } from '../ui/dom.js';
import { state } from '../state.js';

let chart, side, sideTab;
let get = {};
let C = null;           // current case file
let loadedSeed = null;
let toast, banner;
let raf = 0;

export function initField(ctx) {
  toast = ctx.toast;
  chart = new Chart($('#f-chart'));
  side = new Chart($('#f-side'));
  get.r0 = slider('f-r0', v => v.toFixed(2), onGuess);
  get.rho = slider('f-rho', v => Math.round(v * 100) + '%', onGuess);
  sideTab = tabs($('#f-tabs'), () => drawSide());
  $('#f-advance').addEventListener('click', advance);
  $('#f-mle').addEventListener('click', autoFit);
  $('#f-reveal').addEventListener('click', reveal);
  $('#f-new').addEventListener('click', () => { newCase(mysterySpec()); toast('A new outbreak has been reported somewhere in the Hollow.'); });
  $('#f-csv').addEventListener('click', () => {
    if (!C) return;
    const rows = [];
    for (let t = 1; t <= C.today; t++) rows.push([t, C.y[t]]);
    downloadCSV(`amanita-hollow-cases-${C.id}.csv`, ['day', 'reported_cases'], rows);
  });
}

export function enterField(b) {
  banner = b;
  if (state.outbreak && state.outbreak.seed !== loadedSeed && state.outbreak.R0 * (1 - state.outbreak.immune) > 1) {
    const o = state.outbreak;
    const rng = makeRng(o.seed ^ 0x51ed);
    newCase({ ...o, rho: Math.round(rng.range(0.2, 0.75) * 100) / 100, k: 8, seed: o.seed, source: 'architect' });
    loadedSeed = o.seed;
  } else if (!C) {
    newCase(mysterySpec());
  } else {
    setBanner();
    chart.redraw(); side.redraw();
  }
}

function setBanner() {
  if (!banner || !C) return;
  banner(C.spec.source === 'architect'
    ? `<em>FIELD REPORT · CASE FILE ${C.id}.</em> You designed this pathogen in mode I, but the field team only sees the clinic ledger. Underreporting, overdispersion and plain bad luck all blur the picture. <em>Estimate R₀, then forecast the peak before the valley runs out of beds.</em>`
    : `<em>FIELD REPORT · CASE FILE ${C.id}.</em> An unidentified illness is spreading in a valley village. Lab work has pinned down the latent and infectious periods. Nothing else is known. <em>Fit the model, estimate R₀ with a confidence interval, and forecast the peak.</em> Waiting for more data costs time, and early estimates are uncertain.`);
}

function mysterySpec() {
  const rng = makeRng(randomSeed());
  return {
    R0: Math.round(rng.range(1.4, 3.8) * 100) / 100,
    latent: rng.pick([1, 2, 2, 3, 3, 4, 5]),
    infectious: rng.pick([3, 4, 5, 6, 7, 8]),
    N: rng.pick([4000, 8000, 12000, 20000, 35000]),
    I0: rng.int(1, 4),
    immune: 0,
    cfr: 0.02,
    rho: Math.round(rng.range(0.15, 0.8) * 100) / 100,
    k: rng.pick([5, 8, 15, 30]),
    seed: randomSeed(),
    source: 'mystery',
  };
}

function newCase(spec) {
  const rng = makeRng(spec.seed);
  const probe = simulateSEIRD({ ...spec, days: 600, dt: 0.25 });
  const ps = summarise(probe);
  let horizon = 60;
  for (let d = ps.peakDay; d < probe.days.length; d++) { horizon = d; if (probe.I[d] + probe.E[d] < Math.max(1, 3e-4 * spec.N)) break; }
  horizon = Math.min(240, Math.max(60, Math.ceil(horizon * 1.1 / 10) * 10));

  // One stochastic realisation, conditioned on a major outbreak.
  let traj;
  for (let tries = 0; tries < 40; tries++) {
    const sim = spec.N <= 8000 ? gillespieSEIRD : tauLeapSEIRD;
    traj = sim({ ...spec, days: horizon }, rng);
    if (traj.cumInc.at(-1) >= Math.max(80, 0.04 * spec.N)) break;
  }
  const y = traj.incidence.map((inc, t) => (t === 0 ? 0 : rng.negBin(spec.rho * inc, spec.k)));
  let today = 14, cum = 0;
  for (let t = 1; t <= horizon; t++) { cum += y[t]; if (cum >= 50) { today = Math.max(14, t); break; } }
  today = Math.min(today, horizon - 7);

  C = {
    id: 'AH-' + (spec.seed % 9000 + 1000),
    spec, traj, y, horizon, today,
    known: { N: spec.N, latent: spec.latent, infectious: spec.infectious },
    mle: null, prof: null, envelope: null, revealed: false, fitting: false,
  };
  get.r0.set(1.5); get.rho.set(0.5);
  $('#f-solved').classList.remove('show');
  setBanner();
  text('f-case-id', C.id);
  html('f-report', `Clinic ledger recovered: <em>${fmt.int(spec.N)}</em> residents.<br>
    Lab: latent period <em>${spec.latent} d</em>, infectious period <em>${spec.infectious} d</em>.<br>
    Not known: <span style="color:var(--amber)">R₀, reporting rate ρ, initial seeding, over-dispersion</span>.`);
  refreshData();
}

async function refreshData() {
  C.yObs = C.y.slice(0, C.today + 1);
  C.mle = null; C.prof = null; C.envelope = null; C.adj = { c: 1, phi: 1, r1: 0 };
  C.glm = poissonGrowthGLM(C.yObs);
  C.w = generationInterval(C.known.latent, C.known.infectious, 60);
  C.rt = coriRt(C.yObs, C.w, 7);
  text('f-today', `Day ${C.today}`);
  $('#f-advance').disabled = C.today >= C.horizon || C.revealed;
  $('#f-mle').disabled = true;
  text('f-status', 'Analysing ledger…');
  draw();
  await defer(() => { C.mle = fitMLE(C.yObs, C.known); C.adj = misspecificationFactor(C.yObs, C.known, C.mle); });
  $('#f-mle').disabled = C.revealed;
  onGuess();
}

function onGuess() {
  if (!C) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!C.mle) { draw(); return; }
    const g = guessLogLik(C.yObs, C.known, get.r0(), get.rho(), C.mle.k);
    C.guess = { R0: get.r0(), rho: get.rho(), I0: g.I0, ll: g.ll, k: C.mle.k };
    C.guess.curve = expectedCases(C.guess, C.known, C.horizon);
    const delta = Math.max(0, C.mle.ll - g.ll);
    const score = Math.round(100 * Math.exp(-delta / (10 * C.adj.c)));
    C.guess.delta = delta; C.guess.score = score;
    const el = $('#f-score');
    el.textContent = score + '%';
    let color, status;
    if (score < 30) { color = 'var(--red-bright)'; status = '⚠ Poor fit'; }
    else if (score < 60) { color = 'var(--amber)'; status = '◎ Getting closer…'; }
    else if (score < 80) { color = '#8fc58f'; status = '◎ Almost: fine-tune it'; }
    else { color = 'var(--green-bright)'; status = '✓ Statistically consistent with the data'; }
    el.style.color = color;
    const st = $('#f-status'); st.style.color = color; st.textContent = status;
    const solved = score >= 80 && !C.revealed;
    $('#f-solved').classList.toggle('show', solved && !C.prof);
    if (solved) text('f-solved-text', `Your R₀ = ${get.r0().toFixed(2)} lies inside the 95% likelihood region. Try AUTO-FIT for the exact interval.`);
    draw();
  });
}

async function advance() {
  if (!C || C.today >= C.horizon) return;
  C.today = Math.min(C.horizon, C.today + 7);
  toast(`A week passes. The ledger now covers day ${C.today}.`);
  await refreshData();
}

async function autoFit() {
  if (!C || !C.mle) return;
  const btn = $('#f-mle');
  btn.disabled = true; btn.textContent = '∑ PROFILING LIKELIHOOD…';
  await defer(() => {
    C.prof = profileR0(C.yObs, C.known, C.mle, 21);
    const inside = C.prof.grid.filter(g => g.dev <= C.prof.crit);
    const curves = [C.mle, ...inside].map(p => expectedCases(p, C.known, C.horizon));
    C.mleCurve = curves[0];
    C.envelope = {
      lo: C.mleCurve.map((_, t) => Math.min(...curves.map(c => c[t]))),
      hi: C.mleCurve.map((_, t) => Math.max(...curves.map(c => c[t]))),
    };
  });
  btn.textContent = '∑ AUTO-FIT · MAXIMUM LIKELIHOOD';
  btn.disabled = false;
  $('#f-solved').classList.remove('show');
  sideTabSet('profile');
  draw();
}

function sideTabSet(name) {
  document.querySelectorAll('#f-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  drawSide(name);
}

async function reveal() {
  if (!C) return;
  if (!C.prof && C.mle) await autoFit();
  C.revealed = true;
  $('#f-advance').disabled = true;
  $('#f-mle').disabled = true;
  $('#f-solved').classList.remove('show');
  const s = C.spec;
  const covered = C.prof && C.prof.ciLo !== null && C.prof.ciHi !== null && s.R0 >= C.prof.ciLo && s.R0 <= C.prof.ciHi;
  toast(`True R₀ = ${s.R0.toFixed(2)}. Your guess: ${get.r0().toFixed(2)}. ${covered ? 'The 95% CI covered the truth.' : 'The CI missed. That happens about 5% of the time, or more when data are scarce.'}`);
  state.log.push({ mode: 'field', id: C.id, trueR0: s.R0, guess: get.r0(), mle: C.mle?.R0, day: C.today });
  draw();
}

function draw() {
  if (!C) return;
  const { y, horizon, today } = C;
  const shown = C.revealed ? y : C.yObs;
  const xs = shown.map((_, i) => i);
  let ymax = Math.max(...C.yObs, 5);
  if (C.revealed) ymax = Math.max(ymax, ...y);
  if (C.envelope) ymax = Math.max(ymax, ...C.envelope.hi.slice(0, horizon + 1));
  if (C.guess?.curve) ymax = Math.max(ymax, Math.min(Math.max(...C.guess.curve) , ymax * 3));
  ymax = niceMax(ymax * 1.08);

  chart.render(c => {
    c.axes({ xMin: 0, xMax: horizon, yMin: 0, yMax: ymax, yFmt: v => Math.round(v), xFmt: v => 'd' + Math.round(v), xLabel: 'day', yLabel: 'cases / day' });
    // Unknown future shading
    if (!C.revealed) {
      const { ctx } = c;
      ctx.fillStyle = 'rgba(185,160,115,0.035)';
      ctx.fillRect(c.X(today), c.pad.top, c.X(horizon) - c.X(today), c.ph);
    }
    if (C.revealed) {
      c.bars(xs.slice(today + 1), y.slice(today + 1), { color: COLORS.truth, alpha: 0.28 });
      c.line(C.traj.days, C.traj.incidence.map(v => v * C.spec.rho), { color: COLORS.truth, width: 1, alpha: 0.5, dash: [2, 3] });
    }
    c.bars(xs.slice(0, today + 1), C.yObs, { color: COLORS.obs, alpha: 0.85 });
    if (C.envelope) {
      const ex = C.mleCurve.map((_, i) => i);
      c.band(ex, C.envelope.lo, C.envelope.hi, { color: 'rgba(95,179,161,0.18)' });
      c.line(ex, C.mleCurve, { color: COLORS.fit, width: 2 });
    }
    if (C.guess?.curve) {
      const gx = C.guess.curve.map((_, i) => i);
      c.line(gx.slice(0, today + 1), C.guess.curve.slice(0, today + 1), { color: COLORS.guess, width: 2 });
      c.line(gx.slice(today), C.guess.curve.slice(today), { color: COLORS.guess, width: 1.5, dash: [5, 4], alpha: 0.7 });
    }
    c.vline(today, { color: 'rgba(232,220,196,0.55)', label: C.revealed ? `data cut-off d${today}` : `TODAY · d${today}`, dash: [2, 3] });
  }, x => {
    const d = Math.round(x);
    if (d < 0 || d > horizon) return null;
    const rows = [{ text: `Day ${d}${d > today ? ' (future)' : ''}` }];
    if (d <= today || C.revealed) rows.push({ text: `reported ${y[d]}`, color: COLORS.obs });
    if (C.guess?.curve) rows.push({ text: `your model ${C.guess.curve[d].toFixed(1)}`, color: COLORS.guess });
    if (C.mleCurve) rows.push({ text: `MLE ${C.mleCurve[d].toFixed(1)}  [${C.envelope.lo[d].toFixed(0)}–${C.envelope.hi[d].toFixed(0)}]`, color: COLORS.fit });
    return rows;
  });
  drawSide();
  renderEstimates();
}

function drawSide(tab = sideTab()) {
  if (!C) return;
  const cap = $('#f-side-caption');
  if (tab === 'profile') {
    if (!C.prof) {
      side.render(c => c.empty('Run AUTO-FIT to profile the likelihood'));
      cap.textContent = 'Deviance 2[ℓ(θ̂) − ℓp(R₀)] against R₀. The 95% CI is where the curve lies below 3.84.';
      return;
    }
    const g = C.prof.grid;
    const ymax = Math.max(C.prof.crit * 2.5, Math.min(C.prof.crit * 8, Math.max(...g.map(p => p.dev))));
    side.render(c => {
      c.axes({ xMin: g[0].R0, xMax: g.at(-1).R0, yMin: 0, yMax: ymax, xFmt: v => v.toFixed(2), yFmt: v => v.toFixed(0), xTicks: 5, yTicks: 4, xLabel: 'R₀', yLabel: 'deviance' });
      if (C.prof.ciLo !== null && C.prof.ciHi !== null) {
        const { ctx } = c;
        ctx.fillStyle = 'rgba(95,179,161,0.1)';
        ctx.fillRect(c.X(C.prof.ciLo), c.pad.top, c.X(C.prof.ciHi) - c.X(C.prof.ciLo), c.ph);
      }
      c.hline(C.prof.crit, { color: alpha(COLORS.obs, 0.6), label: C.prof.adj.c > 1.01 ? `ĉ·3.84 = ${C.prof.crit.toFixed(1)}` : 'χ²₁ 95% = 3.84' });
      c.line(g.map(p => p.R0), g.map(p => p.dev), { color: COLORS.fit, width: 2 });
      c.marks(g.map(p => p.R0), g.map(p => p.dev), { shape: 'dot', color: COLORS.fit, size: 2 });
      c.vline(get.r0(), { color: COLORS.guess, dash: [3, 3], label: 'you', labelY: 22 });
      c.vline(C.mle.R0, { color: COLORS.fit, dash: [], label: 'MLE', labelY: 10 });
      if (C.revealed) c.vline(C.spec.R0, { color: COLORS.truth, dash: [1, 2], label: 'truth', labelY: 34 });
    }, x => {
      const near = g.reduce((a, b) => (Math.abs(b.R0 - x) < Math.abs(a.R0 - x) ? b : a));
      return [{ text: `R₀ = ${near.R0.toFixed(2)}` }, { text: `deviance ${near.dev.toFixed(2)}`, color: COLORS.fit }, { text: `ρ̂ = ${(near.rho * 100).toFixed(0)}%  Î₀ = ${near.I0.toFixed(1)}`, color: COLORS.muted }];
    });
    cap.textContent = `Profile likelihood · ρ, I₀ re-optimised at each of ${g.length} grid points (k at MLE). Cut-off inflated by ĉ = ${C.prof.adj.c.toFixed(2)} (dispersion φ̂ = ${C.prof.adj.phi.toFixed(2)}, residual lag-1 autocorrelation ${C.prof.adj.r1.toFixed(2)}) to allow for process noise.`;
  } else if (tab === 'rt') {
    const rt = C.rt;
    let truthRt = null;
    if (C.revealed) truthRt = C.traj.S.map(s => C.spec.R0 * s / C.spec.N);
    const xmax = C.revealed ? C.horizon : C.today;
    if (!rt.length) { side.render(c => c.empty('Not enough cases yet (need ≥ 12)')); cap.textContent = ''; return; }
    const ymax = Math.min(8, niceMax(Math.max(2, ...rt.map(r => r.hi)) * 1.05));
    side.render(c => {
      c.axes({ xMin: 0, xMax: xmax, yMin: 0, yMax: ymax, xFmt: v => 'd' + Math.round(v), yFmt: v => v.toFixed(1), yTicks: 4, xTicks: 5, yLabel: 'Rₜ' });
      c.band(rt.map(r => r.t), rt.map(r => r.lo), rt.map(r => r.hi), { color: 'rgba(74,159,216,0.2)' });
      c.line(rt.map(r => r.t), rt.map(r => r.mean), { color: COLORS.guess, width: 2 });
      c.hline(1, { color: alpha(COLORS.I, 0.6), label: 'Rₜ = 1', dash: [4, 3] });
      if (truthRt) c.line(C.traj.days, truthRt, { color: COLORS.truth, dash: [2, 3], width: 1.2 });
    }, x => {
      const r = rt.find(q => q.t === Math.round(x));
      const rows = [];
      if (r) rows.push({ text: `Day ${r.t}` }, { text: `Rₜ ${r.mean.toFixed(2)} [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}]`, color: COLORS.guess });
      if (truthRt && truthRt[Math.round(x)] !== undefined) rows.push({ text: `true R₀·S/N ${truthRt[Math.round(x)].toFixed(2)}`, color: COLORS.truth });
      return rows.length ? rows : null;
    });
    const last = rt.at(-1);
    cap.textContent = `Latest Rₜ = ${last.mean.toFixed(2)} (95% CrI ${last.lo.toFixed(2)}–${last.hi.toFixed(2)}) · ${last.lo > 1 ? 'still growing' : last.hi < 1 ? 'declining' : 'uncertain whether growing'} · mean generation interval ${(C.known.latent + C.known.infectious).toFixed(1)} d`;
  } else {
    const glm = C.glm;
    const pts = C.yObs.map((v, t) => ({ t, v })).filter(p => p.t > 0);
    const ymax = niceMax(Math.max(...C.yObs, 2) * 1.5);
    side.render(c => {
      c.axes({ xMin: 0, xMax: C.today, yMin: 0.5, yMax: ymax, logY: true, xFmt: v => 'd' + Math.round(v), yFmt: v => (v >= 10 ? Math.round(v) : v.toFixed(1)), yTicks: 4, xTicks: 5, yLabel: 'cases (log)' });
      c.marks(pts.map(p => p.t), pts.map(p => Math.max(0.5, p.v)), { shape: 'dot', color: COLORS.obs, size: 2.2 });
      if (glm) {
        const ts = glm.fitted.map((_, i) => glm.from + i);
        c.line(ts, glm.fitted, { color: COLORS.guess, width: 2 });
        c.vline(glm.from, { color: COLORS.muted, dash: [2, 3] });
        c.vline(glm.to, { color: COLORS.muted, dash: [2, 3], label: 'fit window', align: 'right' });
      }
    }, x => {
      const d = Math.round(x);
      if (d < 1 || d > C.today) return null;
      const rows = [{ text: `Day ${d}: ${C.yObs[d]} cases`, color: COLORS.obs }];
      if (glm && d >= glm.from && d <= glm.to) rows.push({ text: `GLM fit ${glm.fitted[d - glm.from].toFixed(1)}`, color: COLORS.guess });
      return rows;
    });
    cap.textContent = glm
      ? `r = ${glm.r.toFixed(3)}/day (95% CI ${glm.lo.toFixed(3)}–${glm.hi.toFixed(3)}), dispersion φ = ${glm.phi.toFixed(1)}, ${glm.n} days. On a log scale, exponential growth is a straight line.`
      : 'Not enough data in the growth phase yet.';
  }
}

function renderEstimates() {
  if (!C) return;
  const rows = [];
  const ci = (lo, hi, d = 2) => `[${lo === null ? '<' : lo.toFixed(d)}, ${hi === null ? '>' : hi.toFixed(d)}]`;
  if (C.guess) {
    rows.push(`<tr><td>Your R₀ · ρ</td><td class="r" style="color:var(--blue-bright)">${C.guess.R0.toFixed(2)} · ${Math.round(C.guess.rho * 100)}%</td></tr>`);
    rows.push(`<tr><td>Log-lik gap to MLE</td><td class="r">${C.guess.delta.toFixed(2)}</td></tr>`);
  }
  if (C.glm) {
    const r0g = R0FromGLM(C.glm, C.known.latent, C.known.infectious);
    rows.push(`<tr><td>Growth rate r (GLM)</td><td class="r">${C.glm.r.toFixed(3)} ${ci(C.glm.lo, C.glm.hi, 3)}</td></tr>`);
    rows.push(`<tr><td>Doubling time</td><td class="r">${C.glm.r > 0 ? (Math.log(2) / C.glm.r).toFixed(1) + ' d' : '—'}</td></tr>`);
    rows.push(`<tr><td>R₀ from growth (Euler–Lotka)</td><td class="r">${r0g.R0.toFixed(2)} ${ci(r0g.lo, r0g.hi)}</td></tr>`);
  }
  if (C.rt.length) {
    const l = C.rt.at(-1);
    rows.push(`<tr><td>Latest Rₜ (Cori, d${l.t})</td><td class="r">${l.mean.toFixed(2)} ${ci(l.lo, l.hi)}</td></tr>`);
  }
  if (C.prof) {
    const m = C.mle;
    rows.push(`<tr><th colspan="2" style="padding-top:8px">MAXIMUM LIKELIHOOD (NegBin–SEIR)</th></tr>`);
    rows.push(`<tr><td>R₀ · 95% profile CI${C.prof.adj.c > 1.01 ? ' (ĉ-adjusted)' : ''}</td><td class="r" style="color:var(--teal)">${m.R0.toFixed(2)} ${ci(C.prof.ciLo, C.prof.ciHi)}</td></tr>`);
    rows.push(`<tr><td>Reporting rate ρ</td><td class="r">${(m.rho * 100).toFixed(0)}%</td></tr>`);
    rows.push(`<tr><td>Initial infected I₀ · dispersion k</td><td class="r">${m.I0.toFixed(1)} · ${m.k > 500 ? '∞ (Poisson)' : m.k.toFixed(1)}</td></tr>`);
    const peakDay = C.mleCurve.indexOf(Math.max(...C.mleCurve));
    rows.push(`<tr><td>Forecast peak</td><td class="r">day ${peakDay} · ~${Math.round(C.mleCurve[peakDay])}/day</td></tr>`);
    rows.push(`<tr><td>Forecast total reported</td><td class="r">${fmt.int(C.mleCurve.reduce((a, b) => a + b, 0))}</td></tr>`);
  }
  if (C.revealed) {
    const s = C.spec;
    const truePeak = C.y.indexOf(Math.max(...C.y));
    const cover = C.prof && C.prof.ciLo !== null && C.prof.ciHi !== null && s.R0 >= C.prof.ciLo && s.R0 <= C.prof.ciHi;
    rows.push(`<tr><th colspan="2" style="padding-top:8px">GROUND TRUTH</th></tr>`);
    rows.push(`<tr><td>True R₀ · ρ</td><td class="r" style="color:var(--bright)">${s.R0.toFixed(2)} · ${Math.round(s.rho * 100)}%</td></tr>`);
    rows.push(`<tr><td>True k · I₀</td><td class="r">${s.k} · ${s.I0}</td></tr>`);
    rows.push(`<tr><td>Observed peak · total</td><td class="r">day ${truePeak} · ${fmt.int(C.y.reduce((a, b) => a + b, 0))}</td></tr>`);
    if (C.prof) rows.push(`<tr><td>CI covered truth?</td><td class="r ${cover ? 'sig' : 'bad'}">${cover ? 'YES ✓' : 'NO ✗'}</td></tr>`);
    rows.push(`<tr><td>Your R₀ error</td><td class="r">${(get.r0() - s.R0 >= 0 ? '+' : '') + (get.r0() - s.R0).toFixed(2)}</td></tr>`);
  }
  html('f-estimates', `<table class="res">${rows.join('')}</table>` + hint());
  text('f-est-sub', `${C.today} days · ${fmt.int(C.yObs.reduce((a, b) => a + b, 0))} reported cases`);
}

function hint() {
  if (!C.guess || !C.mle || C.revealed) return '';
  const tips = [];
  const obsTot = C.yObs.reduce((a, b) => a + b, 0);
  const preTot = C.guess.curve.slice(0, C.today + 1).reduce((a, b) => a + b, 0);
  if (C.guess.score < 80) {
    if (C.guess.R0 > C.mle.R0 * 1.08) tips.push('Your curve grows faster than the data. <em>Lower R₀</em>.');
    else if (C.guess.R0 < C.mle.R0 * 0.92) tips.push('The data grows faster than your curve. <em>Raise R₀</em>.');
    if (preTot > obsTot * 1.25) tips.push('Your model predicts too many cases so far. Try a lower ρ.');
    else if (preTot < obsTot * 0.8) tips.push('Your model predicts too few cases so far. Try a higher ρ.');
  }
  const peaked = C.yObs.indexOf(Math.max(...C.yObs)) < C.today - 7;
  if (!peaked) tips.push('Before the peak, ρ and I₀ are nearly interchangeable: early growth only pins down R₀. Wait for more data to identify ρ.');
  return tips.length ? `<div class="note" style="margin-top:8px">${tips.join('<br>')}</div>` : '';
}
