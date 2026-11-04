// Shared state and layout helpers for the Vaccine Lab case studies.

import { Chart, COLORS } from '../ui/chart.js';
import { $$, renderTeX } from '../ui/dom.js';

export const charts = {};
export const results = {};
export const V = {
  // 1 · confounding
  ve1: 0.6, orAge: 2.5, orCaution: 3, n1: 20000,
  // 2 · case–control
  ve2: 0.6, attack: 1, m: 4, seekOR: 2.5, veOther: 0, n2: 40000, orAge2: 2,
  // 3 · sampling the study base
  ve3: 0.6, n3: 8000, m3: 4, alpha3: 0.15,
  // 4 · reusing case–control data
  orXY: 0.6, orYD: 5, orXD: 0.4, pD: 0.03, m4: 2,
  // 5 · randomisation & sample size
  nRand: 60, p0: 0.04, veExp: 0.6, power: 0.9,
  // 6 · trial conduct
  nArm6: 3000, refusal: 0.25, refusalOR: 4, ve6: 0.7, p06: 0.05, K: 5, veSeq: 0, nSeq: 3000,
  // 7 · Phase III
  nArm: 1000, scheme: 'stratified', trialStart: 28,
};

export const BLOCKS = [
  { id: 'obs', title: 'Observational designs', ref: '' },
  { id: 'rct', title: 'Randomised trials', ref: '' },
];

const ALL_STUDIES = [
  { id: 'confounding', block: 'obs', title: 'Confounding and the case for randomisation', short: 'Confounding vs randomisation', ref: '' },
  { id: 'casecontrol', block: 'obs', title: 'Case–control, logistic regression and test-negative designs', short: 'Case–control & test-negative', ref: '' },
  { id: 'sampling', advanced: true, block: 'obs', title: 'Sampling the study base: nested case–control and case–cohort', short: 'Nested case–control & case–cohort', ref: '' },
  { id: 'reuse', advanced: true, block: 'obs', title: 'Reusing case–control data for a secondary outcome', short: 'Reusing case–control data', ref: '' },
  { id: 'randomisation', block: 'rct', title: 'Randomisation schemes and sample size', short: 'Randomisation & sample size', ref: '' },
  { id: 'conduct', advanced: true, block: 'rct', title: 'Non-compliance and interim analyses', short: 'Non-compliance & interim looks', ref: '' },
  { id: 'phase3', block: 'rct', title: 'Phase III trial of the Amanita vaccine', short: 'Phase III trial', ref: '' },
];
/** Advanced case studies are implemented and tested but hidden until the basics are signed off. */
export const SHOW_ADVANCED = false;
export const STUDIES = ALL_STUDIES.filter(s => SHOW_ADVANCED || !s.advanced);
STUDIES.forEach((s, i) => { s.num = i + 1; });

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers

export function sliderHTML(id, label, min, max, step, value, hint = '') {
  return `<div class="param"><div class="param-top"><span>${label}</span><span class="param-val" id="${id}-val"></span></div>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">${hint ? `<div class="param-hint">${hint}</div>` : ''}</div>`;
}

export function bind(id, key, fmtFn, onChange, transform = v => v) {
  const el = document.getElementById(id), lab = document.getElementById(id + '-val');
  const show = () => { lab.textContent = fmtFn(transform(parseFloat(el.value))); };
  show();
  el.addEventListener('input', () => { V[key] = transform(parseFloat(el.value)); show(); onChange(); });
}

export function article(s, body) {
  const b = BLOCKS.find(x => x.id === s.block);
  return `<div class="study-head"><div class="eyebrow">CASE STUDY ${s.num} OF ${STUDIES.length} · ${b.title.toUpperCase()}</div><h2>${s.title}</h2>${s.ref ? `<div class="study-ref">${s.ref}</div>` : ''}</div>${body}`;
}

export function chartPanel(id, title, sub, cls = '') {
  return `<div class="panel"><div class="panel-head"><div><div class="panel-title">${title}</div><div class="panel-sub">${sub}</div></div></div>
    <div class="canvas-wrap ${cls}"><canvas id="${id}"></canvas></div><div class="panel-sub" id="${id}-cap" style="margin-top:4px"></div></div>`;
}

export function getChart(id, opts) {
  const el = document.getElementById(id);
  if (!charts[id] || charts[id].canvas !== el) charts[id] = new Chart(el, opts);
  return charts[id];
}

export function teX() { $$('#l-article [data-tex]').forEach(el => renderTeX(el, el.dataset.tex, el.dataset.display === '1')); }

export const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
export const veStr = m => `${pct(m.est, 1)} <span class="dim">(${pct(m.lo, 1)} to ${pct(m.hi, 1)})</span>`;

/** Forest plot of VE estimates on a linear % scale. rows: [{label, est, lo, hi, color}] */
export function forest(chart, rows, truth, opts = {}) {
  const rawLo = Math.min(opts.min ?? 0, ...rows.map(r => r.lo)) - 0.02;
  const rawHi = Math.max(opts.max ?? 1, ...rows.map(r => r.hi)) + 0.01;
  chart.render(c => {
    // Axis on whole steps of 10% (or 20% when wide or narrow), clamped to [−100%, 100%]
    const step = (rawHi - rawLo > 0.8 || c.W < 560) ? 0.2 : 0.1;
    const lo = Math.max(-1, Math.floor(rawLo / step - 1e-9) * step), hi = Math.min(1, Math.ceil(rawHi / step - 1e-9) * step);
    const ticks = Math.round((hi - lo) / step);
    c.ctx.font = '12.5px "IBM Plex Mono", ui-monospace, monospace';
    const labelW = Math.max(...rows.map(r => c.ctx.measureText(r.label).width)) + 18;
    c.axes({ pad: { left: Math.min(labelW, c.W * 0.5), right: 16 }, xMin: lo, xMax: hi, yMin: 0, yMax: rows.length + 1, xTicks: ticks, yTicks: 1,
      xFmt: v => Math.round(v * 100) + '%', yFmt: () => '', xLabel: 'vaccine efficacy (1 − ratio)' });
    if (truth !== null && truth !== undefined) c.vline(truth, { color: COLORS.truth, dash: [3, 3], label: `true VE ${pct(truth)}`, labelY: 10 });
    c.vline(0, { color: 'rgba(185,160,115,0.3)', dash: [] });
    rows.forEach((r, i) => {
      const y = rows.length - i;
      c.line([r.lo, r.hi], [y, y], { color: r.color, width: 2 });
      c.marks([r.est], [y], { shape: 'dot', color: r.color, size: 4.5 });
      c.text(r.label, c.pad.left - 10, c.Y(y) + 3, { px: true, align: 'right', color: COLORS.text });
    });
  }, x => [{ text: `VE ${pct(x, 1)}` }]);
}

export function signed(x) { const v = x * 100; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1); }

/** Forest plot of odds or hazard ratios on a log scale. */
export function forestRatio(chart, rows, truth, label = 'odds ratio (log scale)') {
  const lo = Math.min(...rows.map(r => r.lo), truth ?? Infinity) / 1.15, hi = Math.max(...rows.map(r => r.hi), truth ?? 0) * 1.15;
  chart.render(c => {
    c.ctx.font = '12.5px "IBM Plex Mono", ui-monospace, monospace';
    const labelW = Math.max(...rows.map(r => c.ctx.measureText(r.label).width)) + 18;
    c.axes({ pad: { left: Math.min(labelW, c.W * 0.5), right: 16 }, xMin: lo, xMax: hi, logX: true, yMin: 0, yMax: rows.length + 1, xTicks: 4, yTicks: 1,
      xFmt: v => v.toFixed(v < 1 ? 2 : 1), yFmt: () => '', xLabel: label });
    c.vline(1, { color: 'rgba(185,160,115,0.3)', dash: [] });
    if (truth !== null && truth !== undefined) c.vline(truth, { color: COLORS.truth, dash: [3, 3], label: `truth ${truth.toFixed(2)}`, labelY: 10 });
    rows.forEach((r, i) => {
      const y = rows.length - i;
      c.line([r.lo, r.hi], [y, y], { color: r.color, width: 2 });
      c.marks([r.est], [y], { shape: 'dot', color: r.color, size: 4.5 });
      c.text(r.label, c.pad.left - 10, c.Y(y) + 3, { px: true, align: 'right', color: COLORS.text });
    });
  }, x => [{ text: x.toFixed(2) }]);
}
