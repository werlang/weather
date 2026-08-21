---
name: inmet-weather-monitor
description: Comprehensive guide and operational workflows for querying INMET weather forecasts, parsing active meteorological risk warnings, and evaluating 24-hour severe weather risks for Charqueadas - RS (IBGE 4305355) and surrounding regional municipalities. Make sure to use this skill whenever working on weather forecasting, severe weather warnings, INMET API integration, regional radius filtering, risk analysis algorithms, or weather data formatting in this project.
---

# INMET Weather & Risk Monitoring Skill

This skill guides the implementation, querying, and risk analysis for the **Instituto Nacional de Meteorologia (INMET)** API endpoints within this project, centered on **Charqueadas - RS** (IBGE Code: `4305355`).

## Core Domain Reference

* **Central Target Municipality:** Charqueadas - RS
* **IBGE Geocode:** `4305355`
* **Latitude / Longitude:** `-29.95`, `-51.62`
* **Microregion / Basin:** Baixo Jacuí / Região Carbonífera / Porto Alegre Metropolitana
* **Primary Endpoints:**
  * Forecasts: `https://apiprevmet3.inmet.gov.br/previsao/{geocodigo}`
  * Active Warnings: `https://apiprevmet3.inmet.gov.br/avisos/ativos`
  * Weather Stations: `https://apitempo.inmet.gov.br/estacoes/T`

For complete schemas and payload examples, see [API Specifications](references/api-specs.md).
For the 38 surrounding cities categorized by distance ring, see [Regional Municipality Rings](references/regional-rings.md).

---

## Key Workflows & Procedures

### 1. Querying 5-Day Municipality Forecasts

Use `getCityForecast(ibgeCode)` from `src/inmet_client.js`:

```javascript
import { getCityForecast, CHARQUEADAS_IBGE_CODE } from './inmet_client.js';

// Fetch forecast for Charqueadas (default) or any valid IBGE code
const forecast = await getCityForecast(CHARQUEADAS_IBGE_CODE);

// Response structure: Keyed by date "DD/MM/YYYY"
// Days 1 & 2 contain period breakdowns: forecast["21/08/2026"].manha, .tarde, .noite
// Days 3, 4, 5 contain daily summary: forecast["23/08/2026"]
for (const [dateStr, dayData] of Object.entries(forecast)) {
  const period = dayData.manha || dayData;
  console.log(`${dateStr}: ${period.resumo}, Min ${period.temp_min}°C / Max ${period.temp_max}°C`);
}
```

### 2. Fetching & Filtering Active Severe Risk Alerts

Active INMET warnings cover all of Brazil. Use `getActiveRiskWarnings(ibgeCode)` or `getRegionalRiskWarnings(citiesList)`:

```javascript
import { getRegionalRiskWarnings, getSurroundingCities } from './inmet_client.js';

const cities = await getSurroundingCities(50); // Cities within 50km
const { regionalWarnings, stateWarnings } = await getRegionalRiskWarnings(cities);

for (const warning of regionalWarnings) {
  console.log(`Alert: ${warning.tipo} [${warning.severidade}]`);
  console.log(`Affected Cities in Region: ${warning.affectedRegionalCities.join(', ')}`);
  console.log(`Window: ${warning.inicio} -> ${warning.fim}`);
  console.log(`Risks: ${warning.riscos}`);
  console.log(`Instructions: ${warning.instrucoes}`);
}
```

### 3. Severity Tiers & Visual Mapping

Always map alert severities to standardized color codes and emojis using `getAlertEmoji(warning)`:

| Severity (`severidade`) | Color Code (`aviso_cor`) | Visual | Action & Threshold |
| :--- | :--- | :---: | :--- |
| **Grande Perigo** | `#FF0000` (Red) | 🔴 | Rain > 60 mm/h or > 100 mm/day, winds > 100 km/h, major flooding, severe hazard |
| **Perigo** | `#F96602` (Orange) | 🟠 | Rain 30-60 mm/h or 50-100 mm/day, winds 60-100 km/h, hail, flash floods |
| **Perigo Potencial** | `#FFFE00` (Yellow) | 🟡 | Rain 20-30 mm/h, winds 40-60 km/h, light hail, moderate hazard |

### 4. 24-Hour Lookahead Risk Evaluation Algorithm

The continuous monitor evaluates two distinct risk streams for the upcoming 24-hour window using `evaluateHighRisksIn24hWindow`:

1. **Official INMET Warnings (`OFFICIAL_WARNING`):**
   - Filters alerts where `aviso_cor` is `#FF0000` (Red) or `#F96602` (Orange), or `severidade` indicates High/Extreme risk.
   - Verifies timestamp overlap: `warningStart <= windowEnd && warningEnd >= windowStart`.
   - Checks if any regional city within configured radius is listed in `warning.geocodes` or `warning.municipios`.

2. **Forecast Telemetry Analysis (`FORECAST_ANALYSIS`):**
   - Evaluates forecast condition summaries and numerical parameters:
     - **Storms / Tempests:** `resumo` containing `tempestade`, `trovoada`, `granizo`, `pancadas de chuva forte`.
     - **Extreme Cold / Frost:** `temp_min <= 3°C` or `resumo` containing `geada severa`.
     - **Extreme Heat / Heatwave:** `temp_max >= 38°C`.
     - **Severe Low Humidity:** `umidade_min <= 20%`.
     - **High Winds / Gale:** `int_vento` containing `rajadas fortes`, `muito fortes`, or `vendaval`.

---

## Defensive Coding & Reliability Rules

- **User-Agent Header:** INMET API requires a valid browser `User-Agent` (e.g. `Mozilla/5.0...`). Native Node 26 `fetch` requests must include standard headers defined in `inmet_client.js`.
- **Date Format Handling:** Dates from INMET come in Brazilian format (`DD/MM/YYYY`) for forecasts and ISO-like strings (`YYYY-MM-DD HH:MM`) for alerts. Always parse through `parseForecastDate` in `src/risk_analyzer.js`.
- **Error Boundaries:** Weather APIs can intermittently return 502/503 or empty responses. All client calls must return fallback structures (`{}` or `[]`) rather than throwing unhandled exceptions in long-running loops.
