// Mode V — Vaccine Lab: applied study design, presented as case studies in two blocks
// (observational designs; randomised trials). This file holds the shell and case studies
// 1, 2, 5 and 7; lab-observational.js and lab-trials.js hold the others.

import { runConfoundingStudy, runCaseControlStudy, randomise, balance, makePopulation, infectionRisk,
  table2x2, riskRatio, toVE, chiSquare2x2, mantelHaenszelRR, orFromRisks, expectedLogOrSE,
  sampleSizeTwoProportions, powerTwoProportions, sampleSizeVELowerBound, powerVELowerBound, AGE_GROUPS,
  simulatePhase3, phase3Truth, PHASE3, trialEpidemic, TRIAL_TIMELINE } from '../stats/design.js';
import { logistic } from '../stats/regression.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { quantile } from '../stats/dist.js';
import { COLORS, alpha, niceMax } from '../ui/chart.js';
import { $, $$, fmt, html, defer } from '../ui/dom.js';
import { state, update } from '../state.js';
import { V, results, BLOCKS, STUDIES, sliderHTML, bind, article, chartPanel, getChart, teX, pct, veStr, forest, signed } from './lab-ui.js';
import { renderSampling, renderReuse } from './lab-observational.js';
import { renderConduct } from './lab-trials.js';

let toast;
let current = 'confounding';
let hidden = null; // Phase III truth

export function initLab(ctx) {
  toast = ctx.toast;
  html('l-nav', BLOCKS.map(b => `<div class="study-block">${b.title}${b.ref ? `<span>${b.ref}</span>` : ''}</div>` +
    STUDIES.filter(s => s.block === b.id).map(s => `<button class="study-link${s.id === current ? ' on' : ''}" data-study="${s.id}"><span class="num">${s.num}</span><span>${s.short}</span></button>`).join('')).join(''));
  $$('#l-nav [data-study]').forEach(b => b.addEventListener('click', () => { current = b.dataset.study; render(); window.scrollTo({ top: 0 }); }));
}

export function enterLab(banner) {
  banner(`<em>SPORELAB · VACCINE PROGRAMME.</em> The Sporeford lab has a candidate vaccine. Before it reaches the villages, its efficacy has to be estimated, and the study design determines whether that estimate can be trusted. ` +
    `${STUDIES.length} applied case studies in two blocks: observational designs and randomised trials. <em>A licensed vaccine from the Phase III case study reaches Outbreak Response earlier, with the efficacy your trial measured.</em>`);
  render();
}

// ─────────────────────────────────────────────────────────────────────────────

function render() {
  $$('#l-nav [data-study]').forEach(b => b.classList.toggle('on', b.dataset.study === current));
  ({ confounding: renderConfounding, casecontrol: renderCaseControl, sampling: renderSampling, reuse: renderReuse,
    randomisation: renderRandomisation, conduct: renderConduct, phase3: renderPhase3 })[current](toast);
  teX();
}

// ═════════════════════════ Study 1 · Confounding ═════════════════════════

function renderConfounding() {
  const s = STUDIES.find(x => x.id === 'confounding');
  html('l-controls', `<div class="sec-head">Scenario</div>
    ${sliderHTML('l1-ve', 'True vaccine efficacy', 0, 0.95, 0.05, V.ve1)}
    ${sliderHTML('l1-age', 'Uptake odds ratio per age band', 0.25, 4, 0.05, V.orAge, '&gt; 1: older residents vaccinate more (they are also at higher risk)')}
    ${sliderHTML('l1-caution', 'Uptake odds ratio, cautious vs not', 0.25, 6, 0.05, V.orCaution, '&gt; 1: cautious residents vaccinate more (they are also less exposed). Caution is not recorded in clinic data.')}
    ${sliderHTML('l1-n', 'Residents in the records', 2000, 60000, 1000, V.n1)}
    <button class="btn btn-green" id="l1-run">⟳ DRAW A NEW SAMPLE</button>
    <button class="btn" id="l1-rep">⚄ REPEAT THE STUDY 100×</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>Early batches of the vaccine were offered at the Sporeford clinic and residents chose whether to take one. Can the clinic's records alone tell us how well the vaccine works?</p></div>
      <div><h3>Design</h3><p>The same synthetic population is studied twice. In the <em>observational cohort</em>, residents self-select into vaccination. In the <em>randomised trial</em>, a coin decides. The outcome is symptomatic infection over one season. Age band and caution both affect infection risk and the decision to vaccinate, so they are confounders.</p></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l1-forest', 'Estimated efficacy by analysis', 'point estimate with 95% CI · dashed = truth')}
      ${chartPanel('l1-uptake', 'Who gets vaccinated?', 'observational cohort · vaccine uptake by subgroup')}
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><div class="panel-title">Stratified analysis by age band</div><div class="panel-sub">observational cohort</div></div><div id="l1-strata"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Interpretation</div></div><div id="l1-interp" class="interp"></div></div>
    </div>
    <div class="panel" id="l1-rep-panel" hidden>
      <div class="panel-head"><div><div class="panel-title">Sampling distribution over 100 repeated studies</div><div class="panel-sub">each dot is one study · bias is systematic and does not shrink with sample size, unlike variance</div></div></div>
      <div class="canvas-wrap"><canvas id="l1-rep-chart"></canvas></div><div id="l1-rep-table" style="margin-top:6px"></div>
    </div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Effect measure</h4><div class="tex" data-tex="\\text{VE}=1-\\text{RR},\\quad \\text{RR}=\\frac{a/(a+b)}{c/(c+d)}" data-display="1"></div><p>95% CI from the log-RR Wald interval, transformed to the VE scale.</p></div>
      <div><h4>Mantel–Haenszel stratified RR</h4><div class="tex" data-tex="\\widehat{\\text{RR}}_{MH}=\\frac{\\sum_k a_k n_{0k}/N_k}{\\sum_k c_k n_{1k}/N_k}" data-display="1"></div><p>Weighted average of stratum-specific RRs, with the Greenland–Robins variance.</p></div>
      <div><h4>Data-generating model</h4><p>Season risk 6% / 10% / 18% by age band; cautious residents have 40% of the exposure. Uptake: logit P(vax) = logit 0.4 + log(OR<sub>age</sub>)·(band−1) + log(OR<sub>caution</sub>)·(caution−0.4).</p></div>
    </div></details>`));
  const rerun = () => { results.c1 = runConfoundingStudy({ n: V.n1, ve: V.ve1, orAge: V.orAge, orCaution: V.orCaution }, makeRng(results.c1seed)); drawConfounding(); };
  results.c1seed ??= randomSeed();
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(() => { $('#l1-rep-panel').hidden = true; rerun(); }, 60); };
  bind('l1-ve', 've1', v => pct(v), later);
  bind('l1-age', 'orAge', v => v.toFixed(2), later);
  bind('l1-caution', 'orCaution', v => v.toFixed(2), later);
  bind('l1-n', 'n1', fmt.int, later);
  $('#l1-run').addEventListener('click', () => { results.c1seed = randomSeed(); rerun(); });
  $('#l1-rep').addEventListener('click', replicateConfounding);
  rerun();
}

function drawConfounding() {
  const r = results.c1;
  const rows = [
    { label: 'Crude (observational)', ...toVE(r.est.crude), color: COLORS.I },
    { label: 'Adjusted for age (MH)', ...toVE(r.est.ageAdj), color: COLORS.obs },
    { label: 'Age + caution (MH)*', ...toVE(r.est.fullAdj), color: COLORS.guess },
    { label: 'Randomised trial', ...toVE(r.est.rct), color: COLORS.R },
  ];
  forest(getChart('l1-forest'), rows, V.ve1);
  html('l1-forest-cap', '* only possible in a simulation: caution is unmeasured in real clinic records');

  const up = getChart('l1-uptake');
  const labels = [...AGE_GROUPS, 'not cautious', 'cautious'];
  const vals = [...r.uptake.byAge, ...r.uptake.byCaution];
  up.render(c => {
    c.axes({ xMin: -0.5, xMax: labels.length - 0.5, yMin: 0, yMax: 1, xTicks: 1, yTicks: 4, yFmt: v => Math.round(v * 100) + '%', xFmt: () => '' });
    c.bars([0, 1, 2], vals.slice(0, 3), { color: COLORS.obs, widthFrac: 0.6 });
    c.bars([3, 4], vals.slice(3), { color: COLORS.guess, widthFrac: 0.6 });
    labels.forEach((l, i) => c.text(l, c.X(i), c.pad.top + c.ph + 14, { px: true, align: 'center', color: COLORS.muted }));
    vals.forEach((v, i) => c.text(pct(v), c.X(i), c.Y(v) - 5, { px: true, align: 'center', color: COLORS.text }));
  });
  html('l1-uptake-cap', 'Infection risk rises with age band and is lower for cautious residents.');

  const rowsHTML = r.ageStrata.map((t, i) => {
    const rr = riskRatio(t);
    return `<tr><td>${AGE_GROUPS[i]}</td><td class="r">${t.a}/${t.a + t.b} <span class="dim">(${pct(rr.r1, 1)})</span></td><td class="r">${t.c}/${t.c + t.d} <span class="dim">(${pct(rr.r0, 1)})</span></td><td class="r">${pct(1 - rr.est, 0)}</td></tr>`;
  }).join('');
  const cr = r.est.crude;
  html('l1-strata', `<table class="res"><tr><th>Age band</th><th class="r">Vaccinated: cases/n</th><th class="r">Unvaccinated: cases/n</th><th class="r">VE</th></tr>${rowsHTML}
    <tr><td style="color:var(--bright)">All (crude)</td><td class="r">${r.crude.a}/${r.crude.a + r.crude.b} <span class="dim">(${pct(cr.r1, 1)})</span></td><td class="r">${r.crude.c}/${r.crude.c + r.crude.d} <span class="dim">(${pct(cr.r0, 1)})</span></td><td class="r">${pct(1 - cr.est, 0)}</td></tr></table>
    <p class="dim" style="margin-top:6px;font-size:13px">Mantel–Haenszel age-adjusted VE ${veStr(toVE(r.est.ageAdj))}</p>`);

  const crude = 1 - r.est.crude.est, age = 1 - r.est.ageAdj.est, full = 1 - r.est.fullAdj.est, rct = 1 - r.est.rct.est;
  const ageBias = crude - age, cautBias = age - full;
  const parts = [];
  parts.push(`The crude observational estimate is <em>${pct(crude, 1)}</em> against a true efficacy of <em>${pct(V.ve1)}</em>, a bias of ${signed(crude - V.ve1)} percentage points.`);
  const noise = 1.5 * r.est.ageAdj.se; // shifts smaller than this are indistinguishable from sampling error
  const expectAge = Math.sign(1 - V.orAge), expectCaut = Math.sign(V.orCaution - 1);
  if (Math.abs(V.orAge - 1) < 0.05) parts.push('Age band does not affect uptake here, so it is not a confounder: stratifying by it changes little.');
  else if (Math.abs(ageBias) < noise * Math.abs(1 - crude) || Math.sign(-ageBias) !== -expectAge) parts.push(`Age should confound here, but in this sample the age adjustment moves the estimate by only ${signed(-ageBias)} points, within sampling noise. Repeat the study to see the average effect.`);
  else parts.push(V.orAge > 1
    ? `Older, higher-risk residents vaccinate more often, which makes the vaccinated group look sicker and pulls the crude VE <em>down</em> (confounding by indication). Stratifying by age band moves the estimate by ${signed(-ageBias)} points.`
    : `Younger, lower-risk residents vaccinate more often, which flatters the vaccine. Stratifying by age band moves the estimate by ${signed(-ageBias)} points.`);
  if (Math.abs(V.orCaution - 1) < 0.05) parts.push('Caution does not affect uptake here, so it is not a confounder.');
  else if (Math.sign(cautBias) !== expectCaut) parts.push(`Caution should confound here, but in this sample its effect (${signed(cautBias)} points) is within sampling noise.`);
  else parts.push(V.orCaution > 1
    ? `Cautious residents both vaccinate more and are exposed less. This <em>healthy-vaccinee effect</em> inflates VE by about ${signed(cautBias)} points. Caution is not in the records, so no adjustment of the real data can remove it. That is <em>residual confounding</em>.`
    : `Cautious residents vaccinate less, which hides part of the vaccine's benefit (${signed(cautBias)} points).`);
  parts.push(`The randomised trial estimates <em>${pct(rct, 1)}</em>. Randomisation balances measured and unmeasured confounders alike, so its only error is sampling error, which shows up in the width of the CI.`);
  html('l1-interp', parts.map(p => `<p>${p}</p>`).join(''));
}


async function replicateConfounding() {
  const btn = $('#l1-rep'); btn.disabled = true; btn.textContent = '⚄ RUNNING 100 STUDIES…';
  const reps = await defer(() => {
    const rng = makeRng(randomSeed());
    const out = { crude: [], ageAdj: [], fullAdj: [], rct: [] };
    for (let i = 0; i < 100; i++) {
      const r = runConfoundingStudy({ n: V.n1, ve: V.ve1, orAge: V.orAge, orCaution: V.orCaution }, rng);
      for (const k of Object.keys(out)) out[k].push(1 - r.est[k].est);
    }
    return out;
  });
  btn.disabled = false; btn.textContent = '⚄ REPEAT THE STUDY 100×';
  $('#l1-rep-panel').hidden = false;
  const keys = [['crude', 'Crude (observational)', COLORS.I], ['ageAdj', 'Adjusted for age', COLORS.obs], ['fullAdj', 'Age + caution*', COLORS.guess], ['rct', 'Randomised trial', COLORS.R]];
  const all = Object.values(reps).flat();
  const ch = getChart('l1-rep-chart');
  const jitter = makeRng(7);
  ch.render(c => {
    c.axes({ pad: { left: 190 }, xMin: Math.min(...all, V.ve1) - 0.05, xMax: Math.max(...all, V.ve1) + 0.05, yMin: 0, yMax: 5, yTicks: 1, xTicks: 5, xFmt: v => Math.round(v * 100) + '%', yFmt: () => '', xLabel: 'estimated VE' });
    c.vline(V.ve1, { color: COLORS.truth, dash: [3, 3], label: 'truth' });
    keys.forEach(([k, label, col], i) => {
      const y = 4 - i;
      c.marks(reps[k], reps[k].map(() => y + (jitter.uniform() - 0.5) * 0.45), { shape: 'dot', color: alpha(col, 0.55), size: 2.2 });
      const m = reps[k].reduce((a, b) => a + b, 0) / reps[k].length;
      c.line([m, m], [y - 0.32, y + 0.32], { color: col, width: 2.5 });
      c.text(label, c.pad.left - 10, c.Y(y) + 3, { px: true, align: 'right' });
    });
  });
  const row = ([k, label]) => {
    const xs = reps[k], m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
    const rmse = Math.sqrt(xs.reduce((s, x) => s + (x - V.ve1) ** 2, 0) / xs.length);
    return `<tr><td>${label}</td><td class="r">${signed(m - V.ve1)} pts</td><td class="r">${(sd * 100).toFixed(1)} pts</td><td class="r">${(rmse * 100).toFixed(1)} pts</td></tr>`;
  };
  html('l1-rep-table', `<table class="res"><tr><th>Analysis</th><th class="r">Bias</th><th class="r">SD</th><th class="r">RMSE</th></tr>${keys.map(row).join('')}</table>`);
}

// ═════════════════════════ Study 2 · Case–control & test-negative ═════════════════════════

function renderCaseControl() {
  const s = STUDIES.find(x => x.id === 'casecontrol');
  html('l-controls', `<div class="sec-head">Scenario</div>
    ${sliderHTML('l2-ve', 'True vaccine efficacy', 0.1, 0.95, 0.05, V.ve2)}
    ${sliderHTML('l2-attack', 'Season attack rate (× baseline)', 0.1, 4, 0.1, V.attack, 'baseline: 6–18% by age band in the unvaccinated')}
    ${sliderHTML('l2-m', 'Controls per case', 1, 10, 1, V.m)}
    ${sliderHTML('l2-age', 'Uptake odds ratio per age band', 0.5, 4, 0.1, V.orAge2, '&gt; 1: older, higher-risk residents vaccinate more (a measured confounder)')}
    ${sliderHTML('l2-seek', 'Health-seekers: uptake odds ratio', 1, 6, 0.1, V.seekOR, 'People who seek care readily are also more likely to vaccinate, and to get tested when ill')}
    ${sliderHTML('l2-veo', 'Vaccine effect on other illnesses', 0, 0.6, 0.05, V.veOther, 'Should be 0. A non-zero value breaks the test-negative assumption.')}
    <button class="btn btn-green" id="l2-run">⟳ DRAW A NEW SAMPLE</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>Following 40,000 residents for a whole season is expensive. Can we estimate vaccine efficacy by sampling only some of them, and what happens when we rely on cases that happen to be tested at a clinic?</p></div>
      <div><h3>Design</h3><p>A full cohort is simulated as a benchmark. From it, a <em>case–control study</em> samples all cases plus <em>m</em> controls per case from non-cases, and adjusts for age band with <em>logistic regression</em>. A <em>test-negative design</em> uses everyone tested for a febrile illness: those positive for Amanita are cases and those negative (another "valley fever") are controls. </p></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l2-forest', 'Estimated efficacy by design', 'point estimate with 95% CI · dashed = truth')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Interpretation</div></div><div id="l2-interp" class="interp"></div></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l2-rare', 'The rare-disease assumption', 'VE from an odds ratio vs the true VE, as the outcome becomes common', 'short')}
      ${chartPanel('l2-eff', 'Statistical efficiency of extra controls', 'expected 95% CI width of VE vs controls per case', 'short')}
    </div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Odds ratio and Woolf CI</h4><div class="tex" data-tex="\\widehat{\\text{OR}}=\\frac{ad}{bc},\\quad \\text{SE}(\\log\\widehat{\\text{OR}})=\\sqrt{\\tfrac1a+\\tfrac1b+\\tfrac1c+\\tfrac1d}" data-display="1"></div><p>VE = 1 − OR. With controls sampled from non-cases at the end of follow-up (cumulative sampling), OR ≈ RR only when the outcome is rare.</p></div>
      <div><h4>Logistic regression in a case–control sample</h4><div class="tex" data-tex="\\operatorname{logit}P(\\text{case}\\mid x)=\\alpha^*+\\beta\\,\\text{vax}+\\gamma_1[40\\text{–}64]+\\gamma_2[65+]" data-display="1"></div><p>Sampling on case status only shifts the intercept (α* = α + log of the sampling-fraction ratio), so e<sup>β</sup> is a valid adjusted odds ratio. Fitted by IRLS.</p></div>
      <div><h4>Why OR drifts from RR</h4><div class="tex" data-tex="\\text{OR}=\\text{RR}\\cdot\\frac{1-r_0}{1-r_1}" data-display="1"></div><p>With a protective vaccine (r₁ &lt; r₀) the OR is further from 1 than the RR, so VE from the OR overstates efficacy when attack rates are high.</p></div>
      <div><h4>Test-negative design</h4><div class="tex" data-tex="\\text{VE}_{TND}=1-\\frac{\\text{odds}(\\text{vax}\\mid\\text{test}+)}{\\text{odds}(\\text{vax}\\mid\\text{test}-)}" data-display="1"></div><p>Health-care seeking affects who is tested equally for cases and controls, so it cancels. Valid if the vaccine does not change the risk of the control illness.</p></div>
    </div></details>`));
  results.c2seed ??= randomSeed();
  const rerun = () => { results.c2 = runCaseControlStudy({ n: V.n2, ve: V.ve2, attackScale: V.attack, controlsPerCase: V.m, seekOR: V.seekOR, veOther: V.veOther, otherIllness: 0.15, orAge: V.orAge2 }, makeRng(results.c2seed)); drawCaseControl(); };
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(rerun, 60); };
  bind('l2-ve', 've2', v => pct(v), later);
  bind('l2-attack', 'attack', v => '× ' + v.toFixed(1), later);
  bind('l2-m', 'm', v => v + ' : 1', later);
  bind('l2-age', 'orAge2', v => v.toFixed(1), later);
  bind('l2-seek', 'seekOR', v => v.toFixed(1), later);
  bind('l2-veo', 'veOther', v => pct(v), later);
  $('#l2-run').addEventListener('click', () => { results.c2seed = randomSeed(); rerun(); });
  rerun();
}

function drawCaseControl() {
  const r = results.c2;
  const adj = rows => {
    const c = logistic(rows.map(x => [x.vax, x.ag === 1 ? 1 : 0, x.ag === 2 ? 1 : 0]), rows.map(x => (x.case ? 1 : 0))).coefs[1];
    return { est: c.or, lo: c.lo, hi: c.hi };
  };
  r.est.cohortAdj = mantelHaenszelRR([0, 1, 2].map(ag => table2x2(r.rows.filter(x => x.ag === ag))));
  // Clinic-confirmed cohort, also age-adjusted, so its remaining bias is detection bias alone.
  r.est.survAdj = mantelHaenszelRR([0, 1, 2].map(ag => table2x2(r.rows.filter(x => x.ag === ag).map(x => ({ vax: x.vax, case: x.case && x.tested })))));
  r.est.ccAdj = adj(r.ccRows);
  r.est.tndAdj = adj(r.testedRows);
  const rows = [
    { label: 'Full cohort, age-adj. (MH RR)', ...toVE(r.est.cohortAdj), color: COLORS.R },
    { label: 'Clinic-confirmed, age-adj. (MH)', ...toVE(r.est.survAdj), color: COLORS.I },
    { label: `Case–control 1:${V.m}, crude OR`, ...toVE(r.est.cc), color: alpha(COLORS.obs, 0.55) },
    { label: `Case–control, age-adj. (logistic)`, ...toVE(r.est.ccAdj), color: COLORS.obs },
    { label: 'Test-negative, age-adj. (logistic)', ...toVE(r.est.tndAdj), color: COLORS.guess },
  ];
  forest(getChart('l2-forest'), rows, V.ve2);
  html('l2-forest-cap', `${fmt.int(V.n2)} residents · ${fmt.int(r.nCases)} infections · ${fmt.int(r.nControls)} sampled controls · ${fmt.int(r.nTested)} tested · attack rate ${pct(r.attack.unvax, 1)} unvaccinated vs ${pct(r.attack.vax, 1)} vaccinated`);

  // Rare-disease curve: VE implied by the OR vs true VE across attack rates
  const xs = [], ys = [];
  for (let r0 = 0.005; r0 <= 0.7; r0 += 0.005) { xs.push(r0); ys.push(1 - orFromRisks(r0 * (1 - V.ve2), r0)); }
  const cur = r.attack.unvax;
  getChart('l2-rare').render(c => {
    c.axes({ xMin: 0, xMax: 0.7, yMin: Math.max(0, V.ve2 - 0.1), yMax: Math.min(1, Math.max(...ys) + 0.05), xFmt: v => Math.round(v * 100) + '%', yFmt: v => Math.round(v * 100) + '%', xTicks: 7, yTicks: 4, xLabel: 'attack rate in unvaccinated' });
    c.hline(V.ve2, { color: COLORS.truth, dash: [3, 3], label: 'true VE (1 − RR)' });
    c.line(xs, ys, { color: COLORS.obs, width: 2 });
    c.vline(cur, { color: alpha(COLORS.I, 0.6), label: 'this season', labelY: 12 });
  }, x => [{ text: `attack rate ${pct(x, 1)}` }, { text: `VE from OR ${pct(1 - orFromRisks(x * (1 - V.ve2), x), 1)}`, color: COLORS.obs }]);
  html('l2-rare-cap', 'Below ~10% the two agree closely. Incidence-density sampling of controls would estimate the rate ratio directly.');

  // Efficiency of controls per case
  const pc = r.cc.a / Math.max(1, r.cc.a + r.cc.c);
  const pk = r.cc.b / Math.max(1, r.cc.b + r.cc.d);
  const ms = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const orEst = r.est.cc.est;
  const width = m => { const se = expectedLogOrSE(r.nCases, m, pc, pk); return orEst * (Math.exp(1.96 * se) - Math.exp(-1.96 * se)); };
  const ws = ms.map(width);
  const wInf = orEst * 2 * Math.sinh(1.96 * Math.sqrt(1 / (r.nCases * pc) + 1 / (r.nCases * (1 - pc))));
  getChart('l2-eff').render(c => {
    c.axes({ xMin: 1, xMax: 10, yMin: 0, yMax: niceMax(ws[0] * 1.1), xTicks: 9, yTicks: 4, xFmt: v => Math.round(v) + ':1', yFmt: v => (v * 100).toFixed(0) + ' pts' });
    c.hline(wInf, { color: COLORS.muted, dash: [2, 3], label: 'limit with ∞ controls' });
    c.line(ms, ws, { color: COLORS.guess, width: 2 });
    c.marks(ms, ws, { shape: 'dot', color: COLORS.guess, size: 2.5 });
    c.marks([V.m], [width(V.m)], { shape: 'dot', color: COLORS.obs, size: 5 });
  }, x => { const m = Math.round(x); return [{ text: `${m} controls per case` }, { text: `CI width ≈ ${(width(m) * 100).toFixed(1)} pts`, color: COLORS.guess }]; });
  html('l2-eff-cap', `Going from 1 to 4 controls per case narrows the CI by ${((1 - ws[3] / ws[0]) * 100).toFixed(0)}%. Beyond 4:1 the gains are small, which is the classic rule of thumb.`);

  const ve = k => 1 - r.est[k].est;
  const parts = [];
  parts.push(`With ${fmt.int(r.nCases)} cases and ${V.m} controls each, the case–control study needs data on about <em>${fmt.int(r.nCases + r.nControls)}</em> people instead of ${fmt.int(V.n2)}. After adjusting for age band it estimates VE at <em>${pct(ve('ccAdj'), 1)}</em> (full cohort, age-adjusted: ${pct(ve('cohortAdj'), 1)}).`);
  if (Math.abs(ve('cc') - ve('ccAdj')) > 0.02) parts.push(`The crude case–control estimate is ${pct(ve('cc'), 1)}. Older residents are both more often vaccinated and more often infected, so age confounds the crude OR. Logistic regression removes it because age band was measured. Sampling on case status does not invalidate the adjusted OR, only the intercept.`);
  if (cur > 0.12) parts.push(`This season's attack rate (${pct(cur, 0)}) is high, so the OR no longer approximates the RR and the case–control estimate overstates efficacy.`);
  if (V.seekOR > 1.2) parts.push(`Counting only clinic-confirmed cases gives <em>${pct(ve('survAdj'), 1)}</em>, even after adjusting for age. Vaccinated residents are more often health-seekers and so more often tested, which makes them appear to have <em>more</em> disease. This is <em>detection bias</em>.`);
  parts.push(V.veOther > 0.02
    ? `The test-negative estimate (<em>${pct(ve('tndAdj'), 1)}</em>) is biased downward here. Because the vaccine also prevents some "valley fever", vaccinated people are under-represented among test-negative controls. This breaks the design's key assumption.`
    : `The age-adjusted test-negative design estimates <em>${pct(ve('tndAdj'), 1)}</em>. Health-seeking drives testing equally in cases and controls, so the bias cancels out of the odds ratio. `);
  html('l2-interp', parts.map(p => `<p>${p}</p>`).join(''));
}

// ═════════════════════════ Study 3 · Randomisation & sample size ═════════════════════════

function renderRandomisation() {
  const s = STUDIES.find(x => x.id === 'randomisation');
  html('l-controls', `<div class="sec-head">Randomisation</div>
    ${sliderHTML('l3-n', 'Participants in a small trial', 12, 200, 2, V.nRand)}
    <button class="btn" id="l3-sim">⚄ SIMULATE 2,000 ALLOCATIONS</button>
    <div class="sec-head" style="margin-top:14px">Sample size assumptions</div>
    ${sliderHTML('l3-p0', 'Attack rate in placebo arm', 0.005, 0.15, 0.005, V.p0)}
    ${sliderHTML('l3-ve', 'Expected vaccine efficacy', 0.3, 0.95, 0.05, V.veExp)}
    ${sliderHTML('l3-pow', 'Target power', 0.7, 0.95, 0.05, V.power)}`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>Randomisation removes confounding on average. In a single trial, how well do different schemes keep the arms comparable? And how many participants does the Phase III trial need?</p></div>
      <div><h3>Design</h3><p>Three allocation schemes are compared on the same stream of participants: <em>simple</em> (a fair coin each time), <em>permuted blocks</em> of 4, and <em>stratified permuted blocks</em> within age band. Balance is measured by the difference in arm sizes and in the share of residents aged 65+, who carry most of the risk.</p></div>
    </div>
    ${chartPanel('l3-strip', 'One realisation of each scheme', 'first participants in order of enrolment · coloured = vaccine arm, grey = placebo · ▲ = aged 65+', 'short')}
    <div class="grid-2">
      ${chartPanel('l3-hist', 'Imbalance in the 65+ share across 2,000 trials', 'share of trials whose 65+ gap exceeds x · lower and further left is better')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Balance summary</div><div class="panel-sub" id="l3-bal-sub"></div></div><div id="l3-bal"></div></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l3-power', 'Power vs participants per arm', 'two success criteria · dots = your target power')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Required sample size</div></div><div id="l3-ss"></div></div>
    </div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Two proportions (VE &gt; 0)</h4><div class="tex" data-tex="n=\\frac{\\left(z_{1-\\alpha/2}\\sqrt{2\\bar p\\bar q}+z_{1-\\beta}\\sqrt{p_0q_0+p_1q_1}\\right)^2}{(p_0-p_1)^2}" data-display="1"></div><p>Per arm, two-sided α = 0.05, p₁ = p₀(1 − VE).</p></div>
      <div><h4>Licensure criterion (lower bound &gt; 30%)</h4><div class="tex" data-tex="n=\\frac{(z_{0.975}+z_{1-\\beta})^2\\left(\\frac{q_1}{p_1}+\\frac{q_0}{p_0}\\right)}{\\left(\\log 0.7-\\log(1-\\text{VE})\\right)^2}" data-display="1"></div><p>Tests H₀: VE ≤ 30% on the log-RR scale. The licensing criterion used here: point estimate ≥ 50% and lower 95% bound &gt; 30%.</p></div>
      <div><h4>Why block and stratify</h4><p>Permuted blocks cap the arm-size difference at half a block at any point in enrolment. Stratifying the blocks by a strong prognostic factor also balances that factor. This matters most in small trials. Large trials balance well by chance.</p></div>
    </div></details>`));
  bind('l3-n', 'nRand', v => v, () => { results.rand = null; drawRandomisation(); });
  bind('l3-p0', 'p0', v => pct(v, 1), drawSampleSize);
  bind('l3-ve', 'veExp', v => pct(v), drawSampleSize);
  bind('l3-pow', 'power', v => pct(v), drawSampleSize);
  $('#l3-sim').addEventListener('click', async () => { await simulateAllocations(); });
  drawRandomisation();
  drawSampleSize();
  if (!results.rand) simulateAllocations();
}

const SCHEMES = [['simple', 'Simple', COLORS.I], ['block', 'Permuted block (4)', COLORS.obs], ['stratified', 'Stratified block', COLORS.R]];

function drawRandomisation() {
  const rng = makeRng(results.stripSeed ??= randomSeed());
  const n = Math.min(V.nRand, 60);
  const ages = Array.from({ length: n }, () => (rng.uniform() < 0.2 ? 2 : rng.int(0, 1)));
  const allocs = SCHEMES.map(([s]) => randomise(ages, s, rng));
  getChart('l3-strip').render(c => {
    c.axes({ pad: { left: 150, bottom: 18 }, xMin: 0, xMax: n, yMin: 0, yMax: 3.6, xTicks: 1, yTicks: 1, xFmt: () => '', yFmt: () => '' });
    const { ctx } = c;
    const w = c.pw / n;
    SCHEMES.forEach(([, label, col], k) => {
      const y = c.Y(3 - k) - 9;
      allocs[k].forEach((a, i) => {
        ctx.fillStyle = a ? col : 'rgba(185,160,115,0.25)';
        ctx.fillRect(c.X(i) + 1, y, Math.max(1, w - 2), 14);
        if (ages[i] === 2) { ctx.fillStyle = '#f3ead7'; ctx.beginPath(); ctx.moveTo(c.X(i) + w / 2, y - 7); ctx.lineTo(c.X(i) + w / 2 - 3, y - 2); ctx.lineTo(c.X(i) + w / 2 + 3, y - 2); ctx.fill(); }
      });
      const b = balance(ages, allocs[k]);
      c.text(label, c.pad.left - 10, y + 6, { px: true, align: 'right' });
      c.text(`${b.n1} vs ${b.n0}`, c.pad.left - 10, y + 18, { px: true, align: 'right', color: COLORS.muted });
    });
  });
  html('l3-strip-cap', n < V.nRand ? `Showing the first ${n} of ${V.nRand} participants.` : '');
}

async function simulateAllocations() {
  const btn = $('#l3-sim'); if (btn) { btn.disabled = true; btn.textContent = '⚄ SIMULATING…'; }
  results.rand = await defer(() => {
    const rng = makeRng(randomSeed());
    const out = Object.fromEntries(SCHEMES.map(([s]) => [s, { size: [], old: [] }]));
    for (let k = 0; k < 2000; k++) {
      const ages = Array.from({ length: V.nRand }, () => (rng.uniform() < 0.2 ? 2 : rng.int(0, 1)));
      for (const [s] of SCHEMES) { const b = balance(ages, randomise(ages, s, rng)); out[s].size.push(b.sizeDiff); out[s].old.push(b.oldDiffPct); }
    }
    return out;
  });
  if (btn) { btn.disabled = false; btn.textContent = '⚄ SIMULATE 2,000 ALLOCATIONS'; }
  drawAllocationStats();
}

function drawAllocationStats() {
  const R = results.rand; if (!R) return;
  const maxV = niceMax(Math.max(5, quantile([...R.simple.old].sort((a, b) => a - b), 0.995)));
  const grid = Array.from({ length: 201 }, (_, i) => maxV * i / 200);
  const exceed = xs => grid.map(g => xs.filter(x => x > g).length / xs.length);
  const E = SCHEMES.map(([s]) => exceed(R[s].old));
  getChart('l3-hist').render(c => {
    c.axes({ xMin: 0, xMax: maxV, yMin: 0, yMax: 1, xFmt: v => v.toFixed(0), yFmt: v => Math.round(v * 100) + '%', yTicks: 4, xTicks: 5, xLabel: 'gap in % aged 65+ between arms (points)', yLabel: 'P(gap > x)' });
    c.hline(0.05, { color: COLORS.muted, dash: [2, 3], label: '5%' });
    SCHEMES.forEach(([, , col], k) => c.line(grid, E[k], { color: col, width: 2 }));
  }, x => { const i = Math.max(0, Math.min(200, Math.round(x / maxV * 200))); return [{ text: `gap > ${grid[i].toFixed(1)} pts` }, ...SCHEMES.map(([, label, col], k) => ({ text: `${label}: ${pct(E[k][i], 1)} of trials`, color: col }))]; });
  html('l3-hist-cap', SCHEMES.map(([, l, col]) => `<span style="color:${col}">■</span> ${l}`).join(' &nbsp; '));
  const n = V.nRand;
  const row = ([s, label, col]) => {
    const sz = R[s].size, od = [...R[s].old].sort((a, b) => a - b);
    const pBad = sz.filter(d => d / n > 0.1).length / sz.length;
    return `<tr><td style="color:${col}">${label}</td><td class="r">${(sz.reduce((a, b) => a + b, 0) / sz.length).toFixed(1)}</td><td class="r">${pct(pBad, 1)}</td><td class="r">${quantile(od, 0.5).toFixed(1)}</td><td class="r">${quantile(od, 0.95).toFixed(1)}</td></tr>`;
  };
  html('l3-bal-sub', `${n} participants, 2,000 simulated trials`);
  html('l3-bal', `<table class="res"><tr><th>Scheme</th><th class="r">Mean |n₁−n₀|</th><th class="r">P(&gt;10% gap)</th><th class="r">65+ gap, median</th><th class="r">65+ gap, 95th pct</th></tr>${SCHEMES.map(row).join('')}</table>
    <p class="dim" style="margin-top:8px;font-size:13px;line-height:1.6">Blocking removes arm-size imbalance. Only stratification controls the 65+ share. With ${n} participants, simple randomisation leaves a 65+ gap of ${quantile([...R.simple.old].sort((a, b) => a - b), 0.95).toFixed(0)} points or more in 1 trial in 20. Increase the trial size to see chance imbalance shrink for every scheme.</p>`);
}

function drawSampleSize() {
  const { p0, veExp: ve, power } = V;
  const p1 = p0 * (1 - ve);
  const nSup = sampleSizeTwoProportions(p0, p1, 0.05, power);
  const nLic = sampleSizeVELowerBound(p0, ve, 0.3, power);
  const nMax = Math.min(60000, niceMax(Math.max(nSup, isFinite(nLic) ? nLic : nSup) * 1.6));
  const ns = Array.from({ length: 120 }, (_, i) => Math.max(10, nMax * (i + 1) / 120));
  getChart('l3-power').render(c => {
    c.axes({ xMin: 0, xMax: nMax, xTicks: 5, yMin: 0, yMax: 1, xFmt: v => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v)), yFmt: v => Math.round(v * 100) + '%', yTicks: 4, xLabel: 'participants per arm' });
    c.hline(power, { color: COLORS.muted, dash: [2, 3] });
    c.line(ns, ns.map(n => powerTwoProportions(p0, p1, n)), { color: COLORS.guess, width: 2 });
    c.line(ns, ns.map(n => powerVELowerBound(p0, ve, n, 0.3)), { color: COLORS.R, width: 2 });
    c.marks([nSup], [power], { shape: 'dot', color: COLORS.guess, size: 4.5 });
    if (isFinite(nLic) && nLic <= nMax) c.marks([nLic], [power], { shape: 'dot', color: COLORS.R, size: 4.5 });
  }, x => [{ text: `${fmt.int(x)} per arm` }, { text: `VE > 0: ${pct(powerTwoProportions(p0, p1, x))}`, color: COLORS.guess }, { text: `LB > 30%: ${pct(powerVELowerBound(p0, ve, x, 0.3))}`, color: COLORS.R }]);
  html('l3-power-cap', `<span style="color:${COLORS.guess}">■</span> superiority over placebo (VE &gt; 0) &nbsp; <span style="color:${COLORS.R}">■</span> licensure criterion (lower bound &gt; 30%)`);
  const expCases = n => Math.round(n * (p0 + p1));
  html('l3-ss', `<table class="res">
    <tr><th></th><th class="r">Per arm</th><th class="r">Total</th><th class="r">Expected cases</th></tr>
    <tr><td style="color:${COLORS.guess}">VE &gt; 0 (two-sided α = 0.05)</td><td class="r">${fmt.int(nSup)}</td><td class="r">${fmt.int(2 * nSup)}</td><td class="r">${fmt.int(expCases(nSup))}</td></tr>
    <tr><td style="color:${COLORS.R}">Lower 95% bound &gt; 30%</td><td class="r">${isFinite(nLic) ? fmt.int(nLic) : '∞'}</td><td class="r">${isFinite(nLic) ? fmt.int(2 * nLic) : '∞'}</td><td class="r">${isFinite(nLic) ? fmt.int(expCases(nLic)) : '—'}</td></tr>
  </table>
  <p class="dim" style="margin-top:8px;font-size:13px;line-height:1.6">Power is driven by the number of <em>cases</em>, not participants: halving the attack rate roughly doubles the sample size. Showing the vaccine beats a 30% bar needs ${isFinite(nLic) ? (nLic / nSup).toFixed(1) + '×' : 'far'} more participants than showing it beats placebo. ${ve <= 0.35 ? 'An expected VE this close to 30% makes the licensure criterion almost unreachable.' : ''}</p>
  <p class="dim" style="font-size:13px">These assumptions carry into the Phase III case study.</p>`);
}

// ═════════════════════════ Study 4 · Phase III ═════════════════════════

function newHidden() {
  const rng = makeRng(randomSeed());
  hidden = { ve: Math.round(rng.range(0.45, 0.85) * 100) / 100, elderlyFactor: 0.75, p0: 0.05 };
}

/** The outbreak the trial runs in: the pathogen released in mode I, if it can spread. */
function currentOutbreak() {
  const o = state.outbreak;
  return o && o.R0 * (1 - o.immune) > 1 ? o : null;
}

/** Recompute where the trial sits on the epidemic curve and the placebo-arm risk it implies. */
function updateEpidemic() {
  const E = trialEpidemic(currentOutbreak(), V.trialStart, V.nArm);
  hidden.p0 = E.p0;
  results.p3epi = E;
  return E;
}

function renderPhase3() {
  const s = STUDIES.find(x => x.id === 'phase3');
  if (!hidden) newHidden();
  let E = updateEpidemic();
  if (V.nArm > E.maxPerArm) { V.nArm = E.maxPerArm; E = updateEpidemic(); }
  html('l-controls', `<div class="sec-head">Trial protocol</div>
    ${sliderHTML('l4-start', 'Trial starts on day', TRIAL_TIMELINE.earliestStart, 140, 7, V.trialStart, `Day 0 = the flood. The first doses exist from day ${TRIAL_TIMELINE.earliestStart}.`)}
    ${sliderHTML('l4-n', 'Participants per arm', 100, 12000, 100, Math.min(V.nArm, E.maxPerArm), '')}
    <div class="param-hint" id="l4-max" style="margin-top:-6px;margin-bottom:8px"></div>
    <div class="param"><div class="param-top"><span>Randomisation</span></div>
      <div class="seg" id="l4-scheme">${SCHEMES.map(([id, label]) => `<button data-s="${id}" class="${V.scheme === id ? 'on' : ''}">${label.replace(' (4)', '')}</button>`).join('')}</div></div>
    <div class="note" id="l4-plan" style="margin-top:4px"></div>
    <button class="btn btn-green" id="l4-run" style="margin-top:10px">▶ RUN THE PHASE III TRIAL</button>
    <button class="btn" id="l4-new">⟳ NEW CANDIDATE (UNKNOWN TRUTH)</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>Does the Sporeford vaccine meet the licensing standard: a point estimate of efficacy of at least 50% with a lower 95% confidence bound above 30%? Only a licensed vaccine may be given to the villagers.</p></div>
      <div><h3>Design</h3><p>The trial runs in the Hollow <em>during the outbreak</em>: individually randomised, placebo-controlled, 1:1. Each participant is followed for ${TRIAL_TIMELINE.followUpDays / 7} weeks for symptomatic, lab-confirmed Amanita illness. How many endpoints occur depends on where the trial sits on the epidemic curve. The true efficacy is unknown to you, and lower in residents aged 65+ (immunosenescence).</p></div>
    </div>
    <div class="grid-2">
      ${chartPanel('l4-epi', 'Your outbreak and the trial window', 'infectious residents over time · shaded = enrolment + follow-up')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Timeline</div><div class="panel-sub" id="l4-epi-src"></div></div><div id="l4-timeline"></div></div>
    </div>
    <div id="l4-out"><div class="note">Set the protocol and run the trial.</div></div>
    <details class="methods"><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Attack rate from the epidemic</h4><div class="tex" data-tex="r_0=\\phi\\cdot\\frac{1}{|T|}\\sum_{t\\in T}\\frac{C(t+42)-C(t)}{S(t)}" data-display="1"></div><p>C = cumulative infections and S = susceptibles from the SEIRD model of your outbreak; T = enrolment days; φ = ${pct(TRIAL_TIMELINE.endpointFraction)} of infections cause the endpoint illness. Previously infected residents are screened out.</p></div>
      <div><h4>Primary analysis</h4><div class="tex" data-tex="\\widehat{\\text{VE}}=1-\\frac{a/n_1}{c/n_0},\\quad \\text{CI from }\\log\\widehat{\\text{RR}}\\pm 1.96\\,\\text{SE}" data-display="1"></div><p>Intention-to-treat, Pearson χ² test, and an age-stratified Mantel–Haenszel estimate as a sensitivity analysis.</p></div>
      <div><h4>Reporting</h4><p>Participant flow follows the CONSORT format: screening, exclusions with reasons, allocation, receipt of the intervention, losses to follow-up and the analysed population per arm.</p></div>
      <div><h4>Link to Outbreak Response</h4><p>Only a licensed vaccine reaches the villagers, from the week of the licensing decision, with its true efficacy. A failed or late trial leaves the valley without a vaccine.</p></div>
    </div></details>`));
  const refresh = () => {
    let E2 = updateEpidemic();
    const nEl = $('#l4-n');
    nEl.max = E2.maxPerArm;
    if (V.nArm > E2.maxPerArm) { V.nArm = E2.maxPerArm; nEl.value = V.nArm; $('#l4-n-val').textContent = fmt.int(V.nArm); E2 = updateEpidemic(); }
    drawTrialEpidemic(E2);
  };
  bind('l4-start', 'trialStart', v => 'day ' + v, refresh);
  bind('l4-n', 'nArm', fmt.int, refresh);
  $('#l4-n').max = E.maxPerArm;
  $$('#l4-scheme button').forEach(b => b.addEventListener('click', () => { V.scheme = b.dataset.s; $$('#l4-scheme button').forEach(x => x.classList.toggle('on', x === b)); }));
  $('#l4-run').addEventListener('click', runPhase3);
  $('#l4-new').addEventListener('click', () => { newHidden(); results.p3 = null; results.p3revealed = false; renderPhase3(); teX(); toast('New vaccine candidate. Its true efficacy is unknown.'); });
  drawTrialEpidemic(E);
  if (results.p3) drawPhase3();
}

function drawTrialEpidemic(E) {
  const tr = E.traj, N = E.outbreak.N;
  const xmax = Math.max(120, Math.min(400, E.decisionDay + 30));
  const xs = tr.days.slice(0, xmax + 1), ys = tr.I.slice(0, xmax + 1).map(v => v / N);
  const ymax = niceMax(Math.max(...ys) * 1.1);
  getChart('l4-epi').render(c => {
    // choose a tick count whose step is a round number of percentage points (e.g. 15% → 3 ticks of 5%)
    const NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
    const yTicks = [4, 5, 3, 6].find(k => NICE.some(n => Math.abs(ymax * 100 / k - n) < 1e-6)) ?? 4;
    c.axes({ xMin: 0, xMax: xmax, yMin: 0, yMax: ymax, xFmt: v => 'd' + Math.round(v), yFmt: v => +(v * 100).toFixed(1) + '%', yTicks, xTicks: 6, xLabel: 'days since the flood' });
    const { ctx } = c;
    ctx.fillStyle = 'rgba(95,179,122,0.10)';
    ctx.fillRect(c.X(V.trialStart), c.pad.top, c.X(E.windowEnd) - c.X(V.trialStart), c.ph);
    ctx.fillStyle = 'rgba(95,179,122,0.10)';
    ctx.fillRect(c.X(V.trialStart), c.pad.top, c.X(V.trialStart + E.enrolDays) - c.X(V.trialStart), c.ph);
    c.area(xs, ys, { color: 'rgba(192,57,43,0.10)' });
    c.line(xs, ys, { color: COLORS.I, width: 2 });
    c.vline(V.trialStart, { color: COLORS.R, dash: [3, 3], label: 'start', labelY: 10 });
    c.vline(E.decisionDay, { color: COLORS.obs, dash: [3, 3], label: `licence decision · week ${E.approvalWeek}`, labelY: 34, align: E.decisionDay > xmax * 0.5 ? 'right' : 'left' });
  }, x => { const d = Math.round(x); return tr.I[d] === undefined ? null : [{ text: `Day ${d} (week ${Math.floor(d / 7) + 1})` }, { text: `infectious ${pct(tr.I[d] / N, 1)}`, color: COLORS.I }]; });
  html('l4-epi-cap', 'Darker band = enrolment, lighter band = remaining follow-up.');
  html('l4-epi-src', E.isDefault ? 'reference outbreak · release your own pathogen in mode I' : 'the pathogen you released in mode I');
  const o = E.outbreak;
  const plan = sampleSizeVELowerBound(E.attack, V.veExp, 0.3, V.power);
  const feasible = isFinite(plan) && plan <= E.maxPerArm;
  html('l4-timeline', `<table class="res">
      <tr><td>Pathogen</td><td class="r">R₀ ${o.R0.toFixed(1)} · latent ${o.latent} d · infectious ${o.infectious} d · N ${fmt.int(o.N)}</td></tr>
      <tr><td>Enrolment</td><td class="r">days ${V.trialStart}–${V.trialStart + E.enrolDays} (${fmt.int(2 * V.nArm)} people)</td></tr>
      <tr><td>Follow-up ends · licence decision</td><td class="r">day ${E.windowEnd} · day ${E.decisionDay}</td></tr>
      <tr><td>Placebo-arm risk of the endpoint</td><td class="r" style="color:var(--bright)">${pct(E.attack, 2)}</td></tr>
      <tr><td>Expected endpoint cases (placebo arm)</td><td class="r">${fmt.int(E.attack * V.nArm)}</td></tr>
      <tr><td>Vaccine reaches villagers if licensed</td><td class="r" style="color:${E.approvalWeek <= 20 ? 'var(--green-bright)' : 'var(--red-bright)'}">week ${E.approvalWeek}${E.approvalWeek > 20 ? ' · after the 20-week response campaign ends' : ''}</td></tr>
    </table>
    <div class="interp" style="margin-top:8px"><p>${V.trialStart + E.enrolDays > (tr.I.indexOf(Math.max(...tr.I)) + 14) && E.attack < 0.02
      ? 'The trial starts after the epidemic has peaked, so few participants are exposed and few endpoints occur. By the time a trial is ready, transmission may already be fading.'
      : 'Transmission is still intense during follow-up, so endpoints accrue quickly and a modest trial can answer the question. Starting later means fewer cases but more time for development.'}</p></div>`);
  html('l4-plan', `Sample size for the licence criterion with this attack rate (${pct(E.attack, 2)}), expected VE ${pct(V.veExp)} and power ${pct(V.power)} (assumptions from the sample-size case study): <em>${isFinite(plan) ? fmt.int(plan) : '∞'} per arm</em>. ` +
    (feasible ? `<button class="link-btn" id="l4-use">Use this</button>` : `<span class="bad">More than the ${fmt.int(E.maxPerArm)} per arm the valley can supply: start earlier.</span>`));
  html('l4-max', `At most ${fmt.int(E.maxPerArm)} per arm: ${pct(TRIAL_TIMELINE.maxShare, 0)} of residents still susceptible on day ${V.trialStart}.`);
  $('#l4-use')?.addEventListener('click', () => { V.nArm = Math.min(E.maxPerArm, Math.max(100, Math.ceil(plan / 100) * 100)); renderPhase3(); teX(); });
}

async function runPhase3() {
  const btn = $('#l4-run'); btn.disabled = true; btn.textContent = '▶ ENROLLING…';
  const E = updateEpidemic();
  results.p3revealed = false;
  results.p3 = await defer(() => ({ ...simulatePhase3(hidden, V.nArm, V.scheme, makeRng(randomSeed())), nArm: V.nArm, scheme: V.scheme, approvalWeek: E.approvalWeek, attack: E.attack }));
  btn.disabled = false; btn.textContent = '▶ RUN THE PHASE III TRIAL';
  drawPhase3();
  const P = results.p3, ve = toVE(P.rr);
  const licensed = ve.est >= 0.5 && ve.lo > 0.3;
  if (licensed) {
    update({ vaccine: { ve: phase3Truth(hidden).vaccinatedVE, est: ve.est, lo: ve.lo, hi: ve.hi, week: P.approvalWeek } });
    toast(`Licensed. VE ${pct(ve.est, 1)} (95% CI ${pct(ve.lo, 0)}–${pct(ve.hi, 0)}). Villagers can be vaccinated from week ${P.approvalWeek}.`);
  } else toast(`Not licensed: VE ${pct(ve.est, 1)}, lower bound ${pct(ve.lo, 1)}. The villagers get no vaccine.`);
}

function drawPhase3() {
  const P = results.p3; if (!P) return;
  const ve = toVE(P.rr), mh = toVE(P.mh);
  const pass1 = ve.est >= 0.5, pass2 = ve.lo > 0.3, licensed = pass1 && pass2;
  const revealed = results.p3revealed;
  html('l4-out', `
    <div class="kpi-row">
      <div class="stat-box"><div class="stat-v" style="color:${licensed ? 'var(--green-bright)' : 'var(--amber)'}">${licensed ? 'LICENSED' : 'NOT LICENSED'}</div><div class="stat-l">${pass1 ? '✓' : '✗'} point estimate ≥ 50% · ${pass2 ? '✓' : '✗'} lower bound &gt; 30%</div></div>
      <div class="stat-box"><div class="stat-v">${pct(ve.est, 1)}</div><div class="stat-l">VE (95% CI ${pct(ve.lo, 1)} to ${pct(ve.hi, 1)})</div></div>
      <div class="stat-box"><div class="stat-v">${P.t.a} vs ${P.t.c}</div><div class="stat-l">cases: vaccine vs placebo</div></div>
      <div class="stat-box"><div class="stat-v">${fmt.p(P.test.p)}</div><div class="stat-l">p-value, χ²₁ = ${P.test.chi2.toFixed(1)}</div></div>
    </div>
    ${consortHTML(P.consort)}
    <div class="grid-2" style="margin-top:12px">
      ${chartPanel('l4-forest', 'Efficacy overall and by age band', 'subgroup estimates with 95% CI · dashed = 30% licensure bar')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Trial report</div><div class="panel-sub">${fmt.int(P.n)} randomised · ${SCHEMES.find(s => s[0] === P.scheme)[1].toLowerCase()} randomisation</div></div>
        <table class="res">
          <tr><th></th><th class="r">Vaccine</th><th class="r">Placebo</th></tr>
          <tr><td>Randomised · analysed</td><td class="r">${fmt.int(P.consort.arms[0].allocated)} · ${fmt.int(P.t.a + P.t.b)}</td><td class="r">${fmt.int(P.consort.arms[1].allocated)} · ${fmt.int(P.t.c + P.t.d)}</td></tr>
          <tr><td>Aged 65+</td><td class="r">${fmt.int(P.old[0])}</td><td class="r">${fmt.int(P.old[1])}</td></tr>
          <tr><td>Confirmed cases (attack rate)</td><td class="r">${P.t.a} (${pct(P.rr.r1, 2)})</td><td class="r">${P.t.c} (${pct(P.rr.r0, 2)})</td></tr>
          <tr><td>Primary VE, ITT</td><td class="r" colspan="2">${veStr(ve)}</td></tr>
          <tr><td>Age-stratified MH VE</td><td class="r" colspan="2">${veStr(mh)}</td></tr>
        </table>
        <div class="interp" style="margin-top:8px"><p>${phase3Interp(P, ve, licensed)}</p></div>
        <button class="btn" id="l4-reveal" style="margin-top:8px" ${revealed ? 'disabled' : ''}>◉ REVEAL THE TRUE EFFICACY</button>
        <div id="l4-truth" class="note" style="margin-top:6px" ${revealed ? '' : 'hidden'}>${truthText(ve)}</div>
      </div>
    </div>`);
  const rows = [
    { label: 'Overall (ITT)', ...ve, color: COLORS.R },
    ...P.sub.map((rr, i) => ({ label: `Age ${AGE_GROUPS[i]}`, ...toVE(rr), color: COLORS.guess })),
  ];
  const ch = getChart('l4-forest');
  forest(ch, rows, null, { min: 0 });
  const prevDraw = ch.drawFn;
  ch.render(c => {
    prevDraw(c);
    c.vline(0.3, { color: alpha(COLORS.obs, 0.7), dash: [2, 3], label: '30% bar', labelY: 10 });
    if (revealed) {
      const T = phase3Truth(hidden);
      const truths = [T.ittVE, ...T.subgroupITT];
      c.marks(truths, truths.map((_, i) => rows.length - i), { shape: 'cross', color: COLORS.truth, size: 5, width: 1.5 });
    }
  }, ch.tooltipFn);
  html('l4-forest-cap', revealed ? '× = the true value each row estimates (ITT: effect of being randomised to vaccine).' : '');
  $('#l4-reveal').addEventListener('click', () => { results.p3revealed = true; drawPhase3(); });
}

function truthText(ve) {
  const T = phase3Truth(hidden);
  const covered = ve.lo <= T.ittVE && T.ittVE <= ve.hi;
  return `True efficacy in those vaccinated: <em>${pct(hidden.ve)}</em> in ages 18–64 and <em>${pct(hidden.ve * hidden.elderlyFactor)}</em> in 65+, which averages to <em>${pct(T.vaccinatedVE, 1)}</em> across the population. ` +
    `Because ${pct(1 - PHASE3.received)} of the vaccine arm never received the injection, the ITT analysis estimates <em>${pct(PHASE3.received, 0)} × ${pct(T.vaccinatedVE, 1)} = ${pct(T.ittVE, 1)}</em>. ` +
    `Expected placebo attack rate: <em>${pct(T.placeboAttack, 2)}</em>. ` +
    (covered ? 'Your 95% CI covered the true ITT efficacy.' : 'Your 95% CI missed the true ITT efficacy, which should happen about 1 time in 20.');
}

/** CONSORT participant flow diagram. */
function consortHTML(c) {
  const box = (t, extra = '') => `<div class="cbox ${extra}">${t}</div>`;
  const armCol = (a, name) => `<div class="ccol">
      ${box(`<b>Allocated to ${name}</b> (n = ${fmt.int(a.allocated)})<br>Received allocated injection (n = ${fmt.int(a.received)})<br>Did not receive it (n = ${fmt.int(a.notReceived)})`)}
      <div class="carrow">↓</div>
      ${box(`Lost to follow-up, no outcome (n = ${fmt.int(a.lost)})`)}
      <div class="carrow">↓</div>
      ${box(`<b>Analysed</b> (n = ${fmt.int(a.analysed)})<br>Analysed as randomised (ITT)`)}
    </div>`;
  return `<div class="panel consort"><div class="panel-head"><div><div class="panel-title">CONSORT flow diagram</div><div class="panel-sub">participant flow through the trial, in CONSORT format</div></div></div>
    <div class="cgrid">
      <div class="crow"><span class="cstage">Enrolment</span>${box(`Assessed for eligibility (n = ${fmt.int(c.screened)})`)}</div>
      <div class="crow side"><div class="carrow">↓</div>${box(`<b>Excluded</b> (n = ${fmt.int(c.excluded)})<br>Not meeting inclusion criteria (n = ${fmt.int(c.notEligible)})<br>Declined to participate (n = ${fmt.int(c.declined)})<br>Other reasons (n = ${fmt.int(c.other)})`, 'excl')}</div>
      <div class="crow">${box(`<b>Randomised</b> (n = ${fmt.int(c.randomised)})`)}</div>
      <div class="crow"><span class="cstage">Allocation · Follow-up · Analysis</span></div>
      <div class="carms">${armCol(c.arms[0], 'vaccine')}${armCol(c.arms[1], 'placebo')}</div>
    </div></div>`;
}

function phase3Interp(P, ve, licensed) {
  const cases = P.t.a + P.t.c;
  const w = (ve.hi - ve.lo) * 100;
  let s = `The trial accrued <em>${cases}</em> cases, giving a CI ${w.toFixed(0)} points wide. `;
  if (licensed) s += 'Both licensing criteria are met. ';
  else if (ve.est >= 0.5) s += 'The point estimate is good, but the trial is too small to rule out efficacy below 30%. This is an <em>underpowered</em> result, not evidence that the vaccine fails. ';
  else s += 'The point estimate itself falls short of 50%. ';
  const old = toVE(P.sub[2]);
  s += `In residents aged 65+ the estimate is ${pct(old.est, 0)} (CI ${pct(old.lo, 0)} to ${pct(old.hi, 0)}). Subgroups have far fewer cases, so treat apparent differences with caution unless pre-specified.`;
  return s;
}

