// Canvas map of Amanita Hollow for the Outbreak Response game.

export const VILLAGE_COLORS = ['#e0a458', '#6b9bb8', '#c46b8a', '#7fb069', '#b39ddb', '#d9d27e'];

const BADGES = [
  ['lockdown', 'LCK', '#c0392b'],
  ['travel', 'BAN', '#d08b3a'],
  ['test', 'TST', '#4a9fd8'],
  ['vaccine', 'VAX', '#8a6cc0'],
];

export class ValleyMap {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.hover = -1;
    canvas.addEventListener('click', e => {
      const k = this.hit(e);
      if (k >= 0) onSelect(k);
    });
    canvas.addEventListener('mousemove', e => {
      const k = this.hit(e);
      if (k !== this.hover) { this.hover = k; canvas.style.cursor = k >= 0 ? 'pointer' : 'default'; }
    });
  }

  pos(v) {
    return { x: 36 + v.x * (this.W - 72), y: 30 + v.y * (this.H - 64) };
  }

  radius(v) { return 9 + Math.sqrt(v.N) / 6.5; }

  hit(e) {
    if (!this.world) return -1;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = Infinity;
    this.world.villages.forEach((v, k) => {
      const p = this.pos(v);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < this.radius(v) + 14 && d < bd) { bd = d; best = k; }
    });
    return best;
  }

  /**
   * @param world     game world
   * @param view      { selected, upToDay, time }
   */
  draw(world, view) {
    this.world = world;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.parentElement.clientWidth, H = c.parentElement.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = W; this.H = H;
    const t = view.time / 1000;

    // Terrain
    const g = ctx.createRadialGradient(W * 0.5, H * 0.55, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#0f1613'); g.addColorStop(1, '#060809');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 7; i++) {
      ctx.strokeStyle = `rgba(120,140,110,${0.05 + 0.012 * i})`;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.08) {
        const rr = (0.12 + i * 0.075) * (1 + 0.08 * Math.sin(3 * a + i) + 0.05 * Math.cos(5 * a - i * 0.7));
        const x = W * 0.5 + Math.cos(a) * rr * W * 0.62, y = H * 0.52 + Math.sin(a) * rr * H * 0.72;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // River and lake
    ctx.strokeStyle = 'rgba(74,127,168,0.35)'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(W * 0.02, H * 0.08);
    ctx.bezierCurveTo(W * 0.3, H * 0.2, W * 0.42, H * 0.38, W * 0.56, H * 0.44);
    ctx.bezierCurveTo(W * 0.7, H * 0.5, W * 0.72, H * 0.2, W * 0.98, H * 0.18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(74,127,168,0.16)';
    ctx.beginPath(); ctx.ellipse(W * 0.24, H * 0.88, W * 0.09, H * 0.06, -0.2, 0, Math.PI * 2); ctx.fill();
    // Cavern
    ctx.fillStyle = 'rgba(192,57,43,0.6)'; ctx.font = '12.5px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('✶ the cavern', W * 0.025, H * 0.47);

    const hist = world.history.slice(0, view.upToDay);
    const recent = hist.slice(-7);
    const weekly = world.villages.map((v, k) => recent.reduce((s, h) => s + h.reported[k], 0));
    const intensity = world.villages.map((v, k) => weekly[k] / v.N * 1000); // per 1,000 per week
    const lastDay = hist.at(-1);

    // Roads
    const C = world._C;
    const K = world.villages.length;
    for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
      const w = C ? Math.max(C[a][b], C[b][a]) : 0.01;
      if (w < 0.004) continue;
      const pa = this.pos(world.villages[a]), pb = this.pos(world.villages[b]);
      const banned = world.policy[a].travel || world.policy[b].travel;
      ctx.strokeStyle = banned ? 'rgba(208,139,58,0.35)' : `rgba(201,186,160,${Math.min(0.35, 0.08 + w * 4)})`;
      ctx.lineWidth = Math.min(4, 0.6 + w * 60);
      ctx.setLineDash(banned ? [4, 5] : []);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.setLineDash([]);
      // Spores drifting along roads from infected villages
      for (const [src, dst, ps, pd] of [[a, b, pa, pb], [b, a, pb, pa]]) {
        const n = Math.min(4, Math.ceil(intensity[src] / 3));
        if (!n || banned) continue;
        for (let i = 0; i < n; i++) {
          const f = ((t * 0.12 + i / n + src * 0.13 + dst * 0.07) % 1);
          ctx.fillStyle = `rgba(192,57,43,${0.55 * Math.sin(Math.PI * f)})`;
          ctx.beginPath(); ctx.arc(ps.x + (pd.x - ps.x) * f, ps.y + (pd.y - ps.y) * f, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Villages
    world.villages.forEach((v, k) => {
      const p = this.pos(v), r = this.radius(v);
      const inten = intensity[k];
      const col = heat(inten);
      if (inten > 0.2) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3 + k);
        const glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * (1.8 + 0.5 * pulse));
        glow.addColorStop(0, `rgba(192,57,43,${Math.min(0.45, inten / 25)})`); glow.addColorStop(1, 'rgba(192,57,43,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = VILLAGE_COLORS[k]; ctx.lineWidth = 1.5;
      ctx.stroke();
      if (world.policy[k].lockdown) {
        ctx.strokeStyle = 'rgba(192,57,43,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (view.selected === k || this.hover === k) {
        ctx.strokeStyle = view.selected === k ? '#f3ead7' : 'rgba(232,220,196,0.4)'; ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      // Weekly reported incidence in the circle
      ctx.fillStyle = '#fbf3e3'; ctx.font = '13px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(weekly[k]), p.x, p.y + 4);
      // Labels
      ctx.font = '14px "Special Elite", serif'; ctx.fillStyle = '#f3ead7';
      ctx.fillText(v.name, p.x, p.y + r + 20);
      ctx.font = '11.5px "IBM Plex Mono", monospace'; ctx.fillStyle = '#a6977f';
      ctx.fillText(`pop ${v.N.toLocaleString('en-US')} · ${inten.toFixed(1)}/1k`, p.x, p.y + r + 35);
      // Badges
      const on = BADGES.filter(([key]) => world.policy[k][key]);
      const bw = 32, gap = 3, total = on.length * bw + (on.length - 1) * gap;
      on.forEach(([, lab, bc], i) => {
        const bx = p.x - total / 2 + i * (bw + gap), by = p.y - r - 18;
        ctx.fillStyle = 'rgba(6,8,10,0.85)'; ctx.fillRect(bx, by - 2, bw, 15);
        ctx.strokeStyle = bc; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by - 1.5, bw - 1, 14);
        ctx.fillStyle = bc; ctx.font = '10.5px "IBM Plex Mono", monospace'; ctx.fillText(lab, bx + bw / 2, by + 9);
      });
      if (lastDay?.overloaded?.[k]) {
        ctx.fillStyle = '#d0473a'; ctx.font = '11.5px "IBM Plex Mono", monospace';
        ctx.fillText("⚠ WARDS FULL", p.x, p.y + r + 49);
      }
    });

    // Legend
    ctx.textAlign = 'left'; ctx.font = '11.5px "IBM Plex Mono", monospace';
    const lx = W - 150, ly = H - 22;
    ctx.fillStyle = '#a6977f'; ctx.fillText('reported / 1k / wk', lx, ly - 6);
    for (let i = 0; i <= 20; i++) { ctx.fillStyle = heat(i / 20 * 12); ctx.fillRect(lx + i * 6, ly, 6, 6); }
    ctx.fillStyle = '#a6977f'; ctx.fillText('0', lx, ly + 16); ctx.textAlign = 'right'; ctx.fillText('12+', lx + 126, ly + 16);
  }
}

/** Colour ramp: calm moss → amber → blood red. */
export function heat(v) {
  const f = Math.max(0, Math.min(1, v / 12));
  const stops = [[0, [38, 56, 44]], [0.25, [150, 120, 40]], [0.6, [192, 80, 40]], [1, [170, 30, 30]]];
  let i = 0;
  while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const [f0, c0] = stops[i], [f1, c1] = stops[i + 1];
  const u = (f - f0) / (f1 - f0);
  const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
