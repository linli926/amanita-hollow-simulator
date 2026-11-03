// Special functions and probability distributions (CDFs, quantiles).
// Pure functions, no DOM — unit tested in tests/.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x) via the Lanczos approximation (g = 7). */
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Error function (W. J. Cody rational approximation via erfc, |err| < 1.2e-7). */
export function erf(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r : r - 1;
}

export function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

/** Standard normal quantile (Acklam's algorithm, rel. err < 1.2e-9 after one Halley step). */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r, x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // One Halley refinement step
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/** Regularized lower incomplete gamma P(a, x). Series for x < a+1, continued fraction otherwise. */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}

function gammaQcf(a, x) {
  // Lentz's algorithm
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Upper tail of the chi-squared distribution: P(X > x), X ~ χ²(df). */
export function chi2Sf(x, df) {
  if (x <= 0) return 1;
  return Math.max(0, 1 - gammaP(df / 2, x / 2));
}

/** Gamma(shape, scale) CDF. */
export function gammaCdf(x, shape, scale) { return gammaP(shape, x / scale); }

/** Gamma(shape, scale) quantile via Wilson–Hilferty start + safeguarded Newton. */
export function gammaInv(p, shape, scale = 1) {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  const z = normInv(p);
  const c = 1 / (9 * shape);
  let x = shape * Math.pow(Math.max(1 - c + z * Math.sqrt(c), 0.01), 3);
  if (!(x > 0)) x = shape;
  let lo = 0, hi = Infinity;
  for (let i = 0; i < 100; i++) {
    const f = gammaP(shape, x) - p;
    if (Math.abs(f) < 1e-12) break;
    if (f > 0) hi = x; else lo = x;
    const pdf = Math.exp((shape - 1) * Math.log(x) - x - lgamma(shape));
    let nx = x - f / pdf;
    if (!(nx > lo && nx < hi) || !isFinite(nx)) nx = isFinite(hi) ? (lo + hi) / 2 : x * 2;
    if (Math.abs(nx - x) < 1e-12 * x) { x = nx; break; }
    x = nx;
  }
  return x * scale;
}

/** log pmf of the negative binomial with mean mu and dispersion k (variance mu + mu²/k). */
export function negBinLogPmf(y, mu, k) {
  if (mu <= 0) return y === 0 ? 0 : -1e6;
  return lgamma(y + k) - lgamma(k) - lgamma(y + 1) + k * Math.log(k / (k + mu)) + y * Math.log(mu / (k + mu));
}

export function poissonLogPmf(y, mu) {
  if (mu <= 0) return y === 0 ? 0 : -1e6;
  return y * Math.log(mu) - mu - lgamma(y + 1);
}

export function quantile(sortedArr, q) {
  const n = sortedArr.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (pos - lo);
}
