// Entry point: mode routing, shared UI services, KaTeX rendering.

import { initArchitect, enterArchitect } from './modes/architect.js';
import { initField, enterField } from './modes/field.js';
import { initTrial, enterTrial } from './modes/trial.js';
import { initResponse, enterResponse, leaveResponse } from './modes/response.js';
import { initLab, enterLab } from './modes/lab.js';
import { $, $$, renderTeX } from './ui/dom.js';
import { subscribe } from './state.js';

const MODES = {
  architect: enterArchitect,
  field: enterField,
  trial: enterTrial,
  lab: enterLab,
  response: enterResponse,
};

let toastTimer = 0;
/** Brief message at the bottom of the screen. Stays longer for longer messages; click to dismiss. */
function toast(msg, ms) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  const duration = ms ?? Math.max(6000, msg.length * 60);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

const banner = html => { $('#storyBanner').innerHTML = html; };

let current = null;
function setMode(mode, push = true) {
  if (!MODES[mode]) mode = 'architect';
  if (current === 'response' && mode !== 'response') leaveResponse();
  current = mode;
  $$('.mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + mode));
  if (push && location.hash !== '#' + mode) history.replaceState(null, '', '#' + mode);
  MODES[mode](banner);
  window.scrollTo({ top: 0 });
}

function renderEquations() {
  $$('[data-tex]').forEach(el => renderTeX(el, el.dataset.tex, el.dataset.display === '1'));
}

function boot() {
  const ctx = { toast, setMode };
  $('#toast').addEventListener('click', () => $('#toast').classList.remove('show'));
  initArchitect(ctx);
  initField(ctx);
  initTrial(ctx);
  initLab(ctx);
  initResponse(ctx);
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.goto)));
  window.addEventListener('hashchange', () => setMode(location.hash.slice(1), false));
  subscribe(s => {
    const tb = $('.mode-btn[data-mode="response"]');
    tb.innerHTML = '⌖ IV · OUTBREAK RESPONSE' + (s.treatment ? ' <span style="color:var(--green-bright)">✚</span>' : '');
  });
  setMode(location.hash.slice(1) || 'architect', false);
  // KaTeX loads with `defer`; render equations once it's there.
  const tryTeX = (n = 0) => { if (typeof katex !== 'undefined') renderEquations(); else if (n < 50) setTimeout(() => tryTeX(n + 1), 100); };
  tryTeX();
}

boot();
