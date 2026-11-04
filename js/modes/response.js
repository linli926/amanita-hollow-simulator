// Mode IV — Outbreak Response: command interventions across the valley, week by week.

import { createWorld, playWeek, weeklyCost, actionAvailable, totals, counterfactual, grade, refreshMixing,
  ACTIONS, TREATMENT_COST, WEEKS, COMPASSIONATE_WEEK, LOW_BUDGET_SHARE } from '../models/world.js';
import { generationInterval } from '../models/theory.js';
import { coriRt } from '../stats/inference.js';
import { randomSeed } from '../stats/rng.js';
import { Chart, COLORS, alpha, niceMax } from '../ui/chart.js';
import { ValleyMap, VILLAGE_COLORS } from '../ui/map.js';
import { $, $$, fmt, text, html, defer } from '../ui/dom.js';
import { state } from '../state.js';

let world = null;
let map, chart, summaryChart = null;
let selected = 0;
let difficulty = 'normal';
let shownDay = 0;
let animating = false;
let loopId = 0, active = false;
let toast;

export function initResponse(ctx) {
  toast = ctx.toast;
  map = new ValleyMap($('#g-map'), k => { selected = k; renderSidebar(); });
  chart = new Chart($('#g-chart'));
  $('#g-advance').addEventListener('click', advance);
  $('#g-new').addEventListener('click', () => newGame());
  $$('#g-diff button').forEach(b => b.addEventListener('click', () => {
    $$('#g-diff button').forEach(x => x.classList.toggle('on', x === b));
    difficulty = b.dataset.diff;
    newGame();
  }));
  html('g-legend', VILLAGE_COLORS.map((c, k) => `<span><i style="background:${c}"></i>${['Sporeford', 'Mossbank', "Gill's Crossing", 'Ringmere', 'Capstone', 'Veil Hollow'][k]}</span>`).join(''));
}

export function enterResponse(banner) {
  // A newly released pathogen starts a new campaign, unless one is already under way.
  if (!world || (world.week === 0 && (state.outbreak?.seed ?? null) !== world.pathogenSeed)) newGame();
  syncTreatment();
  syncVaccine();
  banner(`<em>EMERGENCY COMMAND · AMANITA HOLLOW.</em> The spores have reached the valley's villages, but nobody knows the true R₀. You see only what the clinics report. ` +
    (world.pathogen ? `The pathogen is the one you designed in mode I. ` : `Release a pathogen in mode I to fight your own design; until then the valley faces a random one. `) +
    `Each week, spend credits on lockdowns, travel bans and testing. ` +
    (state.vaccine ? `<em>The vaccine is licensed</em> (Phase III VE ${(state.vaccine.est * 100).toFixed(0)}%) and arrives in week ${world.vaccineWeek}. ` : `<em>There is no vaccine for villagers</em> until a Phase III trial in the Vaccine Lab shows it works. `) +
    (state.treatment ? `<em>Volvarin is approved</em> (trial HR ${state.treatment.estHR.toFixed(2)}).` : `Treatment needs a significant trial result from mode III (or compassionate use from week ${COMPASSIONATE_WEEK}).`) +
    ` Save as many lives as you can.`);
  active = true;
  loop();
}

export function leaveResponse() { active = false; cancelAnimationFrame(loopId); }

function syncVaccine() {
  if (world && state.vaccine && world.vaccineLicensed !== state.vaccine) {
    world.vaccineLicensed = state.vaccine;
    world.vaccineEff = state.vaccine.ve;
    world.vaccineWeek = Math.max(world.week + 1, Math.min(world.vaccineWeek, state.vaccine.week));
    world.log.push({ week: world.week + 1, cls: 'ok', msg: `Vaccine licensed after Phase III (VE ${(state.vaccine.est * 100).toFixed(0)}%). Campaigns can start in week ${world.vaccineWeek}.` });
    renderFeed(); renderSidebar();
  }
}

function syncTreatment() {
  if (world && state.treatment && world.treatmentHR === null) {
    world.treatmentHR = state.treatment.trueHR;
    world.log.push({ week: world.week + 1, cls: 'ok', msg: `Volvarin approved after a positive trial (HR ${state.treatment.estHR.toFixed(2)}). Valley-wide treatment is now available.` });
    renderFeed(); renderSidebar();
  }
}

function newGame() {
  const pathogen = state.outbreak && state.outbreak.R0 * (1 - state.outbreak.immune) > 1 ? state.outbreak : null;
  world = createWorld(difficulty, randomSeed(), { treatmentHR: state.treatment?.trueHR ?? null, vaccine: state.vaccine ? { week: state.vaccine.week, ve: state.vaccine.ve } : null, pathogen });
  world.pathogenSeed = pathogen?.seed ?? null;
  world.vaccineLicensed = state.vaccine;
  shownDay = 0;
  selected = 0;
  summaryChart = null;
  $('#g-summary').classList.remove('show');
  $('#g-advance').disabled = false;
  world.log.push({ week: 1, cls: 'alert', msg: `Unexplained deaths reported somewhere in the Hollow. Budget: ${world.budget} credits for ${WEEKS} weeks.` });
  world.log.push({ week: 1, cls: '', msg: `Lab: latent period about ${world.hidden.latent} d, infectious period about ${world.hidden.infectious} d. Only about 35% of cases reach a clinic unless you test.` });
  renderAll();
}

function loop() {
  if (!active) return;
  map.draw(world, { selected, upToDay: shownDay, time: performance.now() });
  loopId = requestAnimationFrame(loop);
}

function renderAll() { renderSidebar(); renderChart(); renderFeed(); }

function toggleBtn(label, hint, cost, on, disabled, onClick) {
  const b = document.createElement('button');
  b.className = 'toggle' + (on ? ' on' : '');
  b.disabled = disabled;
  b.innerHTML = `<span>${on ? '■' : '□'} ${label}<small>${hint}</small></span><span class="cost">${cost}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

function renderSidebar() {
  if (!world) return;
  const t = totals(world);
  const hist = world.history.slice(0, shownDay);
  text('g-week', `${Math.min(world.week + (world.over ? 0 : 1), WEEKS)} / ${WEEKS}`);
  text('g-credits', `${world.credits.toFixed(1)}`);
  const low = world.credits < LOW_BUDGET_SHARE * world.budget;
  $('#g-credits').style.color = low ? 'var(--red-bright)' : '#b9a2e6';
  $('#g-credits').title = low ? 'Less than 30% of the budget is left' : '';
  text('g-cases', fmt.int(hist.reduce((s, h) => s + h.reported.reduce((a, b) => a + b, 0), 0)));
  text('g-deaths', fmt.int(hist.reduce((s, h) => s + h.newDeaths.reduce((a, b) => a + b, 0), 0)));
  void t;

  // Cori Rt on valley-wide reported cases
  const daily = [0, ...hist.map(h => h.reported.reduce((a, b) => a + b, 0))];
  const rt = coriRt(daily, generationInterval(world.hidden.latent, world.hidden.infectious, 40), 7);
  const last = rt.at(-1);
  const rtEl = $('#g-rt');
  if (last) {
    rtEl.innerHTML = `${last.mean.toFixed(2)} <span style="color:var(--muted);font-size:11px">[${last.lo.toFixed(2)}–${last.hi.toFixed(2)}]</span>`;
    rtEl.style.color = last.lo > 1 ? 'var(--red-bright)' : last.hi < 1 ? 'var(--green-bright)' : 'var(--amber)';
  } else { rtEl.textContent = 'insufficient data'; rtEl.style.color = 'var(--muted)'; }

  // Village card
  const v = world.villages[selected], p = world.policy[selected];
  const recent = hist.slice(-7);
  const wk = recent.reduce((s, h) => s + h.reported[selected], 0);
  const dth = hist.reduce((s, h) => s + h.newDeaths[selected], 0);
  const card = $('#g-village');
  card.innerHTML = `<div class="village-name" style="color:${VILLAGE_COLORS[selected]}">${v.name}</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:6px">${v.desc}</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-v sm">${fmt.int(v.N)}</div><div class="stat-l">residents</div></div>
      <div class="stat-box"><div class="stat-v sm" style="color:var(--amber)">${wk}</div><div class="stat-l">reported last 7 d</div></div>
      <div class="stat-box"><div class="stat-v sm" style="color:var(--D)">${dth}</div><div class="stat-l">deaths</div></div>
      <div class="stat-box"><div class="stat-v sm" style="color:var(--V)">${fmt.int(world.state[selected].V)}</div><div class="stat-l">vaccinated (protected)</div></div>
    </div>`;
  const list = document.createElement('div');
  list.className = 'toggle-list';
  for (const [key, a] of Object.entries(ACTIONS)) {
    const avail = actionAvailable(world, key);
    const hint = avail ? a.hint
      : key === 'vaccine' ? (state.vaccine ? `licensed · arrives in week ${world.vaccineWeek}` : 'not available: needs a successful Phase III trial (Vaccine Lab)')
      : `available from week ${a.unlock}`;
    list.appendChild(toggleBtn(a.label, hint, `${a.cost(v)}/wk`, p[key], !avail || world.over || animating, () => {
      p[key] = !p[key];
      if (key === 'travel') refreshMixing(world);
      renderSidebar();
    }));
  }
  card.appendChild(list);

  // Valley-wide
  const g = $('#g-global');
  g.innerHTML = '';
  const tAvail = actionAvailable(world, 'treatment');
  const tHint = world.treatmentHR !== null && state.treatment
    ? `Volvarin · trial HR ${state.treatment.estHR.toFixed(2)}`
    : tAvail ? 'compassionate use · unproven' : `needs a positive trial (mode III) or week ${COMPASSIONATE_WEEK}`;
  g.appendChild(toggleBtn('Treat all cases', tHint, `${TREATMENT_COST}/wk`, world.treatment, !tAvail || world.over || animating, () => { world.treatment = !world.treatment; renderSidebar(); }));
  const cost = weeklyCost(world);
  const info = document.createElement('div');
  info.className = 'param-hint';
  info.style.marginTop = '6px';
  info.innerHTML = `Next week's orders cost <em style="color:${cost > world.credits ? 'var(--red-bright)' : '#b9a2e6'}">${cost.toFixed(1)}</em> credits${cost > world.credits ? ', more than you have. The most expensive orders will be dropped.' : '.'}`;
  g.appendChild(info);
  $('#g-advance').disabled = world.over || animating;
  text('g-day', `Day ${shownDay}`);
}

function renderChart() {
  const hist = world.history.slice(0, shownDay);
  const K = world.villages.length;
  const xmax = WEEKS * 7;
  const series = [];
  for (let k = 0; k < K; k++) {
    const ys = hist.map((_, i) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { s += hist[j].reported[k]; n++; }
      return s / n;
    });
    series.push(ys);
  }
  const ymax = niceMax(Math.max(5, ...series.flat()) * 1.1);
  chart.render(c => {
    c.axes({ xMin: 0, xMax: xmax, yMin: 0, yMax: ymax, xFmt: v => 'w' + Math.round(v / 7), xTicks: 5, yFmt: v => Math.round(v), yTicks: 4, yLabel: 'cases/day' });
    const { ctx } = c;
    hist.forEach((h, i) => {
      if (h.overloaded.some(Boolean)) { ctx.fillStyle = 'rgba(192,57,43,0.08)'; ctx.fillRect(c.X(h.day - 1), c.pad.top, c.X(h.day) - c.X(h.day - 1) + 0.5, c.ph); }
      void i;
    });
    for (let w = 1; w < WEEKS; w++) c.vline(w * 7, { color: 'rgba(185,160,115,0.06)', dash: [] });
    series.forEach((ys, k) => c.line(hist.map(h => h.day), ys, { color: VILLAGE_COLORS[k], width: k === selected ? 2.4 : 1.4, alpha: k === selected ? 1 : 0.75 }));
  }, x => {
    const d = Math.round(x);
    if (d < 1 || d > hist.length) return null;
    return [{ text: `Day ${d} (week ${Math.ceil(d / 7)})` }, ...world.villages.map((v, k) => ({ text: `${v.name.padEnd(15)} ${series[k][d - 1].toFixed(1)}`, color: VILLAGE_COLORS[k] }))];
  });
}

function renderFeed() {
  html('g-feed', world.log.slice().reverse().map(l => `<div><span class="wk">W${String(l.week).padStart(2, '0')}</span><span class="${l.cls}">${l.msg}</span></div>`).join(''));
}

async function advance() {
  if (!world || world.over || animating) return;
  const orders = [];
  world.policy.forEach((p, k) => { const on = Object.keys(ACTIONS).filter(a => p[a]).map(a => ACTIONS[a].label.toLowerCase()); if (on.length) orders.push(`${world.villages[k].name}: ${on.join(', ')}`); });
  if (world.treatment) orders.push('valley-wide treatment');
  world.log.push({ week: world.week + 1, cls: 'act', msg: orders.length ? `Orders: ${orders.join(' · ')}` : 'No orders given this week.' });
  const before = world.day;
  const wasVaccineLocked = !actionAvailable(world, 'vaccine');
  const over = playWeek(world);
  if (world.budgetWarning) {
    world.budgetWarning = false;
    const last = world.log.filter(l => l.msg.startsWith('Budget warning')).at(-1);
    if (last) toast(last.msg, 10000);
  }
  animating = true;
  renderSidebar(); renderFeed();
  // Animate the week day by day
  for (let d = before + 1; d <= world.day; d++) {
    shownDay = d;
    renderChart();
    text('g-day', `Day ${d}`);
    await new Promise(r => setTimeout(r, 110));
  }
  animating = false;
  shownDay = world.day;
  const wk = world.history.slice(-7);
  const rep = wk.reduce((s, h) => s + h.reported.reduce((a, b) => a + b, 0), 0);
  const dth = wk.reduce((s, h) => s + h.newDeaths.reduce((a, b) => a + b, 0), 0);
  world.log.push({ week: world.week, cls: dth > 0 ? 'alert' : '', msg: `Week ${world.week} report: ${rep} new cases reported, ${dth} deaths.` });
  if (wasVaccineLocked && actionAvailable(world, 'vaccine')) world.log.push({ week: world.week + 1, cls: 'ok', msg: 'The licensed vaccine has arrived from the Sporeford lab. Vaccination campaigns are now available.' });
  if (world.week === COMPASSIONATE_WEEK && !state.treatment) world.log.push({ week: world.week + 1, cls: 'ev', msg: 'Volvarin is available for compassionate use, but nobody knows whether it works. Run the trial in mode III.' });
  renderAll();
  if (over) { world.log.sort((a, b) => a.week - b.week); renderFeed(); await finish(); }
}

async function finish() {
  const box = $('#g-summary');
  box.classList.add('show');
  box.innerHTML = `<div class="panel-title">AFTER-ACTION REPORT</div><div style="color:var(--muted);font-size:11px;margin-top:6px">Replaying the valley 30 times without your interventions…</div>`;
  const cf = await defer(() => counterfactual(world, 30));
  const t = totals(world);
  const gr = grade(t.deaths, cf.deaths.median);
  const saved = Math.max(0, cf.deaths.median - t.deaths);
  const h = world.hidden;
  box.innerHTML = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center">
      <div style="text-align:center"><div class="grade" style="color:${{ S: '#e0c060', A: 'var(--green-bright)', B: 'var(--teal)', C: 'var(--amber)', D: 'var(--red-bright)' }[gr.letter]}">${gr.letter}</div><div class="panel-sub">GRADE</div></div>
      <div>
        <div class="panel-title">After-action report · ${world.difficulty.toUpperCase()}</div>
        <div style="font-size:11px;margin-top:4px;line-height:1.7">${gr.note}<br>
        The true pathogen: <em>R₀ = ${h.R0}</em>, latent ${h.latent} d, infectious ${h.infectious} d, CFR ${(h.cfr * 100).toFixed(1)}%. It started in <em>${world.villages[world.seedVillage].name}</em>.</div>
      </div>
    </div>
    <div class="kpi-row" style="margin-top:12px">
      <div class="stat-box"><div class="stat-v" style="color:var(--D)">${fmt.int(t.deaths)}</div><div class="stat-l">deaths under your command</div></div>
      <div class="stat-box"><div class="stat-v">${fmt.int(cf.deaths.median)}</div><div class="stat-l">deaths with no action (90%: ${fmt.int(cf.deaths.lo)}–${fmt.int(cf.deaths.hi)})</div></div>
      <div class="stat-box"><div class="stat-v" style="color:var(--green-bright)">${fmt.int(saved)}</div><div class="stat-l">lives saved (median)</div></div>
      <div class="stat-box"><div class="stat-v">${fmt.int(t.infections)}</div><div class="stat-l">true infections (reported: ${fmt.int(t.reported)}, ${fmt.pct(t.reported / Math.max(1, t.infections), 0)})</div></div>
      <div class="stat-box"><div class="stat-v" style="color:#b9a2e6">${world.spent.toFixed(0)}</div><div class="stat-l">credits spent of ${world.budget + (world.events.some(e => e.type === 'grant' && e.week <= world.week) ? 25 : 0)}</div></div>
      <div class="stat-box"><div class="stat-v" style="color:var(--V)">${fmt.int(t.vaccinated)}</div><div class="stat-l">protected by vaccine</div></div>
    </div>
    <div class="panel" style="margin-top:12px">
      <div class="panel-head"><div><div class="panel-title">What you saw vs what was true</div><div class="panel-sub">true network Rₜ = spectral radius of the next-generation matrix · blue = your Cori estimate from reported cases</div></div></div>
      <div class="canvas-wrap short"><canvas id="g-summary-chart"></canvas></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-violet" style="width:auto;padding:8px 16px" id="g-again">⟳ PLAY AGAIN</button></div>`;
  $('#g-again').addEventListener('click', () => newGame());
  state.log.push({ mode: 'response', grade: gr.letter, deaths: t.deaths, cf: cf.deaths.median });
  summaryChart = new Chart($('#g-summary-chart'));
  const hist = world.history;
  const daily = [0, ...hist.map(x => x.reported.reduce((a, b) => a + b, 0))];
  const rt = coriRt(daily, generationInterval(h.latent, h.infectious, 40), 7);
  const ymax = Math.min(6, niceMax(Math.max(2, ...hist.map(x => x.Rt), ...rt.map(r => r.hi)) * 1.05));
  summaryChart.render(c => {
    c.axes({ xMin: 0, xMax: hist.length, yMin: 0, yMax: ymax, xFmt: v => 'w' + Math.round(v / 7), yFmt: v => v.toFixed(1), xTicks: 5, yTicks: 4, yLabel: 'Rₜ' });
    c.band(rt.map(r => r.t), rt.map(r => r.lo), rt.map(r => r.hi), { color: 'rgba(74,159,216,0.18)' });
    c.line(rt.map(r => r.t), rt.map(r => r.mean), { color: COLORS.guess, width: 1.8 });
    c.line(hist.map(x => x.day), hist.map(x => x.Rt), { color: COLORS.truth, width: 2 });
    c.hline(1, { color: alpha(COLORS.I, 0.6), label: 'Rₜ = 1' });
  }, x => {
    const d = Math.round(x);
    const hh = hist[d - 1]; const r = rt.find(q => q.t === d);
    if (!hh) return null;
    return [{ text: `Day ${d}` }, { text: `true Rₜ ${hh.Rt.toFixed(2)}`, color: COLORS.truth }, r ? { text: `Cori ${r.mean.toFixed(2)}`, color: COLORS.guess } : null].filter(Boolean);
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
