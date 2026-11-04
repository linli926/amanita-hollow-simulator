About
An interactive web-based epidemic modeling tool built to apply concepts from graduate biostatistics 
coursework (Infectious Disease Modeling and Survival Analysis) to simulated outbreak scenarios.

---

# Amanita Hollow — Epidemic Intelligence Terminal

**▶ Play online: https://linli926.github.io/amanita-hollow-simulator/**

An interactive outbreak game built on infectious-disease modelling and survival-analysis methods.

A flood has torn open a cavern beneath the valley of **Amanita Hollow**, releasing the spores of an unclassified *Amanita* species. You play five roles in turn:

| Mode | Role | You do | Under the hood |
|---|---|---|---|
| **I · Outbreak Architect** | the pathogen | Design R₀, latent and infectious periods, CFR, population and immunity, then watch the outbreak run deterministically or as a stochastic ensemble | SEIRD ODE (RK4), Gillespie SSA, tau-leaping, final-size equation, branching-process extinction, Euler–Lotka growth rate |
| **II · Field Epidemiologist** | the detective | Estimate R₀ and the reporting rate from noisy, incomplete clinic data. Wait for more data, auto-fit, forecast the peak, then reveal the truth | Negative-binomial likelihood, Nelder–Mead MLE, profile-likelihood CI with a misspecification adjustment, Poisson GLM (IRLS), Cori Rₜ |
| **III · Clinical Trial** | the biostatistician | Design and run a randomised trial of the antifungal *Volvarin*: sample size, accrual, follow-up, dropout | Weibull PH simulation, block randomisation, Kaplan–Meier + Greenwood, log-rank, Cox PH (Newton–Raphson), C-index, Nelson–Aalen, log(−log) PH check, Schoenfeld power + Monte Carlo power |
| **V · Vaccine Lab** | the study designer | Four core case studies in two blocks, observational designs and randomised trials (three advanced ones are implemented but hidden for now) | Confounding and Mantel–Haenszel stratification; case–control with logistic regression (IRLS) and the test-negative design; nested case–control (risk-set sampling, conditional logistic regression) vs case–cohort (Barlow-weighted Cox, robust variance) vs full cohort; reusing case–control data for a secondary outcome (IPW); ITT vs per-protocol vs as-treated vs CACE; group-sequential monitoring (Pocock, O'Brien–Fleming); simple vs block vs stratified randomisation; sample size and power for VE > 0 and for the licensure criterion (lower bound > 30%); Phase III trial with subgroup analysis and a CONSORT flow diagram |
| **IV · Outbreak Response** | the commander | Run a 20-week campaign across six villages on a budget: lockdowns, travel bans, test & isolate, vaccines, and treatment if your trial succeeded | Stochastic metapopulation SEIRD, gravity-model mobility, next-generation matrix Rₜ (power iteration), counterfactual replicates for grading |

**One story, one pathogen.** The modes follow a real outbreak response, and each step is a core biostatistics skill:

1. **Model** the epidemic (I): the pathogen you design here is the one used everywhere else.
2. **Estimate** R₀ from noisy surveillance data (II).
3. **Test** a treatment in a survival-analysis trial (III): *Volvarin*, a fictional existing antifungal being repurposed, against placebo, both on top of standard care, in hospitalised patients. The placebo-arm mortality is derived from your pathogen's case fatality ratio.
4. **Design** a vaccine trial that runs *during* the outbreak (V). Its placebo-arm attack rate is computed from your epidemic curve, so a trial that starts after the peak sees few cases and cannot reach its licensing criterion.
5. **Respond** (IV). Villagers can be vaccinated only after the Phase III trial licenses the vaccine, from the week of the licensing decision.

The modes are linked. The pathogen you release in I becomes the case file in II. A significant trial in III unlocks treatment in IV, with the true hazard ratio you set. A Phase III vaccine trial in V that meets the licensure criterion brings the vaccine to IV earlier (larger trials take longer to enrol), with its true population-average efficacy; otherwise only an unproven batch arrives in week 8.

## Names in the Hollow

Every place name is invented, and most are built from the anatomy of an *Amanita* mushroom combined with a common English place-name element. Put together, the villages are one mushroom scattered across the valley.

| Name | Mushroom part | Place-name element | In the game |
|---|---|---|---|
| **Amanita Hollow** | *Amanita*, the genus of the fly agaric and the death cap | *hollow*, a small valley | the valley itself |
| **Sporeford** | spore | *-ford*, a river crossing | market town, transport hub, the only hospital |
| **Gill's Crossing** | gills, the thin plates under the cap | *crossing* | river ford and trading post |
| **Ringmere** | ring (annulus), the skirt on the stem | *-mere*, Old English for lake | lake village |
| **Capstone** | cap (pileus) | *capstone*, a top stone | quarry town in the hills |
| **Veil Hollow** | veil, the membrane around a young mushroom | *hollow* | remote hamlet by the cavern mouth |
| **Mossbank** | moss (not a mushroom part) | *bank*, a slope or riverbank | farming village on the western slope |
| **Volvarin** | volva, the cup at the base of an *Amanita* stem | drug-name suffix *-in* | the repurposed antifungal tested in mode III |

## Run it

> The original single-file prototype (v0) is kept unchanged as [`amanita-hollow.html`](amanita-hollow.html). It still opens by double-clicking. The upgraded app (v1) is `index.html`.

It is plain static HTML with ES modules: no build step and no dependencies. ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It also works as-is on GitHub Pages (Settings → Pages → deploy from branch).

## Tests

All the maths lives in DOM-free modules covered by 43 unit tests:

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
- **Study design**: the Mantel–Haenszel RR recovers a common RR under Simpson's paradox; the two-proportion sample size reproduces the textbook 2,319 per arm (p₀ = 2%, p₁ = 1%, 80% power); simulated VE trials match analytic power; the case–control and test-negative estimates recover the true VE, while crude observational estimates are biased.
- **Epidemiological designs**: logistic regression reproduces the 2×2 OR and Woolf SE; conditional logistic regression gives the McNemar OR b/c; nested case–control and case–cohort recover the full-cohort hazard ratio; IPW recovers the population OR for a secondary outcome; CACE recovers complier efficacy while per-protocol is biased; naive testing at 5 looks gives the textbook 14% type I error, Pocock and O'Brien–Fleming hold 5%.
- **The game engine is reproducible** (same seed gives the same campaign), conserves population, and interventions beat the counterfactual.

### Validation of the Vaccine Lab experiments

`tests/validation.test.mjs` repeats each study many times and compares the estimates with the known truth of the simulation:

| Experiment | Analysis | Bias (VE points) | 95% CI coverage |
|---|---|---|---|
| Confounding (true VE 60%, 300 studies) | Randomised trial | +0.2 | 95.7% |
| | MH, adjusted for age + caution | 0.0 | 96.7% |
| | Crude observational | −3.5 | 85.3% |
| | MH, age only (caution unmeasured) | +7.5 | 57.3% |
| Case–control (true VE 60%, 200 studies) | Full cohort, MH age-adjusted | 0.0 | 95.5% |
| | Case–control 1:4, logistic, age-adjusted | +0.9 | 95.5% |
| | Test-negative, logistic, age-adjusted | +0.7 | 96.5% |
| | Case–control, crude OR | −11.5 | 27.5% |
| | Clinic-confirmed cohort (detection bias) | −13.3 | 35.5% |
| Phase III (ITT estimand 68.3%, 400 trials) | ITT risk ratio | −0.2 | 96.3% |

Analytic power for the licensure criterion (lower bound > 30%) agrees with simulation to within 1–3 points (e.g. 90.0% vs 91.2% at 2,869 per arm). The log-RR normal approximation is slightly conservative when few cases are expected.

The Phase III estimand needs care: 2% of the vaccine arm never receives the injection, so ITT estimates 0.98 × the population-average efficacy among the vaccinated, and efficacy is lower in residents aged 65+.

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
    design.js         2×2 measures, Mantel–Haenszel, case–control & test-negative, randomisation, sample size
    regression.js     logistic (weighted, robust), conditional logistic, counting-process Cox with robust SE
    sampling.js       nested case–control, case–cohort, secondary-outcome reuse
    trials.js         non-compliance (ITT/PP/AT/CACE), group-sequential boundaries
  models/
    ode.js            SEIRD(V) with RK4
    stochastic.js     Gillespie, tau-leap, ensembles, metapopulation, NGM
    theory.js         final size, HIT, growth rate, extinction, generation interval
    world.js          Outbreak Response game engine
  ui/                 canvas chart layer, valley map, DOM helpers
  modes/              architect.js, field.js, trial.js, lab*.js, response.js
tests/                node:test unit tests
```


## 简介（中文）

**蘑菇谷**是一个传染病建模、生存分析和研究设计的互动项目，共五个模式：

1. **病原设计师**：SEIRD 模型（RK4 积分）、Gillespie 随机模拟、最终规模方程、分支过程灭绝概率
2. **现场流行病学家**：从带噪声的漏报数据中估计 R₀，方法包括负二项似然、Nelder–Mead 极大似然、profile likelihood 置信区间、Poisson GLM 和 Cori 实时 Rₜ
3. **临床试验**：Kaplan–Meier、log-rank 检验、Cox 回归、Schoenfeld 样本量和模拟功效
4. **疫苗实验室**：四个研究设计案例，分两部分：观察性研究（混杂与随机化、病例对照与 logistic 回归）和随机对照试验（随机化与样本量、III 期试验与 CONSORT 流程图）
5. **疫情指挥**：六个村庄组成的元种群随机模型，有限预算下做干预决策；用下一代矩阵计算真实 Rₜ，最后和「不干预」的反事实模拟对比打分

原始的单文件版本（v0）原样保留为 `amanita-hollow.html`，双击即可打开；升级后的版本（v1）是 `index.html`。

所有模式互相联动：模式一释放的病原就是模式二要调查的案件，模式三的试验显著后，模式四才能使用治疗。

### 地名彩蛋

所有地名都是虚构的，大多由**鹅膏菌的身体部位**加上**英语地名的常见词根**组成。把地图上的村庄连起来看，就像把一朵鹅膏菌拆开、散落在山谷里：

- **Amanita Hollow（蘑菇谷）**：Amanita（鹅膏菌属，包括毒蝇伞和死帽菌）+ hollow（山谷）
- **Sporeford**：spore（孢子）+ -ford（渡口，如 Oxford）。镇中心，有全谷唯一的医院
- **Gill's Crossing**：gill（菌褶）+ crossing（渡口）
- **Ringmere**：ring（菌环）+ -mere（古英语的「湖」）
- **Capstone**：cap（菌盖）+ capstone（顶石）
- **Veil Hollow**：veil（菌幕）+ hollow（山谷），离孢子源头的洞穴最近
- **Mossbank**：moss（苔藓，不是蘑菇部位）+ bank（坡地）
- **Volvarin**（模式三的药）：volva（菌托，鹅膏菌菌柄底部的杯状结构）

*Amanita Hollow is fictional. All outbreaks, patients and villages are simulated.*
