// Vaccine Lab, block 1: case studies 3 and 4.
//  3 · Sampling the study base — nested case–control vs case–cohort vs full cohort
//  4 · Reusing case–control data for a secondary outcome

import { makeCohort, fullCohortCox, nestedCaseControl, caseCohort, secondaryOutcomeStudy } from '../stats/sampling.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { COLORS, niceMax } from '../ui/chart.js';
import { $, fmt, html, defer } from '../ui/dom.js';
import { V, results, STUDIES, sliderHTML, bind, article, chartPanel, getChart, pct, forest, forestRatio } from './lab-ui.js';

const hrToVE = c => ({ est: 1 - c.or, lo: 1 - c.hi, hi: 1 - c.lo });
const nfmt = v => v.toFixed(2);

// ═════════════════════════ 3 · Sampling the study base ═════════════════════════

export function renderSampling() {
  const s = STUDIES.find(x => x.id === 'sampling');
  html('l-controls', `<div class="sec-head">Cohort</div>
    ${sliderHTML('l3s-ve', 'True vaccine efficacy (1 − HR)', 0.2, 0.9, 0.05, V.ve3)}
    ${sliderHTML('l3s-n', 'Cohort size', 2000, 20000, 1000, V.n3)}
    <div class="sec-head" style="margin-top:12px">Sampling designs</div>
    ${sliderHTML('l3s-m', 'Nested case–control: controls per case', 1, 8, 1, V.m3)}
    ${sliderHTML('l3s-a', 'Case–cohort: subcohort fraction', 0.05, 0.5, 0.05, V.alpha3)}
    <button class="btn btn-green" id="l3s-run">⟳ DRAW A NEW COHORT</button>
    <button class="btn" id="l3s-rep">⚄ REPEAT 50× (EMPIRICAL EFFICIENCY)</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>The valley's biobank holds a blood sample from every resident, taken at the start of the season. Vaccination records are unreliable, so vaccination has to be confirmed with an antibody assay, and every assay costs money. How few samples can we assay and still estimate the vaccine's hazard ratio well?</p></div>
      <div><h3>Design</h3><p>A cohort is followed for one year with time to infection as the outcome. The gold standard assays everyone and fits a Cox model. A <em>nested case–control</em> study assays each case plus <em>m</em> controls drawn from those still at risk at that case's infection time (risk-set sampling). A <em>case–cohort</em> study assays a random subcohort chosen at baseline plus all cases. Older residents vaccinate more and are at higher risk, so every analysis adjusts for age band.</p></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l3s-forest', 'Vaccine efficacy by design', '1 − hazard ratio, adjusted for age band · 95% CI · dashed = truth')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Interpretation</div></div><div id="l3s-interp" class="interp"></div></div>
    </div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Cost and precision</div><div class="panel-sub" id="l3s-table-sub"></div></div><div id="l3s-table" style="overflow-x:auto"></div></div>
    <div class="grid-2">
      ${chartPanel('l3s-front', 'Precision per assay', 'SE of log HR (vaccination) vs number of blood samples assayed, this cohort')}
      <div class="panel" id="l3s-rep-panel"><div class="panel-head"><div><div class="panel-title">Over 50 repeated cohorts</div><div class="panel-sub">empirical SD of log HR and relative efficiency vs the full cohort</div></div></div><div id="l3s-rep-out" class="dim" style="font-size:11px">Press REPEAT 50× to compare designs by their sampling variability.</div></div>
    </div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Full cohort</h4><div class="tex" data-tex="h(t\\mid x)=h_0(t)\\,e^{\\beta_1\\text{vax}+\\beta_2\\text{age}}" data-display="1"></div><p>Cox proportional hazards with Breslow partial likelihood. VE = 1 − HR.</p></div>
      <div><h4>Nested case–control</h4><div class="tex" data-tex="L(\\beta)=\\prod_{\\text{cases }i}\\frac{e^{x_i^\\top\\beta}}{\\sum_{j\\in\\tilde{\\mathcal R}_i}e^{x_j^\\top\\beta}}" data-display="1"></div><p>R̃ᵢ = the case plus its m sampled controls. Conditional logistic regression (a Cox model stratified by matched set) estimates the hazard ratio directly, with no rare-disease assumption. A control may later become a case.</p></div>
      <div><h4>Case–cohort</h4><div class="tex" data-tex="w_i=\\begin{cases}1/\\alpha & \\text{subcohort, before event}\\\\ 1 & \\text{case, at its event time}\\end{cases}" data-display="1"></div><p>Weighted Cox model on (start, stop] records with Barlow weights. The weighting breaks the usual information-matrix variance, so the robust (Lin–Wei sandwich) SE is required. The same subcohort serves as the comparison group for any outcome.</p></div>
    </div></details>`));
  results.s3seed ??= randomSeed();
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(run, 120); };
  bind('l3s-ve', 've3', v => pct(v), later);
  bind('l3s-n', 'n3', fmt.int, later);
  bind('l3s-m', 'm3', v => v + ' : 1', later);
  bind('l3s-a', 'alpha3', v => pct(v), later);
  $('#l3s-run').addEventListener('click', () => { results.s3seed = randomSeed(); run(); });
  $('#l3s-rep').addEventListener('click', repeatSampling);
  run();
}

async function run() {
  html('l3s-table-sub', 'fitting models…');
  const R = await defer(() => {
    const rng = makeRng(results.s3seed);
    const people = makeCohort({ n: V.n3, ve: V.ve3 }, rng);
    const full = fullCohortCox(people);
    const ncc = nestedCaseControl(people, V.m3, rng);
    const cc = caseCohort(people, V.alpha3, rng);
    // Frontier: precision vs number of assays across design settings (same cohort)
    const front = { ncc: [], cc: [] };
    for (const m of [1, 2, 4, 8]) { const r = nestedCaseControl(people, m, rng); front.ncc.push({ x: r.measured, se: r.fit.coefs[0].se, m }); }
    for (const a of [0.05, 0.15, 0.3, 0.5]) { const r = caseCohort(people, a, rng); front.cc.push({ x: r.measured, se: r.fit.coefs[0].se, a }); }
    return { people, full, ncc, cc, front, events: people.filter(p => p.event).length };
  });
  results.s3 = R;
  draw();
}

function draw() {
  const R = results.s3;
  const f = R.full.coefs[0], n = R.ncc.fit.coefs[0], c = R.cc.fit.coefs[0], cn = R.cc.fit.naive[0];
  forest(getChart('l3s-forest'), [
    { label: `Full cohort (Cox), n = ${fmt.int(V.n3)}`, ...hrToVE({ or: f.hr, lo: f.lo, hi: f.hi }), color: COLORS.R },
    { label: `Nested case–control 1:${V.m3}`, ...hrToVE(n), color: COLORS.obs },
    { label: `Case–cohort, ${pct(V.alpha3)} subcohort`, ...hrToVE(c), color: COLORS.guess },
  ], V.ve3);
  html('l3s-forest-cap', `${fmt.int(R.events)} infections during follow-up (${pct(R.events / V.n3, 1)} of the cohort).`);

  const re = se => (f.se / se) ** 2;
  const row = (name, assays, hr, lo, hi, se, extra = '') => `<tr><td>${name}</td><td class="r">${fmt.int(assays)}</td><td class="r">${pct(assays / V.n3)}</td><td class="r">${hr.toFixed(2)} <span class="dim">(${lo.toFixed(2)}–${hi.toFixed(2)})</span></td><td class="r">${se.toFixed(3)}${extra}</td><td class="r">${pct(re(se))}</td><td class="r">${(re(se) / (assays / V.n3)).toFixed(1)}×</td></tr>`;
  html('l3s-table-sub', `assays are blood samples tested for vaccine antibodies`);
  html('l3s-table', `<table class="res" style="min-width:560px"><tr><th>Design</th><th class="r">Assays</th><th class="r">of cohort</th><th class="r">HR (95% CI)</th><th class="r">SE log HR</th><th class="r">Rel. efficiency</th><th class="r">Efficiency per assay</th></tr>
    ${row('Full cohort', V.n3, f.hr, f.lo, f.hi, f.se)}
    ${row(`Nested case–control 1:${V.m3}`, R.ncc.measured, n.or, n.lo, n.hi, n.se)}
    ${row(`Case–cohort (robust SE)`, R.cc.measured, c.or, c.lo, c.hi, c.se, ` <span class="dim">· naive ${cn.se.toFixed(3)}</span>`)}
    </table><p class="dim" style="font-size:10.5px;margin-top:6px">Relative efficiency = Var(full cohort) / Var(design), from model-based SEs in this one cohort. Efficiency per assay divides it by the fraction of the cohort assayed: values above 1× mean the design extracts more information per sample than assaying everyone.</p>`);

  // Frontier chart
  const pts = [...R.front.ncc, ...R.front.cc, { x: V.n3, se: f.se }];
  getChart('l3s-front').render(cx => {
    cx.axes({ xMin: 0, xMax: niceMax(V.n3 * 1.02), yMin: 0, yMax: niceMax(Math.max(...pts.map(p => p.se)) * 1.1), xTicks: 5, yTicks: 4,
      xFmt: v => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : Math.round(v)), yFmt: v => v.toFixed(2), xLabel: 'blood samples assayed', yLabel: 'SE(log HR)' });
    cx.hline(f.se, { color: COLORS.R, dash: [3, 3], label: 'full cohort' });
    cx.line(R.front.ncc.map(p => p.x), R.front.ncc.map(p => p.se), { color: COLORS.obs, width: 2 });
    cx.marks(R.front.ncc.map(p => p.x), R.front.ncc.map(p => p.se), { shape: 'dot', color: COLORS.obs, size: 3 });
    cx.line(R.front.cc.map(p => p.x), R.front.cc.map(p => p.se), { color: COLORS.guess, width: 2 });
    cx.marks(R.front.cc.map(p => p.x), R.front.cc.map(p => p.se), { shape: 'dot', color: COLORS.guess, size: 3 });
    cx.marks([V.n3], [f.se], { shape: 'dot', color: COLORS.R, size: 4 });
  }, x => {
    const near = arr => arr.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    const a = near(R.front.ncc), b = near(R.front.cc);
    return [{ text: `NCC 1:${a.m}: ${fmt.int(a.x)} assays, SE ${a.se.toFixed(3)}`, color: COLORS.obs }, { text: `Case–cohort ${pct(b.a)}: ${fmt.int(b.x)} assays, SE ${b.se.toFixed(3)}`, color: COLORS.guess }];
  });
  html('l3s-front-cap', `<span style="color:${COLORS.obs}">■</span> nested case–control, m = 1–8 &nbsp; <span style="color:${COLORS.guess}">■</span> case–cohort, subcohort 5–50%. Precision flattens quickly: most of the information sits in the cases.`);

  const ve = x => pct(1 - x, 1);
  const parts = [
    `The full cohort estimates VE at <em>${ve(f.hr)}</em> from ${fmt.int(V.n3)} assays. The nested case–control study gets <em>${ve(n.or)}</em> from ${fmt.int(R.ncc.measured)} assays (${pct(R.ncc.measured / V.n3)} of the cohort), with ${pct(re(n.se))} of the full cohort's statistical efficiency.`,
    `Because controls are drawn from the <em>risk set</em> at each case's event time (incidence-density sampling), the conditional odds ratio estimates the hazard ratio directly. Unlike the cumulative sampling in case study 2, no rare-disease assumption is needed.`,
    `The case–cohort study gets <em>${ve(c.or)}</em> from ${fmt.int(R.cc.measured)} assays. Its naive SE (${cn.se.toFixed(3)}) ${cn.se < c.se ? 'understates' : 'differs from'} the robust SE (${c.se.toFixed(3)}), because Barlow weights inflate the apparent sample size. Its practical advantage is that one random subcohort can be reused as the comparison group for any future outcome, whereas nested case–control controls are tied to one outcome.`,
  ];
  html('l3s-interp', parts.map(p => `<p>${p}</p>`).join(''));
}

async function repeatSampling() {
  const btn = $('#l3s-rep'); btn.disabled = true; btn.textContent = '⚄ RUNNING 50 COHORTS…';
  const out = await defer(() => {
    const rng = makeRng(randomSeed());
    const b = { full: [], ncc: [], cc: [] }, assays = { ncc: 0, cc: 0 };
    for (let k = 0; k < 50; k++) {
      const people = makeCohort({ n: V.n3, ve: V.ve3 }, rng);
      b.full.push(fullCohortCox(people).coefs[0].beta);
      const n = nestedCaseControl(people, V.m3, rng); b.ncc.push(n.fit.coefs[0].beta); assays.ncc += n.measured / 50;
      const c = caseCohort(people, V.alpha3, rng); b.cc.push(c.fit.coefs[0].beta); assays.cc += c.measured / 50;
    }
    return { b, assays };
  });
  btn.disabled = false; btn.textContent = '⚄ REPEAT 50× (EMPIRICAL EFFICIENCY)';
  const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return { m, sd: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) }; };
  const truth = Math.log(1 - V.ve3);
  const F = sd(out.b.full);
  const row = (name, xs, assays) => { const r = sd(xs); return `<tr><td>${name}</td><td class="r">${fmt.int(assays)}</td><td class="r">${(r.m - truth >= 0 ? '+' : '') + (r.m - truth).toFixed(3)}</td><td class="r">${r.sd.toFixed(3)}</td><td class="r">${pct((F.sd / r.sd) ** 2)}</td></tr>`; };
  html('l3s-rep-out', `<table class="res"><tr><th>Design</th><th class="r">Mean assays</th><th class="r">Bias (log HR)</th><th class="r">Empirical SD</th><th class="r">Rel. efficiency</th></tr>
    ${row('Full cohort', out.b.full, V.n3)}${row(`Nested case–control 1:${V.m3}`, out.b.ncc, out.assays.ncc)}${row(`Case–cohort ${pct(V.alpha3)}`, out.b.cc, out.assays.cc)}</table>
    <p class="dim" style="font-size:10.5px;margin-top:6px">All three designs are unbiased for the hazard ratio. Rule of thumb for 1:m nested case–control: efficiency ≈ m/(m+1) of the full cohort.</p>`);
}

// ═════════════════════════ 4 · Reusing case–control data ═════════════════════════

export function renderReuse() {
  const s = STUDIES.find(x => x.id === 'reuse');
  html('l-controls', `<div class="sec-head">Population</div>
    ${sliderHTML('l4r-xy', 'True OR: vaccine → raised liver enzymes', 0.3, 3, 0.05, V.orXY, 'The secondary association we want to estimate')}
    ${sliderHTML('l4r-yd', 'OR: raised enzymes → hospitalisation', 1, 10, 0.5, V.orYD, 'Link between the secondary and the primary outcome')}
    ${sliderHTML('l4r-xd', 'OR: vaccine → hospitalisation', 0.1, 1, 0.05, V.orXD)}
    ${sliderHTML('l4r-pd', 'Hospitalisation prevalence', 0.005, 0.25, 0.005, V.pD, 'Primary outcome. Rare in classic case–control settings.')}
    ${sliderHTML('l4r-m', 'Controls per case (original study)', 1, 4, 1, V.m4)}
    <button class="btn btn-green" id="l4r-run">⟳ DRAW A NEW STUDY</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>A completed case–control study of hospitalised Amanita infection measured liver enzymes in every participant. A hepatologist now asks whether vaccination is associated with raised liver enzymes <em>in the general population</em>. Can the existing data answer that, without a new study?</p></div>
      <div><h3>Design</h3><p>The original sample was drawn on the <em>primary</em> outcome (hospitalisation), so cases are heavily over-represented. Four analyses of the <em>secondary</em> outcome are compared against the population truth: the whole sample, the whole sample adjusted for case status, controls only, and inverse-probability-weighted (IPW) logistic regression, which reweights each participant by the inverse of their probability of being sampled.</p></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l4r-forest', 'Odds ratio: vaccine → raised liver enzymes', '95% CI · dashed = population truth')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Interpretation</div></div><div id="l4r-interp" class="interp"></div></div>
    </div>
    <div class="panel"><div class="panel-head"><div class="panel-title">The sample vs the population</div></div><div id="l4r-table"></div></div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Why naive analysis fails</h4><p>Sampling depends on hospitalisation, which depends on both the exposure (vaccine) and the secondary outcome (enzymes). Selecting on a common effect induces an association between them. This is selection bias (collider bias). It vanishes only if the secondary outcome is unrelated to the primary outcome.</p></div>
      <div><h4>Inverse-probability weighting</h4><div class="tex" data-tex="w_i=\\frac{1}{P(\\text{sampled}\\mid D_i)}=\\begin{cases}1 & \\text{case}\\\\ N_{\\bar D}/n_{\\bar D} & \\text{control}\\end{cases}" data-display="1"></div><p>Weighted logistic regression of Y on X reconstructs the population association. Sandwich (robust) standard errors account for the weights.</p></div>
      <div><h4>Controls only</h4><p>Controls represent the non-diseased population, which is close to the whole population when the primary disease is rare. The approximation degrades as prevalence rises. Discarding the cases also wastes information.</p></div>
    </div></details>`));
  results.r4seed ??= randomSeed();
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(runReuse, 120); };
  bind('l4r-xy', 'orXY', nfmt, later);
  bind('l4r-yd', 'orYD', v => v.toFixed(1), later);
  bind('l4r-xd', 'orXD', nfmt, later);
  bind('l4r-pd', 'pD', v => pct(v, 1), later);
  bind('l4r-m', 'm4', v => v + ' : 1', later);
  $('#l4r-run').addEventListener('click', () => { results.r4seed = randomSeed(); runReuse(); });
  runReuse();
}

async function runReuse() {
  const R = await defer(() => secondaryOutcomeStudy({ N: 60000, orXY: V.orXY, orYD: V.orYD, orXD: V.orXD, pD: V.pD, controlsPerCase: V.m4 }, makeRng(results.r4seed)));
  const row = (label, c, color) => ({ label, est: c.or, lo: c.lo, hi: c.hi, color });
  forestRatio(getChart('l4r-forest'), [
    row('Population (truth)', R.truth, COLORS.truth),
    row('Whole sample, naive', R.naive, COLORS.I),
    row('Adjusted for case status', R.adjD, COLORS.D),
    row('Controls only', R.controls, COLORS.obs),
    row('IPW (robust SE)', R.ipw, COLORS.R),
  ], R.truth.or);
  html('l4r-forest-cap', 'The population row is computed from all 60,000 simulated residents, which a real analyst never sees.');
  html('l4r-table', `<table class="res"><tr><th></th><th class="r">Population</th><th class="r">Case–control sample</th></tr>
    <tr><td>Hospitalised (primary outcome)</td><td class="r">${pct(R.prevalence, 1)}</td><td class="r">${pct(R.nCases / (R.nCases + R.nControls), 0)}</td></tr>
    <tr><td>Raised enzymes among cases · controls</td><td class="r" colspan="2">${pct(R.pYcases, 0)} · ${pct(R.pYcontrols, 0)}</td></tr>
    <tr><td>Participants (cases + controls)</td><td class="r">60,000</td><td class="r">${fmt.int(R.nCases)} + ${fmt.int(R.nControls)}</td></tr>
    <tr><td>IPW weight for each control</td><td class="r" colspan="2">${((60000 - R.nCases) / R.nControls).toFixed(1)}</td></tr></table>`);
  const b = c => Math.abs(Math.log(c.or / R.truth.or));
  const parts = [
    `The population odds ratio is <em>${R.truth.or.toFixed(2)}</em>. Analysing the case–control sample as if it were a random sample gives <em>${R.naive.or.toFixed(2)}</em>${b(R.naive) > 0.1 ? ', which is biased' : ''}.`,
  ];
  if (V.orYD > 1.5) parts.push(`Raised enzymes increase the risk of hospitalisation, and the vaccine lowers it. Because cases make up ${pct(R.nCases / (R.nCases + R.nControls), 0)} of the sample instead of ${pct(R.prevalence, 1)}, selecting on hospitalisation distorts the vaccine–enzyme association.`);
  else parts.push('With almost no link between the secondary and primary outcomes, sampling on the primary outcome barely matters. Try raising the enzymes → hospitalisation odds ratio.');
  parts.push(`Controls only gives <em>${R.controls.or.toFixed(2)}</em>, ${V.pD <= 0.05 ? 'close to the truth because the primary disease is rare' : `drifting from the truth because ${pct(V.pD, 0)} prevalence is not rare`}. Adjusting for case status gives <em>${R.adjD.or.toFixed(2)}</em>: it estimates an association conditional on hospitalisation, which is not the population quantity.`);
  parts.push(`IPW gives <em>${R.ipw.or.toFixed(2)}</em> (95% CI ${R.ipw.lo.toFixed(2)}–${R.ipw.hi.toFixed(2)}). It uses every participant and is valid at any prevalence, provided the sampling fractions are known, which they are when the case–control study was nested in a defined cohort.`);
  html('l4r-interp', parts.map(p => `<p>${p}</p>`).join(''));
}
