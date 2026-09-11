# Meteorological Risk Monitoring Guide: Charqueadas - RS

This document outlines how to programmatically identify, parse, and handle severe meteorological risk alerts for **Charqueadas - RS** using INMET APIs.

---

## 1. Municipality Reference Data

* **City:** Charqueadas
* **State:** Rio Grande do Sul (RS)
* **IBGE Code:** `4305355`
* **Geographical Region:** Metropolitan Porto Alegre / Baixo Jacuí

---

## 2. Risk Alert Severities & Color Codes

INMET classifies meteorological risk situations into three primary severity levels:

| Severity (`severidade`) | Color Code (`aviso_cor`) | Risk Level | Description | School Advisory Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Perigo Potencial** | `#FFFE00` (Yellow) | Moderate Risk | Rain 20-30 mm/h, winds 40-60 km/h. | Normal operations. |
| **Perigo** | `#F96602` (Orange) | Severe Risk | Rain 30-60 mm/h, winds 60-100 km/h, hail, flash floods. | **Alert Triggered**: Assess transport & local road conditions. |
| **Grande Perigo** | `#FF0000` (Red) | Extreme Risk | Rain > 60 mm/h, winds > 100 km/h, major flooding, landslides. | **Immediate Advisory**: Suspend in-person classes. |

---

## 3. High-Priority Alert Policy: Configurable Thresholds (Default Orange for Defesa Civil OR Red with INMET)

Thresholds are **configurable per institute and per category** via SQLite `system_settings` and Telegram `/config` (see `docs/ALERT_METHODOLOGY.md:199` and `src/monitoring/monitor_service.js:140` `parseMonitorConfig()`). Defaults match the school advisory intent but can be widened to `YELLOW` or silenced to `OFF`:

1. **🔴 INMET Warnings:** Default `inmet_min_severity=RED` (`#FF0000` `Grande Perigo`) — only `Grande Perigo` dispatches; `ORANGE`/`YELLOW` advisory. Configurable to `ORANGE`/`YELLOW`/`OFF` via `/config` → `Limiar INMET`.
2. **🟠 Defesa Civil RS Telemetry & Warnings:** Default `defesa_civil_min_severity=ORANGE` (`Alerta`/`Alerta Máximo`) (Rain $\ge 20\text{ mm/15min}$ or $\ge 30\text{ mm/h}$, wind gusts $\ge 75\text{ km/h}$, or Jacuí river rise $\ge 0.25\text{ m/h}$, or absolute cota — Charqueadas: alerta 4.05 m / inundação 4.6 m). Configurable similarly.
3. **🔴 24h Extreme Forecasts:** Triggered on extreme conditions ($T_{\min} \le 0^\circ\text{C}$ sub-zero freezing/black ice, $T_{\max} \ge 40^\circ\text{C}$, severe storms with cyclone/hail, or $RH_{\min} \le 12\%`) — filtered by same `inmetMinSeverity` (`HIGH`→`RED`, `MODERATE`→`ORANGE`, `LOW`→`YELLOW`) `src/monitoring/risk_analyzer.js:481` and secondarily by per-category `alert_cat_*` `src/monitoring/monitor_service.js:313`.

Official INMET warnings are eligible only when their reported start/end interval overlaps the next 24 hours. Forecasts for the first two days are evaluated across the `manha`, `tarde`, and `noite` periods; later daily summaries are evaluated as full-day data. See `docs/ALERT_METHODOLOGY.md:248` for full window logic.

The monitor marks a cycle as incomplete when a source fails or returns no usable telemetry. An incomplete cycle can still report risks found by available sources, but it does not emit a no-risk conclusion and does not clear previously active alerts (`src/monitoring/monitor_service.js:296` `dataQuality.complete`).

---

## 4. Filtering Risk Data for Charqueadas

The API endpoint `GET https://apiprevmet3.inmet.gov.br/avisos/ativos` returns active alerts across Brazil. To isolate alerts affecting Charqueadas:

1. Parse the JSON response.
2. Iterate through all alert objects inside `"hoje"`, `"amanha"`, or flat array structures.
3. Convert `warning.get("geocodes")` into a trimmed list, plus the parenthetical `(1234567)` codes in `warning.get("municipios")`.
4. Match the IBGE code `"4305355"` exactly against that code set, OR match a `municipios` entry whose name equals `"Charqueadas"` exactly with UF `RS` — never substring-search the name (`"Lajeado Grande - SC"` must not match `"Lajeado"`).

---

## 4. Secondary Risk Information Source: Defesa Civil RS API

In addition to official INMET weather alerts, **Defesa Civil RS (Rede Hidrometeorológica)** serves as a vital **secondary source of risk information**.

While INMET provides broader regional forecasts and severe weather warnings, the Defesa Civil RS API provides **hyper-local real-time hydrometeorological telemetry**:

* **Hydrometric River Level Monitoring (`rio_nivel`):** Monitored in real-time at station `DCRS-00032` in Charqueadas (Rio Baixo Jacuí). Critical for flash flood and river overflow risk assessments. **Official quotas for Charqueadas: cota de inundação = 4.6 m; cota de alerta ≤ 4.05 m** (Defesa Civil RS, July 2026 flood bulletins). Upstream ANA gauge São Jerônimo: cota de inundação 4.64 m. Guaíba reference (Cais Mauá C6): alerta 2.55 m / inundação 3.0 m.
* **Rapid Rain Accumulation (`chuva.acumulado`):** Tracks short-term high-intensity rainfall spikes in 15-minute (`min015`), 1-hour (`h001`), and 3-hour (`h003`) intervals, plus 24-hour accumulation (`h024`) to detect sudden deluge and basin-saturation conditions.
* **Real-time Wind Gusts (`vento.velocidade_maxima`):** Provides instant wind vector data from regional stations.
* **Absolute River Level (`rio_nivel`):** Keeps a critical or orange river alert active when the measured level remains high, even after the short-term rise has stabilized.

For full technical specifications, query schemas, and station mappings, see the [Defesa Civil RS API Documentation](DEFESA_CIVIL_RS_API_DOCUMENTATION.md).

---

## 5. Regional Risk Monitoring (Charqueadas & Surrounding Municipalities)

To monitor weather risks for the broader region surrounding Charqueadas (Região Carbonífera / Baixo Jacuí / São Jerônimo Microregion) — full 38 municipalities in `src/clients/inmet_client.js:19` `CHARQUEADAS_SURROUNDING_CITIES_100KM` (rings 0–100km, see `.agents/skills/inmet-weather-monitor/references/regional-rings.md`), abbreviated here to core 10:

### Monitored Regional Municipalities (core subset)
* **Charqueadas** (`4305355`) - Center
* **São Jerônimo** (`4318408`)
* **Arroio dos Ratos** (`4301107`)
* **Triunfo** (`4322004`)
* **Eldorado do Sul** (`4306767`)
* **General Câmara** (`4308805`)
* **Butiá** (`4302709`)
* **Barão do Triunfo** (`4301750`)
* **Guaíba** (`4309308`)
* **Minas do Leão** (`4312252`)

See full list with distances in `regional-rings.md`.

### Running the Regional Monitoring Tool
```bash
docker run --rm -v $(pwd):/app -w /app node:26-alpine node scripts/monitor_regional_risks.js
```

The script evaluates official active INMET warnings and day-by-day 5-day forecasts across all surrounding cities, flagging potential risks such as heavy rain, thunderstorms, severe frost, heatwaves, strong winds, and low humidity.

