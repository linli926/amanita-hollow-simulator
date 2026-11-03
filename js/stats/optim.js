// Numerical optimisation and small linear-algebra helpers.

/**
 * Nelder–Mead downhill simplex minimiser (Nelder & Mead, 1965).
 * Standard coefficients: reflection 1, expansion 2, contraction 0.5, shrink 0.5.
 * @param {(x:number[])=>number} f  objective to minimise
 * @param {number[]} x0              starting point
 * @param {{step?:number|number[], maxIter?:number, tol?:number}} opts
 */
export function nelderMead(f, x0, opts = {}) {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 400 * n;
  const tol = opts.tol ?? 1e-8;
  const steps = Array.isArray(opts.step) ? opts.step : new Array(n).fill(opts.step ?? 0.25);

  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += steps[i];
    simplex.push(p);
  }
  let values = simplex.map(safe);
  let evals = n + 1, iter = 0;

  function safe(x) { const v = f(x); return Number.isFinite(v) ? v : 1e300; }

  for (; iter < maxIter; iter++) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map(i => simplex[i]);
    values = order.map(i => values[i]);

    const spread = Math.abs(values[n] - values[0]);
    if (spread <= tol * (Math.abs(values[0]) + tol)) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const along = (t) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1); const fr = safe(xr); evals++;

    if (fr < values[0]) {
      const xe = along(-2); const fe = safe(xe); evals++;
      if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr; values[n] = fr;
    } else {
      const outside = fr < values[n];
      const xc = along(outside ? -0.5 : 0.5); const fc = safe(xc); evals++;
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc; values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = safe(simplex[i]); evals++;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (values[i] < values[best]) best = i;
  return { x: simplex[best], fx: values[best], iterations: iter, evaluations: evals };
}

/** Golden-section search for the minimum of a unimodal 1-D function on [a, b]. */
export function goldenSection(f, a, b, tol = 1e-5, maxIter = 100) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < maxIter && Math.abs(b - a) > tol; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const x = (a + b) / 2;
  return { x, fx: f(x) };
}

/** Invert a small square matrix by Gauss–Jordan elimination with partial pivoting. */
export function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-14) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const pv = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const fct = A[r][col];
      if (fct === 0) continue;
      for (let j = 0; j < 2 * n; j++) A[r][j] -= fct * A[col][j];
    }
  }
  return A.map(row => row.slice(n));
}

export function matVec(M, v) { return M.map(row => row.reduce((s, m, j) => s + m * v[j], 0)); }

/** Dominant eigenvalue (spectral radius) of a non-negative matrix by power iteration. */
export function spectralRadius(M, iters = 500, tol = 1e-12) {
  const n = M.length;
  let v = new Array(n).fill(1 / n), lambda = 0;
  for (let k = 0; k < iters; k++) {
    const w = matVec(M, v);
    const norm = w.reduce((s, x) => s + Math.abs(x), 0);
    if (norm === 0) return 0;
    const next = norm / v.reduce((s, x) => s + Math.abs(x), 0);
    v = w.map(x => x / norm);
    if (Math.abs(next - lambda) < tol * Math.max(1, next)) { lambda = next; break; }
    lambda = next;
  }
  return lambda;
}
