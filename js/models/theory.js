// Closed-form / semi-analytic results from mathematical epidemiology.

/** Herd immunity threshold 1 − 1/R₀. */
export function herdImmunityThreshold(R0) { return R0 > 1 ? 1 - 1 / R0 : 0; }

/**
 * Final-size equation for an SIR-type epidemic with
 * a fraction s0 initially susceptible:   z = s0 · (1 − e^{−R₀ z})
 * z is the fraction of the whole population infected during the epidemic.
 * Solved with Newton's method. Holds for SEIR / any latent period distribution.
 */
export function finalSize(R0, s0 = 1) {
  if (R0 * s0 <= 1 + 1e-9) return 0;
  let z = s0; // start from the upper bound; the map is concave so Newton converges monotonically
  for (let i = 0; i < 100; i++) {
    const g = z - s0 * (1 - Math.exp(-R0 * z));
    const dg = 1 - s0 * R0 * Math.exp(-R0 * z);
    const nz = z - g / dg;
    if (Math.abs(nz - z) < 1e-13) { z = nz; break; }
    z = nz;
  }
  return Math.max(0, z);
}

/**
 * Exponential growth rate r of an SEIR epidemic with exponential latent (L) and
 * infectious (D) periods, from the Euler–Lotka equation:
 *   R₀ = (1 + r L)(1 + r D)
 */
export function growthRateFromR0(R0, L, D) {
  if (L <= 0) return (R0 - 1) / D;
  const a = L * D, b = L + D, c = 1 - R0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function R0FromGrowthRate(r, L, D) {
  return (1 + r * L) * (1 + r * D);
}

export function doublingTime(r) { return r > 0 ? Math.log(2) / r : Infinity; }

/**
 * Probability that an introduction fizzles out (minor outbreak), from branching
 * process theory. With exponentially distributed infectious periods the offspring
 * distribution is geometric with mean R, whose extinction probability is 1/R.
 * With n independent initial infectives: q = (1/R)^n.
 */
export function extinctionProbability(Reff, n = 1) {
  if (Reff <= 1) return 1;
  return Math.pow(1 / Reff, n);
}

/**
 * Discretised generation-interval distribution for SEIR with exponential
 * latent (rate σ = 1/L) and infectious (rate γ = 1/D) periods.
 * The generation time is the sum Exp(σ) + Exp(γ) — a hypoexponential law with CDF
 *   F(t) = 1 − (γ e^{−σt} − σ e^{−γt}) / (γ − σ).
 * Returns w[s] = P(s−1 < T ≤ s) for s = 1..maxDays (w[0] = 0), normalised.
 */
export function generationInterval(L, D, maxDays = 40) {
  const g = 1 / D;
  let F;
  if (L <= 0) F = t => 1 - Math.exp(-g * t);
  else {
    const s = 1 / L;
    if (Math.abs(s - g) < 1e-9) F = t => 1 - Math.exp(-g * t) * (1 + g * t);
    else F = t => 1 - (g * Math.exp(-s * t) - s * Math.exp(-g * t)) / (g - s);
  }
  const w = [0];
  for (let k = 1; k <= maxDays; k++) w.push(F(k) - F(k - 1));
  const tot = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / tot);
}

export function meanOf(pmf) { return pmf.reduce((s, p, i) => s + i * p, 0); }
