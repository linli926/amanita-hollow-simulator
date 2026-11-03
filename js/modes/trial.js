// Mode III — Clinical Trial: design, run and analyse a randomised survival study.

import { simulateTrial, kaplanMeier, kmMedian, nelsonAalen, logRank, coxPH, concordance,
  schoenfeldEvents, schoenfeldPower, expectedEventFraction, simulatePower, atRisk } from '../stats/survival.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { Chart, COLORS, alpha } from '../ui/chart.js';
import { $, slider, fmt, text, html, tabs, downloadCSV, defer } from '../ui/dom.js';
import { state, update } from '../state.js';

let km, side, sideTab;
let get = {};
let R = null;      // last trial result
let powerSim = null;
let toast;
let designTimer = 0;

export function initTrial(ctx) {
  toast = ctx.toast;
  km = new Chart($('#t-km'), { pad: { left: 46 } });
  side = new Chart($('#t-side'));
  const d = () => { powerSim = null; clearTimeout(designTimer); designTimer = setTimeout(renderDesign, 80); };
  get.n = slider('t-n', fmt.int, d);
  get.acc = slider('t-acc', v => v + ' d', d);
  get.fu = slider('t-fu', v => v + ' d', d);
  get.drop = slider('t-drop', v => v + '%', d);
  get.hr = slider('t-hr', v => v.toFixed(2), d);
  get.m60 = slider('t-m60', v => v + '%', d);
  get.shape = slider('t-shape', v => v.toFixed(1), d);
  get.hrage = slider('t-hrage', v => v.toFixed(2), d);
  get.hrcom = slider('t-hrcom', v => v.toFixed(1), d);
  sideTab = tabs($('#t-tabs'), () => drawSide());
  $('#t-run').addEventListener('click', run);
  $('#t-power').addEventListener('click', runPower);
  $('#t-csv').addEventListener('click', () => {
    if (!R) return;
    downloadCSV('amanita-hollow-trial.csv', ['id', 'arm', 'age', 'comorbidity', 'enrol_day', 'time', 'death'],
      R.patients.map(p => [p.id, p.trt ? 'treatment' : 'control', p.age, p.comorb, p.enrol.toFixed(1), p.time, p.event]));
  });
  renderDesign();
  km.render(c => c.empty('Design the trial, then press RUN THE TRIAL'));
  side.render(c => c.empty('No data yet'));
}

export function enterTrial(banner) {
  const o = state.outbreak;
  banner(`<em>KA MEDICAL SCHOOL · EMERGENCY DEPLOYMENT.</em> A candidate antifungal, <em>Volvarin</em>, has reached the Hollow. ` +
    (o ? `The outbreak you seeded (CFR ${(o.cfr * 100).toFixed(1)}%) is filling the wards. ` : '') +
    `Design a randomised controlled trial and analyse survival with Kaplan–Meier, log-rank and Cox regression. <em>A significant benefit unlocks treatment in Outbreak Response.</em> An underpowered trial wastes patients and time.`);
  km.redraw(); side.redraw();
}

function opts() {
  const drop = get.drop() / 100;
  return {
    n: get.n(), hr: get.hr(), controlMortality: get.m60() / 100, shape: get.shape(),
    hrAgePer10: get.hrage(), hrComorb: get.hrcom(), accrualDays: get.acc(), followUpDays: get.fu(),
    dropoutRate: drop > 0 ? -Math.log(1 - drop) / 60 : 0,
  };
}

function renderDesign() {
  const o = opts();
  const frac = expectedEventFraction(o, makeRng(12345), 5000);
  const D = frac * o.n;
  const hr = o.hr;
  const pw = schoenfeldPower(hr, D);
  const need = hr !== 1 ? schoenfeldEvents(hr, 0.05, 0.8) : Infinity;
  const needN = isFinite(need) ? Math.ceil(need / frac / 2) * 2 : Infinity;
  const pwClass = pw >= 0.8 ? 'sig' : pw >= 0.5 ? 'ns' : 'bad';
  html('t-design', `
    <table class="res">
      <tr><td>Expected deaths</td><td class="r">${D.toFixed(0)} (${fmt.pct(frac, 0)})</td></tr>
      <tr><td>Deaths needed for 80% power</td><td class="r">${isFinite(need) ? Math.ceil(need) : '∞'}</td></tr>
      <tr><td>Patients needed</td><td class="r">${isFinite(needN) ? fmt.int(needN) : '∞'}</td></tr>
      <tr><td>Analytic power</td><td class="r ${pwClass}">${hr === 1 ? 'n/a (HR = 1)' : fmt.pct(pw, 0)}</td></tr>
      ${powerSim ? `<tr><td>Simulated power (${powerSim.nTrials} trials)</td><td class="r ${powerSim.power >= 0.8 ? 'sig' : 'ns'}">${fmt.pct(powerSim.power, 1)}</td></tr>` : ''}
    </table>
    <div class="param-hint" style="margin-top:4px">Schoenfeld's formula, two-sided α = 0.05, 1:1 allocation. ${hr === 1 ? 'With HR = 1 every "significant" result is a false positive (type I error).' : ''}</div>`);
}

async function runPower() {
  const btn = $('#t-power');
  btn.disabled = true; btn.textContent = '⚄ SIMULATING…';
  await defer(() => { powerSim = simulatePower(opts(), makeRng(randomSeed()), 300); });
  btn.disabled = false; btn.textContent = '⚄ SIMULATE POWER (300 TRIALS)';
  renderDesign();
  toast(`${opts().hr === 1 ? 'Type I error' : 'Power'} from 300 simulated trials: ${fmt.pct(powerSim.power, 1)}`);
}

function run() {
  const o = opts();
  const { patients } = simulateTrial(o, makeRng(randomSeed()));
  const times = patients.map(p => p.time), events = patients.map(p => p.event), arms = patients.map(p => p.trt);
  const byArm = a => {
    const ps = patients.filter(p => p.trt === a);
    return { times: ps.map(p => p.time), events: ps.map(p => p.event) };
  };
  const g0 = byArm(0), g1 = byArm(1);
  const km0 = kaplanMeier(g0.times, g0.events), km1 = kaplanMeier(g1.times, g1.events);
  const lr = logRank(times, events, arms);
  const coxU = coxPH(times, events, patients.map(p => [p.trt]), ['Treatment']);
  const coxA = coxPH(times, events, patients.map(p => [p.trt, (p.age - 55) / 10, p.comorb]), ['Treatment', 'Age (+10 y)', 'Comorbidity']);
  const cIndex = concordance(times, events, coxA.linearPredictor);
  R = {
    o, patients, km0, km1, lr, coxU, coxA, cIndex,
    med0: kmMedian(km0), med1: kmMedian(km1),
    na0: nelsonAalen(g0.times, g0.events), na1: nelsonAalen(g1.times, g1.events),
    g0, g1,
    tMax: Math.max(...times),
  };
  $('#t-csv').disabled = false;
  drawKM(); drawSide(); renderReport();

  const tr = coxU.coefs[0];
  if (lr.p < 0.05 && tr.hr < 1) {
    update({ treatment: { trueHR: o.hr, estHR: tr.hr, lo: tr.lo, hi: tr.hi, p: lr.p } });
    toast(`Volvarin works (p ${fmt.p(lr.p)}). Treatment is now available in Outbreak Response.`);
  } else if (lr.p < 0.05) {
    toast('Significant, but in the wrong direction: Volvarin increases mortality.');
  } else {
    toast(`Not significant (p = ${fmt.p(lr.p)}). Absence of evidence is not evidence of absence. Check the power.`);
  }
}

function drawKM() {
  if (!R) return;
  const { km0, km1, tMax } = R;
  const xmax = Math.ceil(tMax / 10) * 10;
  const curves = [[km0, COLORS.control, R.med0], [km1, COLORS.treat, R.med1]];
  km.render(c => {
    c.axes({ xMin: 0, xMax: xmax, yMin: 0, yMax: 1, yFmt: v => Math.round(v * 100) + '%', xFmt: v => 'd' + Math.round(v), xLabel: 'days since randomisation', yLabel: 'survival' });
    c.hline(0.5, { color: 'rgba(185,160,115,0.18)', dash: [2, 4] });
    for (const [k, col] of curves) {
      c.stepBand(k.curve.map(p => p.t), k.curve.map(p => p.lo), k.curve.map(p => p.hi), { color: alpha(col, 0.12) }, xmax);
    }
    for (const [k, col, med] of curves) {
      c.step(k.curve.map(p => p.t), k.curve.map(p => p.s), { color: col, width: 2.2 }, k.tMax);
      c.marks(k.censorMarks.map(m => m.t), k.censorMarks.map(m => m.s), { shape: 'tick', color: col, size: 3, width: 1 });
      if (med.median !== null) {
        const { ctx } = c;
        ctx.strokeStyle = alpha(col, 0.6); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(c.X(med.median), c.Y(0.5)); ctx.lineTo(c.X(med.median), c.Y(0)); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    c.text(`log-rank p ${fmt.p(R.lr.p)}`, c.pad.left + c.pw - 6, c.pad.top + c.ph - 8, { px: true, align: 'right', color: R.lr.p < 0.05 ? COLORS.R : COLORS.obs });
  }, x => {
    const at = (k) => { let p = k.curve[0]; for (const q of k.curve) { if (q.t <= x) p = q; else break; } return p; };
    const a = at(km1), b = at(km0);
    return [{ text: `Day ${x.toFixed(0)}` },
      { text: `Treatment ${fmt.pct(a.s)} [${fmt.pct(a.lo, 0)}–${fmt.pct(a.hi, 0)}]`, color: COLORS.treat },
      { text: `Control   ${fmt.pct(b.s)} [${fmt.pct(b.lo, 0)}–${fmt.pct(b.hi, 0)}]`, color: COLORS.control },
      { text: `at risk ${atRisk(R.g1.times, x)} · ${atRisk(R.g0.times, x)}`, color: COLORS.muted }];
  });
  // Number-at-risk table
  const ticks = Array.from({ length: 7 }, (_, i) => Math.round(xmax * i / 6));
  const row = (label, g, col) => `<tr><td style="color:${col}">${label}</td>${ticks.map(t => `<td>${atRisk(g.times, t)}</td>`).join('')}</tr>`;
  html('t-risk', `<table><tr><td>Number at risk</td>${ticks.map(t => `<td>d${t}</td>`).join('')}</tr>${row('Treatment', R.g1, COLORS.treat)}${row('Control', R.g0, COLORS.control)}</table>`);
}

function drawSide(tab = sideTab()) {
  if (!R) return;
  const cap = $('#t-side-caption');
  if (tab === 'forest') {
    const rows = [...R.coxA.coefs, { ...R.coxU.coefs[0], name: 'Treatment (unadj.)' }];
    const truth = { 'Treatment': R.o.hr, 'Age (+10 y)': R.o.hrAgePer10, 'Comorbidity': R.o.hrComorb, 'Treatment (unadj.)': R.o.hr };
    const lo = Math.min(0.2, ...rows.map(r => r.lo)) * 0.9, hi = Math.max(5, ...rows.map(r => r.hi)) * 1.1;
    side.render(c => {
      c.axes({ pad: { left: 118 }, xMin: lo, xMax: hi, yMin: 0, yMax: rows.length + 1, logX: true, xTicks: 4, yTicks: 1, xFmt: v => v.toFixed(v < 1 ? 2 : 1), yFmt: () => '', xLabel: 'hazard ratio (log scale)' });
      c.vline(1, { color: 'rgba(232,220,196,0.4)', dash: [] });
      rows.forEach((r, i) => {
        const y = rows.length - i;
        const col = r.p < 0.05 ? COLORS.R : COLORS.obs;
        c.line([r.lo, r.hi], [y, y], { color: col, width: 2 });
        c.marks([r.hr], [y], { shape: 'dot', color: col, size: 4 });
        c.marks([truth[r.name]], [y], { shape: 'cross', color: COLORS.truth, size: 4, width: 1 });
        c.text(r.name, c.pad.left - 8, c.Y(y) + 3, { px: true, align: 'right', color: COLORS.text });
      });
    }, x => [{ text: `HR = ${x.toFixed(2)}` }, { text: '× = true value', color: COLORS.truth }]);
    cap.textContent = `Cox PH (Breslow) · ● estimate with 95% Wald CI · × true HR · C-index ${R.cIndex.toFixed(3)}. Adjusting for prognostic covariates sharpens the treatment estimate.`;
  } else if (tab === 'loglog') {
    const pts = k => k.curve.filter(p => p.t > 0 && p.s > 0 && p.s < 1).map(p => ({ x: p.t, y: Math.log(-Math.log(p.s)) }));
    const a = pts(R.km0), b = pts(R.km1);
    if (a.length < 2 || b.length < 2) { side.render(c => c.empty('Too few deaths for a PH check')); return; }
    const all = [...a, ...b];
    const xmin = Math.max(0.5, Math.min(...all.map(p => p.x))), xmax = Math.max(...all.map(p => p.x));
    const ymin = Math.min(...all.map(p => p.y)) - 0.3, ymax = Math.max(...all.map(p => p.y)) + 0.3;
    side.render(c => {
      c.axes({ xMin: xmin, xMax: xmax, yMin: ymin, yMax: ymax, logX: true, xTicks: 4, yTicks: 4, xFmt: v => v.toFixed(v < 10 ? 1 : 0), yFmt: v => v.toFixed(1), xLabel: 'time (log)', yLabel: 'log(−log S)' });
      c.step(a.map(p => p.x), a.map(p => p.y), { color: COLORS.control, width: 1.8 });
      c.step(b.map(p => p.x), b.map(p => p.y), { color: COLORS.treat, width: 1.8 });
    });
    cap.textContent = `Proportional hazards ⇔ parallel curves; their vertical gap ≈ log HR = ${Math.log(R.coxU.coefs[0].hr).toFixed(2)}. Weibull data give straight lines with slope k = ${R.o.shape.toFixed(1)}.`;
  } else {
    const ymax = Math.max(R.na0.at(-1).H, R.na1.at(-1).H, 0.05) * 1.15;
    side.render(c => {
      c.axes({ xMin: 0, xMax: R.tMax, yMin: 0, yMax: ymax, xFmt: v => 'd' + Math.round(v), yFmt: v => v.toFixed(2), yTicks: 4, xTicks: 5, yLabel: 'H(t)' });
      c.step(R.na0.map(p => p.t), R.na0.map(p => p.H), { color: COLORS.control, width: 1.8 }, R.tMax);
      c.step(R.na1.map(p => p.t), R.na1.map(p => p.H), { color: COLORS.treat, width: 1.8 }, R.tMax);
    }, x => {
      const at = arr => { let h = 0; for (const p of arr) { if (p.t <= x) h = p.H; else break; } return h; };
      return [{ text: `Day ${x.toFixed(0)}` }, { text: `H treat ${at(R.na1).toFixed(3)}`, color: COLORS.treat }, { text: `H ctrl  ${at(R.na0).toFixed(3)}`, color: COLORS.control }];
    });
    cap.textContent = 'Nelson–Aalen cumulative hazard Ĥ(t) = Σ dᵢ/nᵢ. Under PH the ratio of the two curves is constant.';
  }
}

function renderReport() {
  const { lr, coxU, coxA, cIndex, med0, med1, km0, km1, o, patients } = R;
  const n1 = patients.filter(p => p.trt).length, n0 = patients.length - n1;
  const dropped = patients.filter(p => p.dropped).length;
  const med = m => (m.median === null ? 'not reached' : `${m.median.toFixed(0)} d [${m.lo === null ? '—' : m.lo.toFixed(0)}, ${m.hi === null ? 'NR' : m.hi.toFixed(0)}]`);
  const u = coxU.coefs[0];
  const sigCls = lr.p < 0.05 ? 'sig' : 'ns';
  const coefRows = coxA.coefs.map(c => `<tr><td>${c.name}</td><td class="r">${c.hr.toFixed(2)}</td><td class="r">${c.lo.toFixed(2)}–${c.hi.toFixed(2)}</td><td class="r ${c.p < 0.05 ? 'sig' : 'ns'}">${fmt.p(c.p)}</td></tr>`).join('');
  const verdict = lr.p < 0.05
    ? (u.hr < 1 ? `<span class="sig">Volvarin significantly reduces mortality</span> (HR ${u.hr.toFixed(2)}, 95% CI ${u.lo.toFixed(2)}–${u.hi.toFixed(2)}).${o.hr >= 1 ? ' <span class="bad">But the true HR is ≥ 1, so this is a false positive (type I error).</span>' : ''}`
      : `<span class="bad">Volvarin significantly <em>increases</em> mortality.</span>`)
    : `<span class="ns">No significant difference detected.</span> ${o.hr < 1 ? `The true HR is ${o.hr.toFixed(2)}, so this is a <em>type II error</em>. ${lr.O0 + lr.O1 < schoenfeldEvents(o.hr) ? 'The trial observed too few deaths.' : ''}` : ''}`;
  html('t-report', `
    <table class="res">
      <tr><th></th><th class="r">Treatment</th><th class="r">Control</th></tr>
      <tr><td>Patients · deaths</td><td class="r" style="color:var(--green-bright)">${n1} · ${km1.events}</td><td class="r" style="color:var(--red-bright)">${n0} · ${km0.events}</td></tr>
      <tr><td>Median survival [95% CI]</td><td class="r">${med(med1)}</td><td class="r">${med(med0)}</td></tr>
      <tr><td>Observed / expected deaths</td><td class="r">${lr.O1} / ${lr.E1.toFixed(1)}</td><td class="r">${lr.O0} / ${lr.E0.toFixed(1)}</td></tr>
    </table>
    <table class="res" style="margin-top:8px">
      <tr><td>Log-rank χ²₁</td><td class="r">${lr.chi2.toFixed(2)}</td><td class="r ${sigCls}" colspan="2">p ${fmt.p(lr.p)}</td></tr>
      <tr><td>Cox HR (unadjusted)</td><td class="r">${u.hr.toFixed(2)}</td><td class="r">${u.lo.toFixed(2)}–${u.hi.toFixed(2)}</td><td class="r">p ${fmt.p(u.p)}</td></tr>
    </table>
    <table class="res" style="margin-top:8px">
      <tr><th>Adjusted Cox model</th><th class="r">HR</th><th class="r">95% CI</th><th class="r">p</th></tr>
      ${coefRows}
      <tr><td colspan="4" style="color:var(--muted)">LR χ²₃ = ${coxA.lrStat.toFixed(1)} (p ${fmt.p(coxA.lrP)}) · C-index ${cIndex.toFixed(3)} · ${coxA.iterations} Newton steps · ${dropped} lost to follow-up</td></tr>
    </table>
    <div style="margin-top:8px;line-height:1.65;color:var(--text)">${verdict}</div>`);
}
