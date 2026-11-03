// Shared cross-mode state: what happened in one mode unlocks content in another.

const listeners = new Set();

export const state = {
  /** Set by Outbreak Architect when a pathogen is released. */
  outbreak: null,          // { R0, latent, infectious, cfr, N, I0, immune, seed }
  /** Set by Clinical Trial when the treatment shows a significant benefit. */
  treatment: null,         // { trueHR, estHR, lo, hi, p }
  /** Score history across modes. */
  log: [],
};

export function update(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
