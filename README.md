# Cohort — enrollment intelligence for clinical trials

> 80% of trials miss enrollment. Late-stage delays cost ~$55,000/day. Cohort
> finds the time before you lose it.

Cohort points at any trial on ClinicalTrials.gov and, in seconds:

1. **Forecasts enrollment** with a Monte-Carlo engine on real site + eligibility data,
2. **Optimizes which sites to open** — same site budget, better roster — and shows the months and dollars saved,
3. **Routes the plan for human sign-off**, with every decision written to a tamper-evident audit trail.

Built for the **Bay Builders Hackathon** · Track: **Vertical AI Company**.

---

## Why this matters

The industry poured billions into software that designs better molecules. The
bottleneck is getting those molecules *through the system*: ~80% of trials are
delayed by enrollment, and roughly **1 in 6 activated sites enrolls near zero
patients**. Site selection and enrollment forecasting are unglamorous
infrastructure — and exactly where the time and money die. Cohort is that
infrastructure layer.

---

## The wow, in one screen

For **CANOPY-1** (NCT03631199, real Novartis Phase-3 NSCLC trial, 152 sites, 673 patients):

| | Naive plan | Cohort optimized | |
|---|---|---|---|
| Site budget | 113 sites | 113 sites | *same investment* |
| Time to enroll | 44.8 months | **34.8 months** | **10 months faster** |
| | | | **≈ $16.8M saved** at $55K/day |

Same number of sites — Cohort just picks the *right* ones (high-rate, spread
across regions, avoiding the cold under-enrollers). Drag any site out and the
forecast + savings re-compute live.

---

## Architecture

Cohort is built as a stack of **sponsor-shaped layers**. Every layer runs on a
local fallback with zero keys and upgrades to the real sponsor API the moment
its key is present.

```
ClinicalTrials.gov v2 ──► Ingestion          real trials, sites, eligibility, geo
      │
      ├─ Nimble / You.com  ► Web intelligence  competitive landscape + patient-pool prevalence
      │
      ▼
  Site rate model  ─────► forecast-agent      interpretable per-site enrollment rate + rationale
      │                                        (cold-site tail models real under-enrollers)
      ▼
  Monte-Carlo engine ───► forecast-agent      Gamma-prior rates · Poisson monthly draws ·
      │                                        activation ramp · pool saturation · regional competition
      ▼
  Portfolio optimizer ──► optimizer-agent     greedy, region-de-clustered site selection
      │
      ▼
  BAND  ────────────────► Human sign-off       study manager approves before anything activates
      │
      ▼
  Hydra DB  ────────────► Versioned audit      append-only SHA-256 hash chain, fully replayable
      │
  .agent / DMV  ────────► Identity             every actor (agent + human) is a verified identity
      │                                         → the 21 CFR Part 11 attribution regulators require
      ▼
  InsForge  ────────────► Backend              persistence + hosting
```

### Sponsor integration map

| Layer | Sponsor | Role | Prize |
|---|---|---|---|
| Backend / persistence | **InsForge** | Postgres/auth/storage/hosting | ✅ 1st–3rd |
| Versioned audit ledger | **Hydra DB** | time-aware, tamper-evident decision record | ✅ |
| Human-in-the-loop | **BAND** | approval + agent/human coordination | ✅ |
| Prevalence / research | **You.com** | Research API for eligible patient pool | ✅ |
| Pipeline orchestration | **RocketRide** | (adapter-ready for the forecast pipeline) | ✅ |
| Web data | **Nimble** | competitive trial landscape | |
| Identity / trust | **.agent / DMV** | verified agent + actor identity | *(host theme)* |
| Data backbone | **ClinicalTrials.gov** | live trial/site/eligibility data | *(free, public)* |

The `.agent` identity + Hydra audit trail is the bridge to the host community's
theme: regulated trials *legally require* attributable, tamper-evident records
of every decision — which is exactly the identity/trust layer for the agentic
web, applied to a domain where it's a compliance mandate.

---

## The forecasting model (the technical core)

`lib/forecast.ts` runs a per-scenario Monte-Carlo (400 sims × 60 months):

- Each site's "true" monthly rate is drawn from a **Gamma prior** (captures
  site-to-site uncertainty), with mean/variance from `lib/sitescore.ts`.
- Monthly enrollment is a **Poisson** draw around the effective rate.
- Sites contribute nothing until **activated**, then **ramp** to full rate.
- Each site **saturates** as it exhausts its local eligible pool.
- Sites in the same region **compete** for one shared pool (regional cannibalization).
- We read the distribution of cumulative enrollment (mean, p10, p90) and the
  distribution of time-to-target.

The site-rate model (`lib/sitescore.ts`) is an **interpretable prior**: site
type, country infrastructure, indication difficulty, competitive density, and a
per-site track-record factor (with a realistic **cold-site tail** — ~1 in 6
sites badly under-enrolls). In production, Hydra DB supplies real versioned
per-site history and sharpens the prior — same interface, better numbers.

Everything is **deterministic** (seeded RNG) so a demo is reproducible and an
audit is replayable.

---

## Run it

```bash
cd cohort
npm install
npm run dev
# open http://localhost:3000
```

Zero keys required — the whole app works on ClinicalTrials.gov + local
fallbacks. Try `NCT03631199` (CANOPY-1), `NCT03215706` (CheckMate 9LA), or
`NCT02576574` (JAVELIN Lung 100).

### Upgrading layers to live sponsor APIs

Copy `.env.example` → `.env.local` and fill in any keys you have. Each key flips
its layer from local fallback to the real API; the top-bar chip turns green.

```
YOUCOM_API_KEY=      # You.com Research API → real prevalence
NIMBLE_API_KEY=      # Nimble → real competitive landscape
HYDRA_API_KEY=       # Hydra DB → mirror the audit ledger
BAND_API_KEY=        # BAND → real human approval task
INSFORGE_API_KEY=    # InsForge → durable persistence
```

---

## Demo script (90 seconds)

1. Paste `NCT03631199`, hit **Analyze**. Real CANOPY-1 loads — 152 sites, 673 patients.
2. **Impact banner**: *"~$16.8M / 10 months saved vs a naive site plan."*
3. **Forecast chart**: optimized curve (with p10–p90 confidence band) reaches
   target at 34.8mo; the naive baseline lags to 44.8.
4. **Live what-if**: toggle out a few top sites → watch the timeline slip and
   the savings evaporate in real time.
5. **Finalize** → BAND routes it to the human study manager → **Approve**.
6. **Audit trail**: every step is signed to a verified `.agent` identity, and
   the hash chain reads *"✓ chain intact"* — the record a regulator signs off on.

---

## Stack

Next.js 14 (App Router) · TypeScript · zero UI dependencies (hand-built design
system + SVG charts) · ClinicalTrials.gov API v2 · Node crypto for the audit
hash chain.

*Forecasts are modeled estimates for decision support — not medical or
investment advice.*
