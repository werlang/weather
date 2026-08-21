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

## 3. Calibrated Thresholds for School Cancellation Advisory

To prevent alert fatigue and false positives from routine winter weather, the automated monitoring engine filters and reports high-priority alerts based on physical safety and school transport disruption criteria:

* **⚡ Severe Storms & Torrents:** Forecasts or warnings for `"tempestade"`, `"temporal"`, `"trovoadas com pancadas"` or hail + heavy rain.
* **💨 Destructive Wind & Cyclones:** Winds $\ge 80\text{--}100\text{ km/h}$, extratropical cyclones, or `"vendaval"`.
* **❄️ Catastrophic Freezing & Snow:** Sub-zero temperatures ($T_{\min} \le 0^\circ\text{C}$), black ice, or freezing rain. *(Routine winter frost at $2^\circ\text{C}\text{--}4^\circ\text{C}$ is classified as Moderate/Informative and does not trigger class suspension alarms)*.
* **🔥 Extreme Heatwave:** Maximum temperatures $T_{\max} \ge 40^\circ\text{C}$ posing thermal exhaustion risks in unconditioned classrooms.
* **🏜️ Critical Low Humidity:** Minimum relative humidity $RH_{\min} \le 12\%$ (Civil Defense health emergency level).
* **🌊 Hydrometric Flood Warning:** Rapid Jacuí river level surges or flash flood warnings.

---

## 3. Filtering Risk Data for Charqueadas

The API endpoint `GET https://apiprevmet3.inmet.gov.br/avisos/ativos` returns active alerts across Brazil. To isolate alerts affecting Charqueadas:

1. Parse the JSON response.
2. Iterate through all alert objects inside `"hoje"`, `"amanha"`, or flat array structures.
3. Convert `warning.get("geocodes")` into a list.
4. Match against IBGE code `"4305355"` OR search `"Charqueadas"` in `warning.get("municipios")`.

---

## 4. Secondary Risk Information Source: Defesa Civil RS API

In addition to official INMET weather alerts, **Defesa Civil RS (Rede Hidrometeorológica)** serves as a vital **secondary source of risk information**.

While INMET provides broader regional forecasts and severe weather warnings, the Defesa Civil RS API provides **hyper-local real-time hydrometeorological telemetry**:

* **Hydrometric River Level Monitoring (`rio_nivel`):** Monitored in real-time at station `DCRS-00032` in Charqueadas (Rio Baixo Jacuí). Critical for flash flood and river overflow risk assessments.
* **Rapid Rain Accumulation (`chuva.acumulado`):** Tracks short-term high-intensity rainfall spikes in 15-minute (`min015`), 1-hour (`h001`), and 3-hour (`h003`) intervals to detect sudden deluge conditions.
* **Real-time Wind Gusts (`vento.velocidade_maxima`):** Provides instant wind vector data from regional stations.

For full technical specifications, query schemas, and station mappings, see the [Defesa Civil RS API Documentation](DEFESA_CIVIL_RS_API_DOCUMENTATION.md).

---

## 5. Regional Risk Monitoring (Charqueadas & Surrounding Municipalities)

To monitor weather risks for the broader region surrounding Charqueadas (Região Carbonífera / Baixo Jacuí / São Jerônimo Microregion):

### Monitored Regional Municipalities
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

### Running the Regional Monitoring Tool
```bash
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node /app/src/monitor_regional_risks.js
```

The script evaluates official active INMET warnings and day-by-day 5-day forecasts across all surrounding cities, flagging potential risks such as heavy rain, thunderstorms, severe frost, heatwaves, strong winds, and low humidity.


