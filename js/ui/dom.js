// Tiny DOM helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Bind a range slider to a value label.
 * @returns getter for the current numeric value
 */
export function slider(id, fmt, onInput) {
  const el = document.getElementById(id);
  const lab = document.getElementById(id + '-val');
  const update = () => { if (lab) lab.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', () => { update(); onInput?.(parseFloat(el.value)); });
  update();
  const get = () => parseFloat(el.value);
  get.set = v => { el.value = v; update(); };
  get.el = el;
  return get;
}

export const fmt = {
  int: v => Math.round(v).toLocaleString('en-US'),
  pct: (v, d = 1) => (v * 100).toFixed(d) + '%',
  num: (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d)),
  p: v => (v < 0.001 ? '< 0.001' : v.toFixed(3)),
  days: v => (v === null || v === undefined || !isFinite(v) ? '—' : `${Math.round(v)} d`),
};

export function html(el, s) { (typeof el === 'string' ? document.getElementById(el) : el).innerHTML = s; }
export function text(el, s) { (typeof el === 'string' ? document.getElementById(el) : el).textContent = s; }

/** Wire up a tab strip: buttons with data-tab, calls onChange(name). */
export function tabs(container, onChange) {
  const btns = $$('[data-tab]', container);
  let current = btns.find(b => b.classList.contains('on'))?.dataset.tab ?? btns[0]?.dataset.tab;
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.toggle('on', x === b));
    current = b.dataset.tab;
    onChange(current);
  }));
  return () => current;
}

export function downloadCSV(filename, header, rows) {
  const esc = v => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Run expensive work after the browser paints a "working…" state. */
export function defer(fn) { return new Promise(res => requestAnimationFrame(() => setTimeout(() => res(fn()), 0))); }

export function renderTeX(el, tex, display = false) {
  if (typeof katex === 'undefined') { el.textContent = tex; return; }
  try { katex.render(tex, el, { displayMode: display, throwOnError: false, output: 'mathml' }); } catch { el.textContent = tex; }
}
