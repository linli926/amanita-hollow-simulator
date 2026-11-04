// Vaccine Lab, block 2 (Hackshaw): case study 6 — non-compliance and interim analyses.

import { complianceTrial, caceBootstrap, sequentialTrials, boundary } from '../stats/trials.js';
import { makeRng, randomSeed } from '../stats/rng.js';
import { COLORS } from "../ui/chart.js";
import { $, fmt, html, defer } from '../ui/dom.js';
import { V, results, STUDIES, sliderHTML, bind, article, chartPanel, getChart, pct, forest } from './lab-ui.js';

const METHODS = [['naive', 'Naive: p < 0.05 at every look', COLORS.I], ['pocock', 'Pocock', COLORS.obs], ['obf', "O'Brien–Fleming", COLORS.R]];

export function renderConduct() {
  const s = STUDIES.find(x => x.id === 'conduct');
  html('l-controls', `<div class="sec-head">A · Non-compliance</div>
    ${sliderHTML('l6-n', 'Participants per arm', 500, 10000, 500, V.nArm6)}
    ${sliderHTML('l6-ve', 'True efficacy in those vaccinated', 0.3, 0.95, 0.05, V.ve6)}
    ${sliderHTML('l6-ref', 'Vaccine arm: never vaccinated', 0, 0.5, 0.05, V.refusal)}
    ${sliderHTML('l6-or', 'Healthy-adherer effect (odds ratio)', 1, 8, 0.5, V.refusalOR, 'How much more often frail, incautious participants skip the vaccine. 1 = refusal unrelated to risk.')}
    <button class="btn btn-green" id="l6-run">⟳ RUN THE TRIAL</button>
    <div class="sec-head" style="margin-top:14px">B · Interim analyses</div>
    ${sliderHTML('l6-k', 'Number of analyses (looks)', 1, 5, 1, V.K)}
    ${sliderHTML('l6-vs', 'True efficacy (0 = vaccine does nothing)', 0, 0.8, 0.05, V.veSeq)}
    ${sliderHTML('l6-ns', 'Planned participants per arm', 500, 8000, 500, V.nSeq)}
    <button class="btn" id="l6-seq">⚄ SIMULATE 2,000 MONITORED TRIALS</button>`);
  html('l-article', article(s, `
    <div class="study-grid">
      <div><h3>Question</h3><p>Two things go wrong in real trials. Some participants randomised to the vaccine never receive it: who should be analysed, and how? And the data monitoring committee wants to look at the results before the trial ends: how can it stop early for benefit without inflating the false-positive rate?</p></div>
      <div><h3>Design</h3><p><em>A.</em> A two-arm trial with one-sided non-compliance. Participants who skip the vaccine tend to be frailer and less cautious, so they are at higher risk. <em>B.</em> Trials analysed at K equally spaced looks, stopping as soon as |z| crosses a boundary. Run with efficacy 0 to measure the type I error, or with efficacy &gt; 0 to measure power.</p></div>
    </div>
    <h3>A · Who is analysed?</h3>
    <div class="grid-2">
      ${chartPanel('l6-forest', 'Estimated efficacy by analysis population', '95% CI · dashed = true efficacy in those vaccinated')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Interpretation</div></div><div id="l6-interp" class="interp"></div></div>
    </div>
    <h3 style="margin-top:4px">B · Looking early</h3>
    <div class="grid-2">
      ${chartPanel('l6-bound', 'Stopping boundaries and 40 trial paths', 'z statistic at each look · trials stop when a path crosses a boundary')}
      <div class="panel"><div class="panel-head"><div class="panel-title">Operating characteristics</div><div class="panel-sub" id="l6-seq-sub"></div></div><div id="l6-seq-table" class="dim" style="font-size:11px">Press SIMULATE.</div></div>
    </div>
    <details class="methods" open><summary>▸ METHODS</summary><div class="method-grid">
      <div><h4>Analysis populations</h4><p><em>ITT</em>: everyone as randomised. It estimates the effect of <em>offering</em> the vaccine, and randomisation protects it. <em>Per-protocol</em>: drops vaccine-arm participants who were not vaccinated. <em>As-treated</em>: compares by vaccine actually received. Both break randomisation.</p></div>
      <div><h4>Complier average causal effect</h4><div class="tex" data-tex="r^{C}_{0}=\\frac{r_{\\text{placebo}}-(1-c)\\,r_{\\text{never}}}{c},\\quad \\text{VE}_{\\text{CACE}}=1-\\frac{r^{C}_{1}}{r^{C}_{0}}" data-display="1"></div><p>c = proportion vaccinated in the vaccine arm. Randomisation is used as an instrument: never-takers are identified in the vaccine arm and subtracted from the placebo arm. 95% CI by bootstrap (200 resamples).</p><p class="cite">Angrist, Imbens &amp; Rubin (1996)</p></div>
      <div><h4>Group-sequential boundaries</h4><div class="tex" data-tex="\\text{Pocock: } |z_k|\\ge C_P \\qquad \\text{O'Brien–Fleming: } |z_k|\\ge C_B\\sqrt{K/k}" data-display="1"></div><p>Constants keep the overall two-sided α at 5% (K = 5: C<sub>P</sub> = 2.413, C<sub>B</sub> = 2.040). O'Brien–Fleming is very strict early and close to 1.96 at the final look.</p><p class="cite">Pocock (1977); O'Brien &amp; Fleming (1979)</p></div>
    </div></details>`));
  results.c6seed ??= randomSeed();
  bind('l6-n', 'nArm6', fmt.int, () => {});
  bind('l6-ve', 've6', v => pct(v), () => {});
  bind('l6-ref', 'refusal', v => pct(v), () => {});
  bind('l6-or', 'refusalOR', v => v.toFixed(1), () => {});
  bind('l6-k', 'K', v => v, drawBoundaries);
  bind('l6-vs', 'veSeq', v => pct(v), () => {});
  bind('l6-ns', 'nSeq', fmt.int, () => {});
  $('#l6-run').addEventListener('click', () => { results.c6seed = randomSeed(); runCompliance(); });
  $('#l6-seq').addEventListener('click', runSequential);
  runCompliance();
  drawBoundaries();
}

async function runCompliance() {
  const btn = $('#l6-run'); btn.disabled = true;
  const R = await defer(() => {
    const rng = makeRng(results.c6seed);
    const r = complianceTrial({ nPerArm: V.nArm6, p0: V.p06, ve: V.ve6, refusal: V.refusal, refusalOR: V.refusalOR }, rng);
    r.caceCI = caceBootstrap(r.rows, rng, 200);
    return r;
  });
  btn.disabled = false;
  forest(getChart('l6-forest'), [
    { label: 'Intention-to-treat', ...R.itt, color: COLORS.R },
    { label: 'Per-protocol', ...R.pp, color: COLORS.I },
    { label: 'As-treated', ...R.at, color: COLORS.D },
    { label: 'CACE (instrumental var.)', est: R.cace, lo: R.caceCI.lo, hi: R.caceCI.hi, color: COLORS.guess },
  ], V.ve6, { min: 0 });
  html('l6-forest-cap', `${pct(R.compliance, 1)} of the vaccine arm was vaccinated. Infection risk: ${pct(R.riskRefusers, 1)} among those who skipped it vs ${pct(R.riskControl, 1)} in the placebo arm.`);
  const p = [];
  p.push(`<em>ITT</em> estimates ${pct(R.itt.est, 1)}. It is diluted towards zero because ${pct(1 - R.compliance, 0)} of the vaccine arm was never vaccinated. That is still the right answer to "what happens if we offer this vaccine?", and it is protected by randomisation. Regulators use ITT as the primary analysis for superiority trials.`);
  p.push(V.refusalOR > 1.2
    ? `<em>Per-protocol</em> (${pct(R.pp.est, 1)}) and <em>as-treated</em> (${pct(R.at.est, 1)}) <em>overstate</em> efficacy. Those who skipped the vaccine were frailer and less cautious, so removing them leaves a healthier vaccine group, but nobody is removed from the placebo arm. This is the healthy-adherer bias: non-compliance is not random.`
    : `With refusal unrelated to risk, per-protocol (${pct(R.pp.est, 1)}) and as-treated (${pct(R.at.est, 1)}) happen to be close to the truth. In practice this cannot be verified, so neither can be trusted by default.`);
  p.push(`<em>CACE</em> (${pct(R.cace, 1)}, 95% CI ${pct(R.caceCI.lo, 0)} to ${pct(R.caceCI.hi, 0)}) recovers the efficacy among those who would take the vaccine, using randomisation itself as the instrument. It assumes being randomised to vaccine has no effect except through vaccination (exclusion restriction). The CI is wider than ITT's: that is the price of the adjustment.`);
  html('l6-interp', p.map(x => `<p>${x}</p>`).join(''));
}

function drawBoundaries() {
  const K = V.K;
  const ks = Array.from({ length: K }, (_, i) => i + 1);
  const paths = results.seq?.K === K ? results.seq.paths : [];
  const ymax = Math.max(5, ...ks.map(k => boundary('obf', k, K)), ...paths.flat().map(Math.abs)) * 1.05;
  getChart('l6-bound').render(c => {
    c.axes({ xMin: 0, xMax: 1, yMin: -ymax, yMax: ymax, xTicks: K, yTicks: 4, xFmt: v => (v === 0 ? '0' : Math.round(v * 100) + '%'), yFmt: v => v.toFixed(1), xLabel: 'information fraction (share of participants analysed)' });
    c.hline(0, { color: 'rgba(185,160,115,0.25)', dash: [] });
    paths.forEach(z => c.line([0, ...ks.map(k => k / K)], [0, ...z], { color: COLORS.muted, width: 0.8, alpha: 0.5 }));
    for (const [m, , col] of METHODS) {
      const xs = ks.map(k => k / K), ys = ks.map(k => boundary(m, k, K));
      c.line(xs, ys, { color: col, width: 2 }); c.line(xs, ys.map(v => -v), { color: col, width: 2 });
      c.marks(xs, ys, { shape: 'dot', color: col, size: 3 }); c.marks(xs, ys.map(v => -v), { shape: 'dot', color: col, size: 3 });
    }
  }, x => {
    const k = Math.max(1, Math.min(K, Math.round(x * K)));
    return [{ text: `Look ${k} of ${K}` }, ...METHODS.map(([m, label, col]) => ({ text: `${label.split(':')[0]}: |z| ≥ ${boundary(m, k, K).toFixed(2)}`, color: col }))];
  });
  html('l6-bound-cap', METHODS.map(([, l, col]) => `<span style="color:${col}">■</span> ${l}`).join(' &nbsp; ') + (paths.length ? '' : ' · grey paths appear after simulating'));
}

async function runSequential() {
  const btn = $('#l6-seq'); btn.disabled = true; btn.textContent = '⚄ SIMULATING…';
  results.seq = await defer(() => sequentialTrials({ nPerArm: V.nSeq, p0: V.p06, ve: V.veSeq, K: V.K, nSim: 2000 }, makeRng(randomSeed())));
  btn.disabled = false; btn.textContent = '⚄ SIMULATE 2,000 MONITORED TRIALS';
  drawBoundaries();
  const R = results.seq, K = R.K, nul = V.veSeq === 0;
  html('l6-seq-sub', `${K} look${K > 1 ? 's' : ''} · true efficacy ${pct(V.veSeq)} · ${fmt.int(2 * V.nSeq)} planned participants`);
  const rows = METHODS.map(([m, label, col]) => {
    const r = R[m];
    const dist = r.stopLook.map(n => pct(n / 2000, 0)).join(' / ');
    const cls = nul ? (r.rate > 0.06 ? 'bad' : 'sig') : '';
    return `<tr><td style="color:${col}">${label}</td><td class="r ${cls}">${pct(r.rate, 1)}</td><td class="r">${fmt.int(r.expectedN)}</td><td class="r dim">${dist}</td></tr>`;
  }).join('');
  html('l6-seq-table', `<table class="res"><tr><th>Rule</th><th class="r">${nul ? 'Type I error' : 'Power'}</th><th class="r">Expected N</th><th class="r">Stopped at look 1 / … / ${K}</th></tr>${rows}</table>
    <div class="interp" style="margin-top:8px"><p>${nul
      ? `With no true effect, testing at p &lt; 0.05 at every look rejects ${pct(R.naive.rate, 1)} of the time${K > 1 ? `, ${(R.naive.rate / 0.05).toFixed(1)}× the nominal 5%` : ''}. Each extra look is another chance for noise to cross the line. Both group-sequential boundaries keep the error near 5%.`
      : `With true efficacy ${pct(V.veSeq)}, O'Brien–Fleming keeps almost all the power of a single final analysis while often stopping early, which cuts the expected sample size. Pocock stops earlier but costs more power at the final look. Naive testing looks most powerful only because its type I error is inflated: run it with efficacy 0 to see.`}</p></div>`);
}


