# Defesa Civil RS Station Catalog & Hydrological Dynamics

Complete inventory of Defesa Civil RS hydrometeorological stations for **Charqueadas** and the surrounding **Baixo Jacuí / Delta do Jacuí / Lago Guaíba** hydrographic basin.

---

## 1. Primary Station: Charqueadas (`DCRS-00032`)

* **Station Code:** `DCRS-00032`
* **Station Name:** Charqueadas
* **Basin (`bacia`):** RS - Baixo Jacuí
* **Region (`regiao`):** Metropolitana de Porto Alegre
* **Coordinates:** Latitude `-29.9478`, Longitude `-51.6174`
* **Active Sensors:**
  * Acoustic / Radar River Level Sensor (`rio.rio_nivel` in meters)
  * Tipping Bucket Pluviometer (`chuva.acumulado` from `s015` to `h168`)
  * Ultrasonic / Cup Anemometer (`vento.velocidade_media`, `vento.velocidade_maxima`, `vento.direcao`)
  * Barometric Pressure Sensor (`pressaoatmos.atual`, `pressaoatmos.tendencia`)
  * Digital Thermo-hygrometer (`temperatura.atual`, `umidade.atual`)
  * Solar Pyranometer (`radiacaosolar.atual`)

---

## 2. Regional Telemetry Stations

| Station Code | Station Name | Latitude | Longitude | Basin (`bacia`) | Strategic Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DCRS-00032` | **Charqueadas** | `-29.9478` | `-51.6174` | RS - Baixo Jacuí | **Primary Target:** Live hydrometric level and local rain/wind monitoring. |
| `DCRS-00093` | **General Câmara / São Jerônimo** | `-29.9555` | `-51.7613` | RS - Baixo Jacuí | **Upstream Sensor:** Monitors confluence of Rio Taquari and Rio Jacuí before entering Charqueadas. |
| `DCRS-00076` | **Eldorado do Sul** | `-30.0097` | `-51.3034` | RS - Lago Guaíba | **Downstream Outlet:** Monitors delta bottleneck and outflow into Lago Guaíba. |
| `DCRS-00054` | **Barra do Ribeiro** | `-30.2945` | `-51.2988` | RS - Lago Guaíba | **Southern Lake Gate:** Monitors water level and southern wind push across Lago Guaíba. |
| `DCRS-00033` | **Porto Alegre - Ipanema** | `-30.1419` | `-51.2271` | RS - Lago Guaíba | **Lake Water Level:** Live Guaíba basin levels and southerly wind vectoring. |
| `DCRS-00122` | **Porto Alegre - Cristal** | `-30.0773` | `-51.2452` | RS - Lago Guaíba | **Delta Discharge:** Monitors drainage of Jacuí waters into the central lake. |

---

## 3. Hydrological Basin Dynamics: Baixo Jacuí & Lago Guaíba

Understanding river level behavior at Charqueadas requires analyzing the interaction between upstream river flows and downstream lake hydraulic resistance:

```
[ Rio Taquari / Vale do Taquari ] ----+
                                     |
                                     v (Confluence at General Câmara / Triunfo)
[ Rio Jacuí / Médio Jacuí ] ---------> [ CHARQUEADAS (DCRS-00032) ]
                                                |
                                                v (Outflow through Delta)
                                     [ Eldorado do Sul (DCRS-00076) ]
                                                |
                                                v
                                     [ LAGO GUAÍBA (DCRS-00033 / DCRS-00122) ]
                                                |
                                                v (Drainage south to Laguna dos Patos)
                                     [ Barra do Ribeiro (DCRS-00054) ]
```

### The Backwater Effect (Efeito Repiquete & Represamento do Guaíba)
1. **Upstream Inflow:** Heavy rainfall in the Serra Gaúcha (Vale do Taquari) and Centro-Oeste (Médio Jacuí) discharges massive volumes downstream past General Câmara (`DCRS-00093`) into Charqueadas (`DCRS-00032`).
2. **Downstream Damming (Vento Sul):** When strong South/Southeast winds (`vento.direcao` between 150° and 210°) blow over Lago Guaíba and Laguna dos Patos, water is pushed northwards towards Porto Alegre and Eldorado do Sul.
3. **Hydraulic Damming in Charqueadas:** The elevated water level in Lago Guaíba blocks the natural discharge of the Rio Jacuí. This causes the river in Charqueadas to rise rapidly or remain flooded for days even after local rainfall has ceased.

---

## 4. Multi-Station Correlation Guide

When assessing flood or severe weather risks in Charqueadas:
* **Check `DCRS-00093` (General Câmara):** If river level or 24h rain is surging upstream, expect a crest in Charqueadas within 6 to 18 hours.
* **Check `DCRS-00076` (Eldorado do Sul) & `DCRS-00033` (Ipanema):** If Guaíba levels are high and wind direction is South (`S`/`SE`), the Jacuí will suffer severe drainage blockage at Charqueadas.
* **Check Station `DCRS-00032` (Charqueadas) `min015` vs `h001`:** Distinguish between instantaneous microbursts / flash floods (`min015 ≥ 15mm`) and continuous basin flooding (`h024 ≥ 80mm` + `rio_nivel > 5.5m`).
