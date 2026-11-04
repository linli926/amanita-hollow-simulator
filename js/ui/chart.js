// Minimal canvas charting layer with hover crosshair + tooltips.
// Each chart is redrawn by a user-supplied draw function so hover can re-render cheaply.

export const COLORS = {
  S: '#4a7fa8', E: '#d08b3a', I: '#c0392b', R: '#4a9c6a', D: '#9b7653', V: '#8a6cc0',
  obs: '#c9a227', fit: '#5fb3a1', guess: '#6b9bb8', truth: '#e0d3b8',
  treat: '#4a9c6a', control: '#c0392b',
  grid: 'rgba(214,190,140,0.13)', axis: 'rgba(214,190,140,0.75)', text: '#d9cdb6', muted: '#a6977f',
  bg: '#0c0f11',
};

export function alpha(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const FONT = '12.5px "IBM Plex Mono", ui-monospace, monospace';

export class Chart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.basePad = { top: 20, right: 20, bottom: 38, left: 60, ...(opts.pad || {}) };
    this.pad = { ...this.basePad };
    this.drawFn = null;
    this.tooltipFn = null;
    this.hoverPx = null;
    this.clickFn = null;
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.hoverPx = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.tooltipFn) this.redraw();
    });
    canvas.addEventListener('mouseleave', () => { this.hoverPx = null; if (this.tooltipFn) this.redraw(); });
    canvas.addEventListener('click', e => {
      if (!this.clickFn) return;
      const r = canvas.getBoundingClientRect();
      this.clickFn(e.clientX - r.left, e.clientY - r.top);
    });
    if (typeof ResizeObserver !== 'undefined') {
      let raf = 0;
      new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.redraw()); }).observe(canvas.parentElement);
    }
  }

  render(drawFn, tooltipFn = null) {
    this.drawFn = drawFn;
    this.tooltipFn = tooltipFn;
    this.redraw();
  }

  redraw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.parentElement.clientWidth, h = c.parentElement.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + 'px'; c.style.height = h + 'px';
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.ctx = ctx; this.W = w; this.H = h;
    this.pad = { ...this.basePad };
    this.pw = w - this.pad.left - this.pad.right;
    this.ph = h - this.pad.top - this.pad.bottom;
    this.scale = null;
    if (this.drawFn) this.drawFn(this);
    if (this.hoverPx && this.tooltipFn && this.scale) this.drawTooltip();
  }

  /** Configure scales and draw grid + tick labels. */
  axes(o) {
    if (o.pad) {
      Object.assign(this.pad, o.pad);
      this.pw = this.W - this.pad.left - this.pad.right;
      this.ph = this.H - this.pad.top - this.pad.bottom;
    }
    const s = {
      xMin: o.xMin ?? 0, xMax: o.xMax ?? 1, yMin: o.yMin ?? 0, yMax: o.yMax ?? 1,
      logY: !!o.logY, logX: !!o.logX,
    };
    if (s.xMax === s.xMin) s.xMax = s.xMin + 1;
    if (s.yMax === s.yMin) s.yMax = s.yMin + 1;
    this.scale = s;
    const { ctx, pad, pw, ph } = this;
    const xT = o.xTicks ?? 6, yT = o.yTicks ?? 5;
    const xFmt = o.xFmt ?? (v => Math.round(v)), yFmt = o.yFmt ?? (v => v.toFixed(1));
    ctx.font = FONT; ctx.lineWidth = 1;
    for (let i = 0; i <= yT; i++) {
      const v = s.yMin + (s.yMax - s.yMin) * i / yT;
      const y = this.Y(s.logY ? Math.exp(Math.log(s.yMin) + (Math.log(s.yMax) - Math.log(s.yMin)) * i / yT) : v);
      ctx.strokeStyle = COLORS.grid; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pw, y); ctx.stroke();
      ctx.fillStyle = COLORS.axis; ctx.textAlign = 'right';
      const lab = s.logY ? Math.exp(Math.log(s.yMin) + (Math.log(s.yMax) - Math.log(s.yMin)) * i / yT) : v;
      ctx.fillText(yFmt(lab), pad.left - 6, y + 3);
    }
    for (let i = 0; i <= xT; i++) {
      const frac = i / xT;
      const v = s.logX ? Math.exp(Math.log(s.xMin) + (Math.log(s.xMax) - Math.log(s.xMin)) * frac) : s.xMin + (s.xMax - s.xMin) * frac;
      const x = this.X(v);
      ctx.strokeStyle = COLORS.grid; ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke();
      ctx.fillStyle = COLORS.axis; ctx.textAlign = 'center';
      ctx.fillText(xFmt(v), x, pad.top + ph + 16);
    }
    if (o.xLabel) { ctx.fillStyle = COLORS.muted; ctx.textAlign = 'right'; ctx.fillText(o.xLabel, pad.left + pw, pad.top + ph + 32); }
    if (o.yLabel) {
      ctx.save(); ctx.translate(13, pad.top + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center'; ctx.fillText(o.yLabel, 0, 0); ctx.restore();
    }
  }

  X(v) {
    const s = this.scale;
    const f = s.logX ? (Math.log(v) - Math.log(s.xMin)) / (Math.log(s.xMax) - Math.log(s.xMin)) : (v - s.xMin) / (s.xMax - s.xMin);
    return this.pad.left + this.pw * f;
  }
  Y(v) {
    const s = this.scale;
    let f;
    if (s.logY) f = (Math.log(Math.max(v, s.yMin)) - Math.log(s.yMin)) / (Math.log(s.yMax) - Math.log(s.yMin));
    else f = (v - s.yMin) / (s.yMax - s.yMin);
    f = Math.max(-0.02, Math.min(1.02, f));
    return this.pad.top + this.ph * (1 - f);
  }
  invX(px) {
    const s = this.scale;
    const f = (px - this.pad.left) / this.pw;
    return s.logX ? Math.exp(Math.log(s.xMin) + f * (Math.log(s.xMax) - Math.log(s.xMin))) : s.xMin + f * (s.xMax - s.xMin);
  }

  clip(fn) {
    const { ctx, pad, pw, ph } = this;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.left, pad.top - 2, pw, ph + 4); ctx.clip();
    fn(); ctx.restore();
  }

  line(xs, ys, st = {}) {
    const { ctx } = this;
    this.clip(() => {
      ctx.strokeStyle = st.color ?? COLORS.text; ctx.lineWidth = st.width ?? 1.5;
      ctx.globalAlpha = st.alpha ?? 1;
      ctx.setLineDash(st.dash ?? []);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < xs.length; i++) {
        if (ys[i] === null || ys[i] === undefined || Number.isNaN(ys[i])) { started = false; continue; }
        const x = this.X(xs[i]), y = this.Y(ys[i]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
  }

  area(xs, ys, st = {}) { this.band(xs, xs.map(() => this.scale.logY ? this.scale.yMin : Math.max(0, this.scale.yMin)), ys, st); }

  band(xs, lo, hi, st = {}) {
    const { ctx } = this;
    this.clip(() => {
      ctx.fillStyle = st.color ?? 'rgba(200,200,200,0.1)';
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) { const x = this.X(xs[i]), y = this.Y(hi[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(this.X(xs[i]), this.Y(lo[i]));
      ctx.closePath(); ctx.fill();
    });
  }

  /** Right-continuous step function through points (ts[i], ys[i]); extended to tEnd. */
  step(ts, ys, st = {}, tEnd) {
    const xs = [], vs = [];
    for (let i = 0; i < ts.length; i++) {
      if (i > 0) { xs.push(ts[i]); vs.push(ys[i - 1]); }
      xs.push(ts[i]); vs.push(ys[i]);
    }
    if (tEnd !== undefined && tEnd > ts[ts.length - 1]) { xs.push(tEnd); vs.push(ys[ys.length - 1]); }
    this.line(xs, vs, st);
  }

  stepBand(ts, lo, hi, st = {}, tEnd) {
    const xs = [], l = [], h = [];
    for (let i = 0; i < ts.length; i++) {
      if (i > 0) { xs.push(ts[i]); l.push(lo[i - 1]); h.push(hi[i - 1]); }
      xs.push(ts[i]); l.push(lo[i]); h.push(hi[i]);
    }
    if (tEnd !== undefined && tEnd > ts[ts.length - 1]) { xs.push(tEnd); l.push(lo.at(-1)); h.push(hi.at(-1)); }
    this.band(xs, l, h, st);
  }

  bars(xs, ys, st = {}) {
    const { ctx } = this;
    const s = this.scale;
    const bw = Math.max(1, this.pw / ((s.xMax - s.xMin) || 1) * (st.widthFrac ?? 0.75));
    this.clip(() => {
      ctx.fillStyle = st.color ?? COLORS.obs;
      ctx.globalAlpha = st.alpha ?? 0.8;
      const y0 = this.Y(Math.max(s.yMin, 0));
      for (let i = 0; i < xs.length; i++) {
        if (!ys[i]) continue;
        const x = this.X(xs[i]), y = this.Y(ys[i]);
        ctx.fillRect(x - bw / 2, y, bw, y0 - y);
      }
      ctx.globalAlpha = 1;
    });
  }

  vline(x, st = {}) {
    const { ctx, pad, ph } = this;
    const px = this.X(x);
    ctx.strokeStyle = st.color ?? COLORS.axis; ctx.lineWidth = st.width ?? 1;
    ctx.setLineDash(st.dash ?? [4, 4]);
    ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + ph); ctx.stroke(); ctx.setLineDash([]);
    if (st.label) {
      ctx.font = FONT; ctx.fillStyle = st.color ?? COLORS.axis;
      ctx.textAlign = st.align ?? 'left';
      ctx.fillText(st.label, px + (st.align === 'right' ? -4 : 4), pad.top + (st.labelY ?? 10));
    }
  }

  hline(y, st = {}) {
    const { ctx, pad, pw } = this;
    const py = this.Y(y);
    ctx.strokeStyle = st.color ?? COLORS.axis; ctx.lineWidth = st.width ?? 1;
    ctx.setLineDash(st.dash ?? [4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + pw, py); ctx.stroke(); ctx.setLineDash([]);
    if (st.label) {
      ctx.font = FONT; ctx.fillStyle = st.color ?? COLORS.axis; ctx.textAlign = 'right';
      ctx.fillText(st.label, pad.left + pw - 4, py - 4);
    }
  }

  marks(xs, ys, st = {}) {
    const { ctx } = this;
    const sz = st.size ?? 4;
    this.clip(() => {
      ctx.strokeStyle = st.color ?? COLORS.obs; ctx.fillStyle = st.color ?? COLORS.obs; ctx.lineWidth = st.width ?? 1.3;
      for (let i = 0; i < xs.length; i++) {
        const x = this.X(xs[i]), y = this.Y(ys[i]);
        if (st.shape === 'dot') { ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill(); }
        else if (st.shape === 'tick') { ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x, y + sz); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(x - sz, y); ctx.lineTo(x + sz, y); ctx.moveTo(x, y - sz); ctx.lineTo(x, y + sz); ctx.stroke(); }
      }
    });
  }

  text(str, x, y, st = {}) {
    const { ctx } = this;
    ctx.font = st.font ?? FONT; ctx.fillStyle = st.color ?? COLORS.text; ctx.textAlign = st.align ?? 'left';
    ctx.fillText(str, st.px ? x : this.X(x), st.px ? y : this.Y(y));
  }

  /** Message shown when there's nothing to plot yet. */
  empty(msg) {
    const { ctx, W, H } = this;
    ctx.font = '14px "Special Elite", serif'; ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center';
    ctx.fillText(msg, W / 2, H / 2);
  }

  drawTooltip() {
    const { ctx, pad, pw, ph } = this;
    const { x: hx, y: hy } = this.hoverPx;
    if (hx < pad.left || hx > pad.left + pw || hy < pad.top || hy > pad.top + ph) return;
    const xv = this.invX(hx);
    const lines = this.tooltipFn(xv);
    if (!lines || !lines.length) return;
    ctx.strokeStyle = 'rgba(201,186,160,0.25)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = FONT;
    const w = Math.max(...lines.map(l => ctx.measureText(l.text).width)) + 16;
    const h = lines.length * 17 + 10;
    let bx = hx + 12, by = Math.max(pad.top, hy - h / 2);
    if (bx + w > pad.left + pw) bx = hx - 12 - w;
    if (by + h > pad.top + ph) by = pad.top + ph - h;
    ctx.fillStyle = 'rgba(8,10,12,0.93)'; ctx.strokeStyle = 'rgba(185,160,115,0.3)';
    ctx.fillRect(bx, by, w, h); ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color ?? COLORS.text; ctx.textAlign = 'left';
      ctx.fillText(l.text, bx + 9, by + 18 + i * 17);
    });
  }
}

/** Nice upper bound for an axis. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
