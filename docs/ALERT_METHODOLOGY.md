# Alert Methodology — Canonical Reference (Charqueadas - RS)

> **Status: NORMATIVE.** This document is the single source of truth for how
> meteorological alerts are **collected, filtered, classified, colored,
> deduplicated, aggregated, and delivered** in this repository. It describes the
> behavior implemented in `src/` today. **Any code change that alters alert
> behavior MUST update this document in the same change**, and unit tests must
> lock the new behavior before merge.
>
> Last verified against source on 2026-08-21.

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Severity Model & Color System](#2-severity-model--color-system)
3. [Coverage & Geographic Filtering](#3-coverage--geographic-filtering)
4. [Thresholds & Configuration](#4-thresholds--configuration)
5. [Detection Rules](#5-detection-rules)
6. [Normalized Event Schema](#6-normalized-event-schema)
7. [Deduplication, Aggregation & Ordering](#7-deduplication-aggregation--ordering)
8. [Delivery Lifecycle & Statefulness](#8-delivery-lifecycle--statefulness)
9. [Message Formatting & Presentation](#9-message-formatting--presentation)
10. [Error Containment Guarantees](#10-error-containment-guarantees)
11. [Implementation Map](#11-implementation-map)
12. [Rules for Future Code](#12-rules-for-future-code)

---

## 1. Pipeline Overview

Alerts are produced by a fixed pipeline. Each stage has exactly one owning module;
never duplicate a stage's responsibility elsewhere.

```
┌───────────────────────── DATA SOURCES ─────────────────────────┐
│  INMET active warnings   INMET 5-day forecasts   Defesa Civil  │
│  (avisos/ativos)         (previsao/{ibge})       RS GraphQL    │
│       │                        │                     │ telemetry│
│  getRegionalRiskWarnings  getRegionalForecasts  getDefesaCivil │
│  (inmet_client.js)        (inmet_client.js)     Telemetry      │
│                                                 (defesa_civil_client.js)
└──────────────┬─────────────────────┬───────────────┬───────────┘
               ▼                     ▼               ▼
        ┌─────────────────────────────────────────────────┐
        │  evaluateHighRisksIn24hWindow (risk_analyzer.js) │
        │  1. geographic + time-window + severity gating   │
        │  2. normalization to canonical event schema      │
        │  3. in-cycle deduplication                       │
        └───────────────────────┬─────────────────────────┘
                                ▼
        ┌─────────────────────────────────────────────────┐
        │  createAlertDispatcher (monitor_service.js)      │
        │  cross-cycle suppression of already-active keys  │
        └───────────────────────┬─────────────────────────┘
                                ▼
        ┌─────────────────────────────────────────────────┐
        │  WeatherTelegramBot (telegram_bot.js)            │
        │  aggregateRiskEvents → formatHighRiskAlert →     │
        │  splitTelegramMessage → sendToAdmins             │
        └─────────────────────────────────────────────────┘
```

- The background loop (`startMonitoringService`) runs `performRegionalRiskMonitoring`
  every cycle (default **15 min**) and dispatches through the stateful dispatcher.
- `/alertas` (and the "🚨 Alertas Ativos" button) runs the same
  `performRegionalRiskMonitoring` on demand with delivery disabled, so an
  operator query always applies the same thresholds as the background service.
- The standalone CLI (`src/monitor_regional_risks.js`) is a **report-only**
  tool: it prints warnings and forecast risks without severity thresholds,
  deduplication state, or Telegram delivery. It is not part of the alert path.
- Every cycle and every detected event is persisted to SQLite via
  `logMonitorCycle` / `logAlert` (`src/log_database.js`).

---

## 2. Severity Model & Color System

### 2.1 Canonical Tiers

All alert logic operates on four canonical tiers defined in
`SEVERITY_LEVELS` (`src/risk_analyzer.js`):

| Tier | Rank | Meaning | Circle |
| :--- | :---: | :--- | :---: |
| `OFF` | 0 | Source disabled — never evaluated | 🚫 |
| `YELLOW` | 1 | Perigo Potencial / Atenção (moderate) | 🟡 |
| `ORANGE` | 2 | Perigo / Alerta (severe) | 🟠 |
| `RED` | 3 | Grande Perigo / Alerta Máximo (extreme) | 🔴 |

An event fires when `rank(event.tier) >= rank(configured threshold)` for its
source. A threshold of `OFF` (rank 0) disables that source entirely.

### 2.2 Tier Normalization

`normalizeSeverityTier(tier)` maps operator input to a canonical tier using
**exact** (case-insensitive) matching:

| Canonical tier | Accepted inputs |
| :--- | :--- |
| `RED` | `red`, `vermelho`, `grande perigo`, `extremo` |
| `ORANGE` | `orange`, `laranja`, `perigo`, `alerta` |
| `YELLOW` | `yellow`, `amarelo`, `perigo potencial`, `atencao`, `atenção` |
| anything else | `OFF` |

### 2.3 Tier Derivation per Source

Each source derives its events' tiers differently:

| Source | Tier derivation |
| :--- | :--- |
| `INMET_OFFICIAL_WARNING` | From the official warning itself: `aviso_cor === '#FF0000'` or `severidade` contains `grande perigo`/`extremo` → `RED`; else `aviso_cor === '#F96602'` or `severidade` contains `perigo` without `potencial` → `ORANGE`; otherwise default `YELLOW`. The system never upgrades or downgrades INMET's own classification. |
| `FORECAST_ANALYSIS` | From the analyzer gradings: `HIGH` → `RED`, `MODERATE` → `ORANGE`, `LOW` → `YELLOW`. |
| `DEFESA_CIVIL_RS` | Hard-coded measurement thresholds produce `RED` or `ORANGE` directly (see §5.3). Defesa Civil telemetry currently emits **no YELLOW events**, so a `YELLOW` threshold behaves like `ORANGE` for this source in practice. |

### 2.4 Emoji Mapping

Warning emoji comes from `getAlertEmoji(warning)` (`src/inmet_client.js`),
checked in this order:

| Priority | Match condition (`aviso_cor` upper-cased, `severidade` lower-cased) | Emoji |
| :---: | :--- | :---: |
| 1 | `#FF0000`, or contains `grande perigo` / `extremo` | 🔴 |
| 2 | `#F96602` or `#FFA500`, or contains `perigo` but not `potencial` | 🟠 |
| 3 | `#FFFE00` or `#FFFF00`, or contains `potencial` / `moderado` | 🟡 |
| 4 | fallback (unrecognized) | ⚪ |

Forecast-analysis events use the fixed mapping `HIGH`→🔴, `MODERATE`→🟠,
`LOW`→🟡. Defesa Civil events carry their emoji explicitly (🔴/🟠).

### 2.5 Presentation Badges

Human-readable badges come from `renderSeverityBadge(severity)`
(`src/telegram_bot.js`). Matching order matters:

| Priority | Match condition | Badge text |
| :---: | :--- | :--- |
| 1 | `RED`, or contains `grande perigo`, `máximo`, `extremo`, `red`, `high` | `🔴 GRANDE PERIGO (CRÍTICO)` |
| 2 | `YELLOW`, or contains `potencial`, `amarelo`, `yellow`, `atenção`, `low` | `🟡 PERIGO POTENCIAL (MODERADO)` |
| 3 | `ORANGE`, or contains `perigo`, `laranja`, `orange`, `alerta`, `moderate` | `🟠 PERIGO (SEVERO)` |
| 4 | fallback | `🟢 NORMAL / MONITORAMENTO` |

Inside broadcast messages the badge is resolved through
`getEventAlertTier(event)`: the event's `colorTier` wins when it normalizes to a
non-`OFF` tier; only then does the free-text `severity` field get parsed.

### 2.6 Official INMET Reference Values

For context (not enforced in code): INMET's color codes correspond to
**Perigo Potencial** `#FFFE00` (rain 20–30 mm/h, winds 40–60 km/h),
**Perigo** `#F96602` (rain 30–60 mm/h, winds 60–100 km/h, hail), and
**Grande Perigo** `#FF0000` (rain > 60 mm/h, winds > 100 km/h, major flooding).
The authoritative project tables are §2.3–§2.5 above; if INMET ever changes its
palette, update §2.3/§2.4 and the tests together.

---

## 3. Coverage & Geographic Filtering

### 3.1 Center Point

- **Charqueadas - RS**, IBGE geocode `4305355`, approx. lat `-29.95`, lon `-51.62`.

### 3.2 Municipality Catalog

The monitored universe is the static catalog
`CHARQUEADAS_SURROUNDING_CITIES_100KM` (`src/inmet_client.js`): 38
municipalities with pre-computed distances and rings:

| Ring | Distance band |
| :--- | :--- |
| Centro Alvo | 0 km (Charqueadas) |
| Zona Imediata | < 25 km |
| Zona Intermediária | 25–50 km |
| Anel Externo | 50–100 km |

`getSurroundingCities(radiusKm)` returns catalog entries with `distKm <= radiusKm`.
Configurable radii in the bot UI are **25 / 50 / 75 / 100 km**; the default is 50 km.
Adding municipalities means editing the catalog array — there is no runtime
discovery of cities.

### 3.3 Warning-to-City Matching

INMET's `/avisos/ativos` endpoint returns warnings for all of Brazil. A warning
is regional (**eligible for alerts**) when any catalog city matches:

- `warning.geocodes` (comma-separated string) contains the city IBGE code, **or**
- `warning.municipios` (lower-cased) contains the city name (lower-cased).

Matching cities are attached as `affectedRegionalCities`. Warnings that match no
catalog city but mention `Rio Grande do Sul` / `RS` in `estados` are kept as
`stateWarnings` for informational listing only — they **never trigger alerts**.

---

## 4. Thresholds & Configuration

### 4.1 Independent Per-Institute Thresholds

INMET and Defesa Civil RS have **independent minimum severity thresholds**:

| Setting | SQLite key | Env fallback | Default |
| :--- | :--- | :--- | :--- |
| INMET minimum severity | `inmet_min_severity` | `INMET_MIN_SEVERITY` | `RED` |
| Defesa Civil RS minimum severity | `defesa_civil_min_severity` | `DEFESA_CIVIL_MIN_SEVERITY` | `ORANGE` |
| Regional radius (km) | `radius_km` | None (database-only) | `50` |
| Cycle interval (minutes) | `interval_minutes` | None (database-only) | `15` |

Defaults are seeded into SQLite by `migrations/002_seed_default_settings.sql`
using `INSERT OR IGNORE`, so operator-configured values survive re-deploys.

### 4.2 Precedence Chain

`parseMonitorConfig()` resolves each setting as:

1. **SQLite `system_settings`** — source of truth (read via `loadAllSettings`).
2. **Environment variables** — severity-tier thresholds only (`INMET_MIN_SEVERITY`, `DEFESA_CIVIL_MIN_SEVERITY`). Radius and interval no longer read the environment.
3. **Hard-coded safe defaults** (table above).

Safety clamps: interval is floored at **1 second**; radius must parse to a
positive integer.

### 4.3 Runtime Reconfiguration

Administrators change thresholds at runtime through the bot's inline menus
(`/config` → callback data `set_inmet:<TIER>`, `set_dc:<TIER>`,
`set_radius:<KM>`, `set_interval:<MIN>`). Updates flow through
`updateConfig()`, which persists to `system_settings` and reschedules the timer
immediately — no restart required.

### 4.4 Legacy Policy Presets

`evaluateHighRisksIn24hWindow` still accepts a legacy `alertPolicy` argument,
mapped onto the independent thresholds:

| Preset | INMET level | Defesa Civil level |
| :--- | :--- | :--- |
| `school` | `RED` | `ORANGE` |
| `red_only` | `RED` | `RED` |
| `all` | `YELLOW` | `YELLOW` |

Presets exist for backwards compatibility only; new code must use the explicit
per-institute parameters.

---

## 5. Detection Rules

All rules below are evaluated against a rolling window:
`windowStart = now`, `windowEnd = now + 24h`.

### 5.1 INMET Official Warnings (`INMET_OFFICIAL_WARNING`)

A warning produces an event when **all three** gates pass:

1. **Geographic gate** — at least one catalog city matched (§3.3).
2. **Time gate** — the warning interval overlaps the 24h window:
   `start <= windowEnd && end >= windowStart`. Timestamps are parsed by
   `parseWarningDate`, which accepts ISO-like (`YYYY-MM-DD HH:MM[:SS]`) and
   Brazilian (`DD/MM/YYYY HH:MM[:SS]`) formats; values **without an explicit
   offset are interpreted as America/Sao_Paulo (-03:00)**, because the process
   may run in a UTC container. Missing/unparseable bounds are treated as open
   (the existing bound alone decides overlap).
3. **Severity gate** — derived tier (§2.3) ≥ configured INMET threshold.

The emitted event preserves INMET's own description, severity label, risks, and
validity window verbatim.

### 5.2 Forecast Analysis (`FORECAST_ANALYSIS`)

For every municipality with a usable forecast, each date key (`DD/MM/YYYY`,
parsed as São Paulo midnight by `parseForecastDate`) is checked against the
window. Days with period breakdowns evaluate **only** `manha` (06–12h),
`tarde` (12–18h), and `noite` (18–24h); days without period breakdowns are
evaluated as one full-day block (00–24h). A period is analyzed when it overlaps
the 24h window.

`analyzeForecastRisks(periodData)` then applies these rules on lower-cased text
fields (`resumo`, `int_vento`) and numeric fields (`temp_min`, `temp_max`,
`umidade_min`):

| # | Condition (checked top-down; first match wins within the group) | Type | Grading |
| :--- | :--- | :--- | :--- |
| 1a | `resumo` contains `ciclone`, `temporal`, `tempestade`, or both `granizo` **and** `chuva` | Tempestade Severa / Temporal Extremo | HIGH |
| 1b | else `resumo` contains `chuva`, `pancadas`, `trovoadas`, or `chuvoso` | Chuva / Instabilidade | MODERATE |
| 2a | `resumo` contains `neve`/`chuva congelada`, or `temp_min <= 0°C` | Frio Extremo / Risco de Congelamento | HIGH |
| 2b | else `resumo` contains `geada`, or `temp_min <= 4°C` | Geada / Frio Típico de Inverno | MODERATE |
| 2c | else `temp_min <= 8°C` | Aviso de Baixa Temperatura | LOW |
| 3a | `temp_max >= 40°C` | Onda de Calor Extrema / Risco à Saúde | HIGH |
| 3b | else `temp_max >= 34°C` | Calor Intenso | MODERATE |
| 4a | `umidade_min <= 12%` | Emergência de Baixa Umidade do Ar | HIGH |
| 4b | else `umidade_min <= 25%` | Aviso de Baixa Umidade Relativa do Ar | MODERATE |
| 5a | `resumo` contains `ciclone`/`vendaval`, `int_vento` contains `muito forte`, or `forte` + `resumo` contains `vento` | Vendaval / Rajadas Destrutivas de Vento | HIGH |
| 5b | else `int_vento` contains `forte` or `rajadas` | Ventos Fortes / Rajadas de Vento | MODERATE |

Groups are independent: one period can emit up to five events (one per group).
Gradings pass the INMET threshold as follows: `HIGH` always passes when the
source is enabled; `MODERATE` requires threshold ≤ `ORANGE`; `LOW` requires
threshold ≤ `YELLOW`.

### 5.3 Defesa Civil RS Telemetry (`DEFESA_CIVIL_RS`)

Real-time station telemetry is **not** filtered by the time window (it *is* the
present). Default queried stations: `DCRS-00032` (Charqueadas),
`DCRS-00093` (General Câmara / São Jerônimo), `DCRS-00076` (Eldorado do Sul),
`DCRS-00054` (Barra do Ribeiro). Metadata for `DCRS-00033` / `DCRS-00122`
(Porto Alegre) exists in `REGIONAL_STATIONS` for name resolution.

Measurements read per station: rain accumulations `min015`, `h001`, `h003`,
`h024` (mm); wind gust `velocidade_maxima` (km/h); river `rio_nivel` (m) and
`rio_nivel_tendencia` (m/h). Rules per station:

| Group | RED (Alerta Máximo) 🔴 | ORANGE (Alerta) 🟠 |
| :--- | :--- | :--- |
| Rain accumulation | `rain_1h >= 50` **or** `rain_3h >= 80` | `rain_15min >= 20` **or** `rain_1h >= 30` **or** `rain_3h >= 50` **or** `rain_24h >= 80` |
| Wind gust | `gust >= 100 km/h` | `gust >= 75 km/h` |
| River level / trend | `level >= 6.5 m` **or** `trend >= 0.5 m/h` | `level > 5.5 m` **or** `trend >= 0.25 m/h` |

Notes:

- Rain and wind groups are mutually exclusive first-match (RED wins over
  ORANGE); the river group is evaluated independently of both.
- The **absolute river cota keeps the alert active even after the rise
  stabilizes** (trend ≈ 0 but level ≥ threshold still fires).
- Missing readings parse as `0` (river level missing ⇒ river group skipped).
- Events pass the Defesa Civil threshold gate from §4.1 (`colorTier` rank ≥
  configured rank).

---

## 6. Normalized Event Schema

Every detection rule must emit this exact shape (fields consumed by the
dispatcher, aggregator, formatter, and persistence layer):

```js
{
  source: 'INMET_OFFICIAL_WARNING' | 'FORECAST_ANALYSIS' | 'DEFESA_CIVIL_RS',
  eventId: '<provider id or null>',   // stable provider identifier, preferred for identity
  type: '<human hazard name>',
  severity: '<original label>',       // e.g. 'Grande Perigo', 'HIGH (Red Equivalent)', 'Alerta Máximo (Red)'
  colorTier: 'RED' | 'ORANGE' | 'YELLOW',
  emoji: '🔴' | '🟠' | '🟡' | '⚪',
  affectedCities: ['<municipality names>'],
  timeframe: '<display window>',
  details: '<measured/predicted evidence>',
  triggerReason: '<why the alert fired>'
}
```

After aggregation (§7) events may also carry `aggregatedCount`.

---

## 7. Deduplication, Aggregation & Ordering

Two distinct mechanisms operate at different stages — do not conflate them.

### 7.1 Event Identity — `getRiskEventKey`

Identity = `source|eventId`, where `eventId` is the provider id
(e.g. INMET `id_aviso`) when available, otherwise the fallback
`type|affectedCities.join('|')|timeframe`. The fallback deliberately excludes
volatile readings (mm, °C, m) so the same ongoing hazard keeps one identity
across cycles.

### 7.2 In-Cycle Deduplication

`evaluateHighRisksIn24hWindow` removes events with identical keys inside a
single cycle (first occurrence wins).

### 7.3 Cross-Cycle Suppression

`createAlertDispatcher` (§8) suppresses events whose key was already active in
the previous completed cycle.

### 7.4 Presentation Aggregation — `aggregateRiskEvents`

Before rendering, events are grouped by `source|type|colorTier`:

- `affectedCities` are merged and sorted with `pt-BR` collation;
- occurrence count becomes `aggregatedCount`;
- multiple distinct timeframes collapse to `Próximas 24h (N ocorrências)`;
- `triggerReason`/`details` are rewritten to describe the merged group;
- groups are **sorted by severity rank descending** (RED first).

Aggregation is presentation-only: metrics persist the raw event count.

---

## 8. Delivery Lifecycle & Statefulness

### 8.1 Dispatcher Semantics

`createAlertDispatcher(alertCallback)` enforces **at-least-once, new-events-only**
delivery:

1. Compute the key set of the current batch; select events whose keys are not in
   the previously active set (deduplicating within the batch).
2. Deliver only those new events via the callback.
3. Replace the active set with the current batch **only if** the cycle's data
   was complete **and** delivery reported no failures
   (`delivery.failed.length === 0`).

Consequences (intentional, keep them):

- A transient source outage cannot "clear" an active alert: incomplete cycles
  never replace the active set.
- Partial Telegram failure means the whole batch is retried next cycle —
  surviving admins may receive duplicates. At-least-once beats silently
  dropped alerts.
- An event that persists across cycles is delivered once, not every cycle.

### 8.2 Data Quality Gating

`performRegionalRiskMonitoring` fetches the three sources under
`Promise.allSettled` and records a `dataQuality` report (`complete`, per-source
availability, forecast failure count, error strings). Rules:

- An incomplete cycle can still raise alerts from whichever sources succeeded.
- An incomplete cycle **must not** emit an "all clear" conclusion.
- Cycle outcome and errors are persisted via `logMonitorCycle`; each raised
  event is persisted via `logAlert`.

### 8.3 Delivery Target

Alerts go **only** to allowlisted administrator chats (`sendToAdmins` in
`src/telegram.js`), chunked by `splitTelegramMessage` to stay under Telegram's
4096-character limit, and attach the action-tray inline keyboard
(🚨 Alertas Ativos / 🏠 Painel). Delivery result shape:
`{ sent: [{chatId, chunks}], failed: [{chatId, error}] }`.

---

## 9. Message Formatting & Presentation

`WeatherTelegramBot.formatHighRiskAlert(events, sentAt)` renders broadcasts:

1. Aggregate events (§7.4).
2. Choose copy from `getAlertPresentation` based on the **highest tier in the
   batch**:

| Highest tier | Header | Criteria line | Footer |
| :--- | :--- | :--- | :--- |
| RED | `🚨 ALERTA METEOROLÓGICO SEVERO` | `🏫 CRITÉRIO: AVALIAÇÃO DE SUSPENSÃO DE AULAS / ATIVIDADES` | contingency-plan recommendation for school transport |
| ORANGE | `⚠️ ALERTA METEOROLÓGICO — RISCO SEVERO` | `🚧 CRITÉRIO: AVALIAÇÃO DE SEGURANÇA E CONTINGÊNCIA` | assess transport, follow official guidance |
| YELLOW | `ℹ️ AVISO METEOROLÓGICO — RISCO POTENCIAL` | `👁️ CRITÉRIO: ACOMPANHAMENTO E PREPARAÇÃO` | keep monitoring official updates |
| OFF | `ℹ️ AVISO METEOROLÓGICO` | `👁️ CRITÉRIO: ACOMPANHAMENTO` | consult official updates |

3. Body layout per aggregated event (fields separated by `CARD_DIVIDER`):
   numbered line with `emoji` + `type` (+ grouped-occurrence note), then
   indented `Severidade:` badge, `Origem:` source, `Municípios Impactados:`,
   `Janela:`, `💡 Motivo do Disparo:`, and `📝 Detalhes:` (omitted when equal
   to the reason).
4. Header block includes the São Paulo-timezone timestamp (`pt-BR` format) and
   the aggregated-vs-raw counts.

The `/alertas` on-demand report (`renderActiveAlertsReport`) reuses the same
aggregation, presentation selection, and badge logic, and additionally shows
the applied thresholds, radius, municipality coverage, and any data-quality
warnings. All timestamps shown to users are `America/Sao_Paulo`.

---

## 10. Error Containment Guarantees

Required behavior for the 24/7 process (enforced by tests and review):

- Source fetches are isolated: one failing source degrades `dataQuality`, never
  aborts the cycle (`Promise.allSettled`); per-city forecast failures are
  contained to that city (`forecast: {}, error`).
- A crashing cycle is caught by the loop; the service logs and continues
  ("o serviço continuará ativo"). The `isRunning` guard prevents overlapping
  cycles.
- HTTP clients log failures to SQLite (`logFetch`) and return empty structures
  instead of throwing into the loop (Defesa Civil client throws only when
  `throwOnError: true`, which the coordinator uses to convert transport errors
  into data-quality degradation).
- Telegram delivery failures are caught per chat and surfaced through
  `delivery.failed`; they never terminate the process.

---

## 11. Implementation Map

| Pipeline concern | Owning module | Key exports | Locking tests |
| :--- | :--- | :--- | :--- |
| INMET fetching, city catalog, warning matching, emoji | `src/inmet_client.js` | `getSurroundingCities`, `getRegionalRiskWarnings`, `getRegionalForecasts`, `getAlertEmoji` | `tests/inmet_client.test.js` |
| Defesa Civil GraphQL fetching + telemetry thresholds | `src/defesa_civil_client.js` | `getDefesaCivilTelemetry`, `evaluateDefesaCivilRisks`, `REGIONAL_STATIONS` | covered via monitor/analyzer suites |
| Tier model, normalization, 24h evaluation, identity, aggregation | `src/risk_analyzer.js` | `SEVERITY_LEVELS`, `normalizeSeverityTier`, `evaluateHighRisksIn24hWindow`, `analyzeForecastRisks`, `parseWarningDate`, `parseForecastDate`, `getRiskEventKey`, `aggregateRiskEvents` | `tests/monitor_service.test.js` |
| Config precedence, cycle orchestration, dispatcher, scheduling | `src/monitor_service.js` | `parseMonitorConfig`, `performRegionalRiskMonitoring`, `createAlertDispatcher`, `startMonitoringService` | `tests/monitor_service.test.js` |
| Thresholds menus, badges, presentation copy, message layout | `src/telegram_bot.js` | `ALERT_POLICIES`, `INMET_SEVERITY_OPTIONS`, `DEFESA_CIVIL_SEVERITY_OPTIONS`, `renderSeverityBadge`, `formatHighRiskAlert`, `renderActiveAlertsReport` | `tests/telegram.test.js` |
| Admin delivery + chunking | `src/telegram.js` | `splitTelegramMessage`, `sendToAdmins` | `tests/telegram.test.js` |
| Persistence of cycles/alerts/settings/fetches | `src/log_database.js` | `logMonitorCycle`, `logAlert`, `saveSystemSetting`, `loadAllSettings`, `logFetch` | `tests/log_database.test.js` |
| Seeded defaults | `migrations/002_seed_default_settings.sql` | — | `tests/migrate.test.js` |

---

## 12. Rules for Future Code

These requirements keep the methodology coherent. Reviewers must reject changes
that violate them.

1. **Single funnel.** All automatic alerts must flow through
   `evaluateHighRisksIn24hWindow` and the dispatcher. Never send Telegram
   alerts directly from a fetch client or analyzer.
2. **New sources.** A new data source must (a) normalize to the §6 event
   schema, including a truthful `colorTier`; (b) get its own independent
   threshold following §4 (SQLite key + migration seed + env fallback +
   `normalizeSeverityTier`-compatible values + bot menu option); (c) plug into
   `performRegionalRiskMonitoring` under the `Promise.allSettled` fan-out with
   its own `dataQuality` flag; and (d) be added to §11 and the tables in §2/§5.
3. **Threshold honesty.** Every emitted event must be gated by its source's
   configured threshold. If a source cannot produce a tier (e.g. no YELLOW
   telemetry events today), document that asymmetry here rather than inventing
   synthetic events.
4. **Color/tier changes are cross-cutting.** Changing tier derivation, emoji, or
   badge wording requires updating §2 tables, the deriving functions
   (`getAlertEmoji`, `renderSeverityBadge`, `getEventAlertTier`), and the
   locking tests in the same commit.
5. **Stable identities.** New event types must provide a durable `eventId` when
   the provider has one; fallback identities must exclude volatile measurements
   so ongoing hazards are not re-alerted every cycle.
6. **At-least-once delivery.** Never clear the dispatcher's active set on
   incomplete data or failed delivery, and never emit an all-clear from a
   degraded cycle (§8).
7. **Timezone discipline.** Naive local timestamps from Brazilian APIs are
   America/Sao_Paulo; user-facing timestamps are rendered in
   `America/Sao_Paulo` with `pt-BR` formatting. Parse only through
   `parseWarningDate` / `parseForecastDate`.
8. **Documentation parity.** Any PR that changes filtering, thresholds, colors,
   wording, or delivery semantics updates this file in the same commit and adds
   or amends deterministic unit tests (mocked `fetch`, fake bot objects — no
   live network).
