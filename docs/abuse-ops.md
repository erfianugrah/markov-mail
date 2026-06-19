# Abuse Operations — framework & Forminator mapping

> **Note for the markov-mail repo:** this is a shared reference doc, also tracked
> in the sibling `forminator` repo. **markov-mail** is the email-fraud-classifier
> half (the Random Forest scored over email addresses via Worker-to-Worker RPC);
> the *detection-engine* code paths cited below (`src/lib/scoring.ts`,
> `src/lib/footprint.ts`, `submissions.ts`, `migrations/…`, etc.) live in the
> **forminator** repo, not here. The first-principles audit and roadmap apply to
> the combined system.

This is the project-coupled companion to the personal **`abuse-operations`** skill
(`~/.pi/agent/skills/abuse-operations/SKILL.md`). The skill holds the general
doctrine; this doc maps it onto **Forminator** + **markov-mail** and records the
decisions we've made (or deferred).

> **Abuse is the unintended monetization of anything.**
> Sources: Heroku abuse-ops Black Hat talk (Cureton & Stojanovic) + the
> "Facets of Abuse / First Principles of Abuse Operations" doctrine.

## Where Forminator sits

Forminator is a public form-submission endpoint → textbook **abuse in place**
(the easy end for an attacker, the hard end to detect, because the damage often
lands *downstream* in whatever inbox/CRM consumes the submission). markov-mail
is the email-fraud detector wired in via Worker-to-Worker RPC.

```
Easy <───────────────────────────────────────────> Hard
Abuse In Place  <──>  Abuse of Business Logic  <──>  Abuse Post-Exploitation
   ▲ Forminator lives here
```

## Two complementary layers

| Layer | Question | Where |
|---|---|---|
| **Weighted scorer** | "How bad is *this* submission?" (0–100) | `src/lib/scoring.ts` — 10 weighted components, corroboration bonus (3+ signals), deterministic/force-block triggers, weight redistribution |
| **Footprint matcher** | "Which *known campaign* does this match, and is it a pivot?" | `src/lib/footprint.ts` — N-of-M threshold bands + pivot/splash detection (added from the abuse-ops framework) |

The scorer already implements the framework's "collection of low-value
indicators" idea implicitly (the corroboration bonus when ≥3 signals fire). The
footprint matcher adds the *campaign/actor* dimension the scorer lacks:
auto-action at full match, **review + learn** at a partial (pivot) match.

### Footprint bands (from `footprint.ts`)

| Match | Band | Action |
|---|---|---|
| N = M (e.g. 5/5) | `full` | `auto-action` (block/suspend) |
| floor ≤ N < M (e.g. 3–4/5) | `pivot` | `review` → fold novel indicators back into the footprint |
| N < floor | `none` | `ignore` (back in the pool) |

`pivotFloor` defaults to `ceil(M * 0.6)`, min 2. Run the tests:

```bash
npm run test:footprint        # cd forminator first; pure logic, no worker/DB
```

## Forminator indicators → footprint indicators

The blacklist + prevalidation signals we already collect map straight onto
`Indicator { key, value }` rows. Candidate footprint keys:

- `signup_ip_type` (tor_exit / datacenter_asn / residential)
- `email_provider`, `email_pattern` (facerolled vs random — hand vs computer)
- `ephemeral_id`, `ja4`, `header_fingerprint`
- `validation_rate`, `unique_ip_count`
- `field_shape` (which fields the payload carries — phishing kits have tells)
- `markov_email_verdict`

Pre-deploy/pre-submit indicators (Tor exit + provider + email naming) are
legitimate to **auto-action on** even before content arrives — see Principle 2:
they're "seen abusive elsewhere" indicators, not pre-crime.

## First-principles audit (verified against code)

Every row below was checked against production source; evidence path cited.

| # | Principle | Status | Evidence |
|---|---|---|---|
| 1 | Determine intent before declaring abuse | ◐ | Score ≈ intent estimate; **no intent classification** — `monetisation\|weaponi\|disruption\|reputation\|victimi\|intentAspect` → 0 matches in `src/`. Tag by intent aspect, not just magnitude. |
| 2 | Intent only after the fact (no pre-crime) | ✅ | Blacklist/disposable/known-bad = "seen elsewhere" indicators, OK to pre-empt (`fraud-prevalidation.ts`) |
| 3 | Act as soon as *feasible* after intent declared | ✅ | Single-step validate+score+submit (`submissions.ts`) |
| 4 | Can't repeat with same tooling | ◐ | No campaign tracking; `src/lib/footprint.ts` matcher exists but imported **only** by `tests/footprint.spec.ts` — not wired into the pipeline. No retroactive sweep (`sweep\|retroact\|backfill` → 0 matches). |
| 5 | Banned actors can't return | ⚠️ | **Worse than a soft gap:** `cleanupExpiredBlacklist` does `DELETE FROM fraud_blacklist WHERE expires_at <= ?` (`fraud-prevalidation.ts:363`) — hard delete drops the row **and `offense_count`** on TTL. The 1h→24h escalation can never progress for an actor who waits out each window. |
| 6 | Evidence collection minimizes 3rd-party impact | n/a | No criminal-evidence hold today |
| 7 | Outbound == inbound | ◐ | Blocking only; no downstream-notify or loot-devaluation path. A flagged credential-harvest payload is blocked, not neutralised. |
| 8 | Non-destructive / reversible | ✅ | Progressive timeouts (1h→24h) inherently reversible (`calculateProgressiveTimeout`, `turnstile.ts:141`) |
| 9 | All actions codifiable | ✅ | Every decision stores a full `ScoringDecision` audit trail (`scoring.ts`); rules config/KV-driven, no manual D1 edits in the block path |

Also verified: decision is **binary** — `riskScore >= config.risk.blockThreshold` (`config.ts:469`); `levels: {low/medium/high}` are display labels, not an action band. Schema has 5 tables (`migrations/0001_initial_schema.sql`), none actor/campaign-scoped. Blacklist is self-generated only (no external-feed ingestion).

✅ done · ◐ partial · ⚠️ action needed

## Improvement roadmap (sized against the codebase)

`submissions.ts` is 1009 LOC with scoring invoked in 5 places; `database.ts` is 1957 LOC. Sizes reflect that.

| # | Change | Effort | Touches | Risk | Principle |
|---|---|---|---|---|---|
| 2 | **Retain-after-expiry tier**: soft-expire instead of hard-delete; resume `offense_count` on return | S — ½–1 day | migration `0002` (+`status`), `fraud-prevalidation.ts` (~25 LOC) | Low | 5 |
| 3 | **Intent-aspect tagging**: enum + derive aspects from fired components, persist in `ScoringDecision` | S–M — ~1 day | `types.ts`, `scoring.ts` (~40 LOC), migration, `submissions.ts` | Low | 1 |
| 4 | **Analyst review band** (decision only): `block \| review \| allow` via `reviewThreshold` | S — ½ day | `config.ts` | Low | 1 |
| 1 | **Footprint layer (MVP)**: signal→`Indicator` mapper, load/match/store against seeded footprints | M — 1.5–2 days | migration (`fraud_footprints`, `footprint_matches`), new `footprint-integration.ts` (~120 LOC), `submissions.ts` Phase 2 (~40 LOC), `database.ts` | Med (hot path) | 4 |
| 5 | **Retroactive sweep**: re-run a new footprint over recent submissions | M — 1–2 days | scheduled task. **Prereq:** persist full raw signals (today only `risk_score` + breakdown stored) | Med | 4 |
| 6 | **External-feed ingestion** (disposable-email / known-bad IP·JA4) with a `source` tag | M — 1–2 days | scheduled fetch → blacklist | Low | 2 |
| 4+ | Review band **full workflow** (queue + dashboard view + approve/reject endpoints) | L — 3–4 days | React + Hono | Med | 1 |
| 6+ | **Demotivation / loot-devaluation** (downstream notify, ROI destruction) | L+ — design-heavy | downstream-specific | High | 7 |

**Cheapest high-value slice:** items 2 + 3 + 4-decision together — ~2–2.5 days, one migration, ~70 LOC, no UI, no new infra — ship three First-Principles fixes touching nothing on the hot path. **Swing factor is UI:** headless roadmap (log to D1, read via dashboard) ≈ 1 week; full analyst workflow ≈ 2–3 weeks.

## Guiding philosophies (keep these in view)

1. **Relentless incrementalism** — ship small, fix forward.
2. **Non-repetition** — never see the same pattern twice (closest thing to prevention).
3. **Hyperautomation** — tools talk to tools; analysts analyze, code executes.
4. **Go slow to go fast** — study first → act fast + accurate later.
5. **Demotivation > detection** — devalue loot, kill ROI; break spirits, not code.
