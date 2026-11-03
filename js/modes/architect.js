// Mode I — Outbreak Architect: design a pathogen and watch it spread.

import { simulateSEIRD, summarise } from '../models/ode.js';
import { runEnsemble } from '../models/stochastic.js';
import { finalSize, herdImmunityThreshold, growthRateFromR0, doublingTime, extinctionProbability } from '../models/theory.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { Chart, COLORS, alpha, niceMax } from '../ui/chart.js';
import { $, $$, slider, fmt, text, html } from '../ui/dom.js';
import { state, update } from '../state.js';

let chart, side;
let engine = 'ode';
let seed = randomSeed();
let current = null;   // { p, traj, ens, horizon }
let animFrac = 1, animId = 0;
let get = {};
let debounce = 0;
let toast;

export function initArchitect(ctx) {
  toast = ctx.toast;
  chart = new Chart($('#a-chart'));
  side = new Chart($('#a-side'));
  const recompute = () => schedule();
  get.r0 = slider('a-r0', v => v.toFixed(1), recompute);
  get.lat = slider('a-lat', v => (v === 0 ? '0 d · SIRD' : v + ' d'), recompute);
  get.inf = slider('a-inf', v => v + ' d', recompute);
  get.cfr = slider('a-cfr', v => v.toFixed(1) + '%', recompute);
  get.n = slider('a-n', fmt.int, recompute);
  get.i0 = slider('a-i0', fmt.int, recompute);
  get.imm = slider('a-imm', v => v + '%', recompute);
  get.runs = slider('a-runs', v => v, recompute);

  $$('#a-engine button').forEach(b => b.addEventListener('click', () => {
    $$('#a-engine button').forEach(x => x.classList.toggle('on', x === b));
    engine = b.dataset.engine;
    $('#a-runs-wrap').style.display = engine === 'stoch' ? 'block' : 'none';
    $('#a-leg-band').style.display = engine === 'stoch' ? 'inline-flex' : 'none';
    seed = randomSeed();
    compute(); draw();
  }));

  $('#a-release').addEventListener('click', release);
  compute(); draw();
}

export function enterArchitect(banner) {
  banner(state.outbreak
    ? `<em>PATHOGEN RELEASED.</em> R₀ = ${state.outbreak.R0.toFixed(1)}, latent ${state.outbreak.latent} d, infectious ${state.outbreak.infectious} d, CFR ${(state.outbreak.cfr * 100).toFixed(1)}%. The clinic in Sporeford has started logging cases. <em>Investigate the outbreak (II) or command the response (IV).</em>`
    : `Three days of relentless rain. The levees broke at 04:00, and the floodwaters tore open a cavern beneath the valley — releasing the spores of an unclassified <em>Amanita</em> species into Amanita Hollow's water supply. <em>You design the pathogen.</em> Set how it spreads, how long it incubates and how often it kills — then switch on the stochastic engine to see how chance decides whether a spark becomes a fire.`);
  chart.redraw(); side.redraw();
}

function params() {
  return {
    R0: get.r0(), latent: get.lat(), infectious: get.inf(), cfr: get.cfr() / 100,
    N: get.n(), I0: get.i0(), immune: get.imm() / 100,
  };
}

function horizonFor(p) {
  const probe = simulateSEIRD({ ...p, days: 730, dt: 0.25 });
  const s = summarise(probe);
  let end = 60;
  for (let d = s.peakDay; d < probe.days.length; d++) {
    if (probe.E[d] + probe.I[d] < Math.max(0.5, 2e-4 * p.N)) { end = d + 10; break; }
    end = d;
  }
  return Math.min(365, Math.max(60, Math.ceil(end / 20) * 20));
}

function schedule() {
  if (engine === 'ode') { compute(); draw(); return; }
  clearTimeout(debounce);
  debounce = setTimeout(() => { compute(); draw(); }, 120);
}

function compute() {
  const p = params();
  const horizon = horizonFor(p);
  const traj = simulateSEIRD({ ...p, days: horizon });
  let ens = null;
  if (engine === 'stoch') {
    const rng = makeRng(seed);
    ens = runEnsemble({ ...p, days: horizon }, rng, get.runs());
    text('a-method-hint', ens.method === 'gillespie'
      ? 'Exact Gillespie direct method (N ≤ 8,000)'
      : 'Binomial tau-leaping, dt = 0.25 d (N > 8,000)');
  }
  current = { p, traj, ens, horizon };
  updateStats();
}

function updateStats() {
  const { p, traj, ens } = current;
  const s = summarise(traj);
  const s0 = 1 - p.immune;
  const Reff = p.R0 * s0;
  const z = finalSize(p.R0, s0);
  const hit = herdImmunityThreshold(p.R0);
  const r = growthRateFromR0(Reff, p.latent, p.infectious);
  const pMajorTheory = 1 - extinctionProbability(Reff, p.I0);

  text('a-peak', fmt.pct(s.peakI / p.N));
  text('a-peakday', s.peakI > p.I0 * 1.01 ? `Day ${s.peakDay}` : '—');
  text('a-deaths', fmt.int(s.deaths));
  text('a-hit', p.R0 > 1 ? fmt.pct(hit, 0) : 'n/a');
  text('a-dbl', r > 0 ? `${r.toFixed(3)} · ${doublingTime(r).toFixed(1)}d` : `${r.toFixed(3)} · —`);

  if (ens) {
    const majors = ens.finalSizes.filter(x => x >= ens.threshold);
    const meanMajor = majors.length ? majors.reduce((a, b) => a + b, 0) / majors.length / p.N : 0;
    text('a-attack', `${fmt.pct(meanMajor)} · ${fmt.pct(z)}`);
    text('a-attack-l', 'Attack rate (mean of major runs · final-size eq.)');
    text('a-pmajor', `${fmt.pct(ens.pMajor, 0)} · ${fmt.pct(pMajorTheory, 0)}`);
    text('a-pmajor-l', `P(major outbreak) · simulated vs branching theory`);
  } else {
    text('a-attack', `${fmt.pct(s.totalInfected / p.N)} · ${fmt.pct(z)}`);
    text('a-attack-l', 'Attack rate (ODE · final-size eq.)');
    text('a-pmajor', fmt.pct(pMajorTheory, 0));
    text('a-pmajor-l', 'P(major outbreak) · branching theory');
  }

  let msg;
  if (Reff <= 1) {
    msg = p.R0 <= 1
      ? `R₀ = ${p.R0.toFixed(1)} ≤ 1: each case infects fewer than one other person on average. The chain of transmission <em>dies out</em> — though in the stochastic engine a few small clusters still appear.`
      : `Herd immunity already holds: ${fmt.pct(p.immune, 0)} immune ≥ HIT ${fmt.pct(hit, 0)}, so R_eff = R₀·s₀ = ${Reff.toFixed(2)} ≤ 1. <em>Amanita Hollow is protected.</em>`;
  } else {
    const overshoot = z - (hit - p.immune);
    msg = `R_eff = ${Reff.toFixed(2)}. Cases double every <em>${doublingTime(r).toFixed(1)} days</em> early on. At the peak (day ${s.peakDay}), ` +
      `<em>${fmt.pct(s.peakI / p.N)}</em> of the valley is infectious at once. In total, <em>${fmt.pct(z)}</em> are infected and about <em>${fmt.int(s.deaths)}</em> die. ` +
      `Infections continue after herd immunity is reached: the epidemic overshoots the HIT by ${fmt.pct(Math.max(0, overshoot), 0)} of the population. `;
    if (ens) {
      msg += `Across ${ens.runs.length} stochastic realisations, <em>${fmt.pct(1 - ens.pMajor, 0)}</em> fizzled out by chance (theory predicts ${fmt.pct(1 - pMajorTheory, 0)}). The final-size histogram on the left is <em>bimodal</em>: an outbreak is either minor or major.`;
    } else {
      msg += `Even so, there is a ${fmt.pct(1 - pMajorTheory, 0)} chance that the introduction dies out by luck. Switch to the stochastic engine to see this.`;
    }
  }
  html('a-insight', msg);
}

function draw() {
  if (!current) return;
  const { p, traj, ens, horizon } = current;
  const N = p.N;
  const vis = Math.max(1, Math.round(horizon * animFrac));
  const cut = arr => arr.slice(0, vis + 1);
  const xs = cut(traj.days);

  chart.render(c => {
    c.axes({ xMin: 0, xMax: horizon, yMin: 0, yMax: 1, yFmt: v => Math.round(v * 100) + '%', xFmt: v => 'd' + Math.round(v), xLabel: 'days since the flood' });
    if (p.R0 > 1) c.hline(herdImmunityThreshold(p.R0), { color: 'rgba(192,57,43,0.35)', label: 'HIT ' + Math.round(herdImmunityThreshold(p.R0) * 100) + '%' });
    const fade = ens ? 0.35 : 1;
    if (ens) {
      c.band(ens.days.slice(0, vis + 1), cut(ens.bandI.lo).map(v => v / N), cut(ens.bandI.hi).map(v => v / N), { color: 'rgba(192,57,43,0.18)' });
      ens.runs.slice(0, 40).forEach(r => c.line(xs, cut(r.I).map(v => v / N), { color: COLORS.I, width: 0.8, alpha: 0.18 }));
      c.line(xs, cut(ens.bandD.mid).map(v => v / N), { color: COLORS.D, width: 1.5, dash: [3, 3] });
    }
    c.area(xs, cut(traj.I).map(v => v / N), { color: 'rgba(192,57,43,0.06)' });
    c.line(xs, cut(traj.S).map(v => v / N), { color: COLORS.S, alpha: fade });
    if (p.latent > 0) c.line(xs, cut(traj.E).map(v => v / N), { color: COLORS.E, alpha: fade });
    c.line(xs, cut(traj.R).map(v => v / N), { color: COLORS.R, alpha: fade });
    c.line(xs, cut(traj.D).map(v => v / N), { color: COLORS.D, alpha: fade });
    c.line(xs, cut(traj.I).map(v => v / N), { color: COLORS.I, width: 2.5, alpha: ens ? 0.8 : 1 });
    if (animFrac < 1) {
      const last = xs.length - 1;
      c.marks([xs[last]], [traj.I[last] / N], { shape: 'dot', color: COLORS.I, size: 4 });
    }
  }, x => {
    const d = Math.max(0, Math.min(horizon, Math.round(x)));
    if (d > vis) return null;
    const rows = [{ text: `Day ${d}${ens ? ' · ODE' : ''}` },
      { text: `S ${fmt.pct(traj.S[d] / N)}`, color: COLORS.S },
      p.latent > 0 ? { text: `E ${fmt.pct(traj.E[d] / N)}`, color: COLORS.E } : null,
      { text: `I ${fmt.pct(traj.I[d] / N)}  (${fmt.int(traj.I[d])})`, color: COLORS.I },
      { text: `R ${fmt.pct(traj.R[d] / N)}`, color: COLORS.R },
      { text: `D ${fmt.int(traj.D[d])}`, color: COLORS.D }].filter(Boolean);
    if (ens) rows.push({ text: `I 90% band ${fmt.int(ens.bandI.lo[d])}–${fmt.int(ens.bandI.hi[d])}`, color: alpha(COLORS.I, 0.8) });
    return rows;
  });
  text('a-day', `Day ${vis}`);
  text('a-chart-sub', ens
    ? `${ens.runs.length} ${ens.method === 'gillespie' ? 'Gillespie' : 'tau-leap'} realisations (thin) · ODE (faded) · fraction of population`
    : 'SEIRD · RK4 · fraction of population · hover for values');

  drawSide();
}

function drawSide() {
  const { p, ens } = current;
  const s0 = 1 - p.immune;
  if (!ens) {
    text('a-side-title', 'Final size vs R₀');
    text('a-side-sub', 'z = s₀(1 − e^{−R₀z}) · dashed = herd immunity threshold');
    const xs = [], zs = [], hs = [];
    for (let r = 0.5; r <= 8.0001; r += 0.05) { xs.push(r); zs.push(finalSize(r, s0)); hs.push(herdImmunityThreshold(r)); }
    side.render(c => {
      c.axes({ xMin: 0.5, xMax: 8, yMin: 0, yMax: 1, yFmt: v => Math.round(v * 100) + '%', xFmt: v => v.toFixed(1), xTicks: 5, yTicks: 4, xLabel: 'R₀' });
      c.line(xs, hs, { color: '#8fb8d4', dash: [4, 4], width: 1.2 });
      c.line(xs, zs, { color: COLORS.R, width: 2 });
      c.vline(p.R0, { color: alpha(COLORS.I, 0.6) });
      c.marks([p.R0], [finalSize(p.R0, s0)], { shape: 'dot', color: COLORS.I, size: 4 });
    }, x => [{ text: `R₀ = ${x.toFixed(2)}` }, { text: `final size ${fmt.pct(finalSize(x, s0))}`, color: COLORS.R }, { text: `HIT ${fmt.pct(herdImmunityThreshold(x))}`, color: '#8fb8d4' }]);
    return;
  }
  text('a-side-title', 'Distribution of final sizes');
  text('a-side-sub', `${ens.runs.length} realisations · blue = died out (minor) · red = major · line = final-size equation`);
  const bins = 25, minor = new Array(bins).fill(0), major = new Array(bins).fill(0);
  ens.finalSizes.forEach(f => { const b = Math.min(bins - 1, Math.floor(f / p.N * bins)); (f >= ens.threshold ? major : minor)[b]++; });
  const counts = minor.map((m, i) => m + major[i]);
  const centres = counts.map((_, i) => (i + 0.5) / bins);
  const maxC = niceMax(Math.max(...counts, 1) * 1.1);
  side.render(c => {
    c.axes({ xMin: 0, xMax: 1, yMin: 0, yMax: maxC, xFmt: v => Math.round(v * 100) + '%', yFmt: v => Math.round(v), xTicks: 5, yTicks: 4, xLabel: 'fraction ever infected' });
    c.bars(centres, counts, { color: COLORS.I, widthFrac: 0.85 / bins });
    c.bars(centres, minor, { color: COLORS.S, widthFrac: 0.85 / bins, alpha: 0.95 });
    const z = finalSize(p.R0, s0);
    if (z > 0) c.vline(z, { color: COLORS.I, dash: [], label: 'theory', labelY: 12 });
  }, x => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(x * bins)));
    return [{ text: `${Math.round(b / bins * 100)}–${Math.round((b + 1) / bins * 100)}% infected` }, { text: `${major[b]} major runs`, color: COLORS.I }, { text: `${minor[b]} minor (died out)`, color: COLORS.S }];
  });
}

function release() {
  const p = params();
  const outbreakSeed = randomSeed();
  update({ outbreak: { ...p, seed: outbreakSeed } });
  $('#a-goto-field').disabled = p.R0 * (1 - p.immune) <= 1;
  cancelAnimationFrame(animId);
  const t0 = performance.now(), dur = 2200;
  const step = ts => {
    const f = Math.min(1, (ts - t0) / dur);
    animFrac = f < 0.5 ? 2 * f * f : -1 + (4 - 2 * f) * f;
    draw();
    if (f < 1) animId = requestAnimationFrame(step);
    else { animFrac = 1; draw(); }
  };
  animId = requestAnimationFrame(step);
  $('#storyBanner').innerHTML = `<em>SPORES RELEASED.</em> R₀ = ${p.R0.toFixed(1)}, latent ${p.latent} d, infectious ${p.infectious} d, CFR ${(p.cfr * 100).toFixed(1)}%, N = ${fmt.int(p.N)}. ` +
    (p.R0 * (1 - p.immune) > 1
      ? `The Sporeford clinic will start logging cases. <em>Switch to Field Epidemiologist and find out what you just unleashed, without looking at these sliders.</em>`
      : `With R_eff ≤ 1 this pathogen is unlikely to establish itself. There is nothing for the field team to investigate.`);
  toast(p.R0 * (1 - p.immune) > 1 ? 'Outbreak seeded. Field data is ready in mode II.' : 'R_eff ≤ 1: the outbreak will fizzle.');
}
