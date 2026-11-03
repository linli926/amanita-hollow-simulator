# Amanita Hollow — Epidemic Intelligence Terminal

An interactive outbreak game built on infectious-disease modelling and survival-analysis methods.

A flood has torn open a cavern beneath the valley of **Amanita Hollow**, releasing the spores of an unclassified *Amanita* species. You play four roles in turn:

| Mode | Role | You do | Under the hood |
|---|---|---|---|
| **I · Outbreak Architect** | the pathogen | Design R₀, latent and infectious periods, CFR, population and immunity, then watch the outbreak run deterministically or as a stochastic ensemble | SEIRD ODE (RK4), Gillespie SSA, tau-leaping, final-size equation, branching-process extinction, Euler–Lotka growth rate |
| **II · Field Epidemiologist** | the detective | Estimate R₀ and the reporting rate from noisy, incomplete clinic data. Wait for more data, auto-fit, forecast the peak, then reveal the truth | Negative-binomial likelihood, Nelder–Mead MLE, profile-likelihood CI with a misspecification adjustment, Poisson GLM (IRLS), Cori Rₜ |
| **III · Clinical Trial** | the biostatistician | Design and run a randomised trial of the antifungal *Volvarin*: sample size, accrual, follow-up, dropout | Weibull PH simulation, block randomisation, Kaplan–Meier + Greenwood, log-rank, Cox PH (Newton–Raphson), C-index, Nelson–Aalen, log(−log) PH check, Schoenfeld power + Monte Carlo power |
| **IV · Outbreak Response** | the commander | Run a 20-week campaign across six villages on a budget: lockdowns, travel bans, test & isolate, vaccines, and treatment if your trial succeeded | Stochastic metapopulation SEIRD, gravity-model mobility, next-generation matrix Rₜ (power iteration), counterfactual replicates for grading |

The modes are linked. The pathogen you release in I becomes the case file in II. A significant trial in III unlocks treatment in IV, and the treatment's effect there equals the true hazard ratio you set.

## Run it

It is plain static HTML with ES modules: no build step and no dependencies. ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It also works as-is on GitHub Pages (Settings → Pages → deploy from branch).

## Tests

All the maths lives in DOM-free modules covered by 29 unit tests:

```bash
npm test
```

They require Node 18 or newer and no installs. Among other things they check:

- **KM, log-rank and Cox against textbook values** (Gehan 6-MP leukaemia data): Ŝ(23) = 0.4482, log-rank χ² = 16.79, Cox β = −1.509 (SE 0.410).
- **Schoenfeld**: HR 0.7 at 80% power needs 247 events; simulated power agrees with the formula.
- **ODE attack rates match the final-size equation**, and the ODE growth rate matches Wallinga–Lipsitch.
- **Gillespie and tau-leap reproduce the deterministic final size**; the minor-outbreak probability matches (1/R₀)^I₀.
- **The metapopulation NGM reduces to R₀** for a single patch and for identical coupled patches.
- **The MLE recovers R₀ and ρ** from simulated data, and the profile CI covers the truth.
- **The game engine is reproducible** (same seed gives the same campaign), conserves population, and interventions beat the counterfactual.

### A note on confidence-interval coverage

In mode II the data come from a *stochastic* epidemic, but the likelihood uses the deterministic ODE mean. Residuals are therefore over-dispersed and autocorrelated, and the textbook profile interval (cut-off 3.84) is too narrow: about 70% empirical coverage for a nominal 95% in a simulation study of 120 outbreaks. The app scales the cut-off by ĉ = max(1, φ̂·(1+r̂₁)/(1−r̂₁)), a quasi-likelihood dispersion with an AR(1) correction, which brings coverage to about 88–93%. The fully principled fix would be a likelihood for the stochastic model itself (particle filtering / pMCMC), which is a natural next step.

## Project layout

```
index.html            page shell for all four modes
css/style.css
js/
  main.js             routing between modes, toasts, KaTeX
  state.js            cross-mode state (released outbreak, approved treatment)
  stats/
    rng.js            seedable PRNG (Mulberry32) + Poisson (PTRS), binomial, gamma, NB…
    dist.js           normal/χ²/gamma CDFs & quantiles, log-gamma, NB pmf
    optim.js          Nelder–Mead, golden section, Gauss–Jordan, power iteration
    inference.js      NB-SEIR likelihood, MLE, profile CI, Poisson GLM (IRLS), Cori Rt
    survival.js       KM, Nelson–Aalen, log-rank, Cox PH, C-index, Schoenfeld, trial simulator
  models/
    ode.js            SEIRD(V) with RK4
    stochastic.js     Gillespie, tau-leap, ensembles, metapopulation, NGM
    theory.js         final size, HIT, growth rate, extinction, generation interval
    world.js          Outbreak Response game engine
  ui/                 canvas chart layer, valley map, DOM helpers
  modes/              architect.js, field.js, trial.js, response.js
tests/                node:test unit tests
```

## References

- Kermack & McKendrick (1927). A contribution to the mathematical theory of epidemics. *Proc R Soc A*.
- Gillespie (1977). Exact stochastic simulation of coupled chemical reactions. *J Phys Chem*.
- Diekmann, Heesterbeek & Metz (1990). On the definition and computation of R₀. *J Math Biol*.
- Wallinga & Lipsitch (2007). How generation intervals shape the relationship between growth rates and reproductive numbers. *Proc R Soc B*.
- Cori, Ferguson, Fraser & Cauchemez (2013). A new framework and software to estimate time-varying reproduction numbers. *Am J Epidemiol*.
- Nelder & Mead (1965). A simplex method for function minimization. *Comput J*.
- Kaplan & Meier (1958); Greenwood (1926); Mantel (1966); Cox (1972); Harrell et al. (1982); Schoenfeld (1983).
- Xia, Bjørnstad & Grenfell (2004). Measles metapopulation dynamics: a gravity model for epidemiological coupling. *Am Nat*.

## 简介（中文）

**蘑菇谷**是一个传染病建模和生存分析的互动游戏，共四个模式：

1. **病原设计师**：SEIRD 模型（RK4 积分）、Gillespie 随机模拟、最终规模方程、分支过程灭绝概率
2. **现场流行病学家**：从带噪声的漏报数据中估计 R₀，方法包括负二项似然、Nelder–Mead 极大似然、profile likelihood 置信区间、Poisson GLM 和 Cori 实时 Rₜ
3. **临床试验**：Kaplan–Meier、log-rank 检验、Cox 回归、Schoenfeld 样本量和模拟功效
4. **疫情指挥**：六个村庄组成的元种群随机模型，有限预算下做干预决策；用下一代矩阵计算真实 Rₜ，最后和「不干预」的反事实模拟对比打分

所有模式互相联动：模式一释放的病原就是模式二要调查的案件，模式三的试验显著后，模式四才能使用治疗。

*Amanita Hollow is fictional. All outbreaks, patients and villages are simulated.*
