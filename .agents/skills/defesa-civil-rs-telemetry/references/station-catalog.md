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

### 2.1 Official River Quotas (Cotas Oficiais)

Absolute river-level alert triggers must reference each station's official quotas.
Verified values with sources:

| Station / Gauge point | Cota de atenção | Cota de alerta | Cota de inundação | Evidence source |
| :--- | :--- | :--- | :--- | :--- |
| `DCRS-00032` Charqueadas — Rio Jacuí (municipal gauge) | — | 4.05 m *(upper bound; see note)* | **4.6 m** | Defesa Civil RS red-alert bulletin, 2026-07-23/24 (Correio do Povo, Rádio Guaíba) |
| `DCRS-00093` General Câmara / São Jerônimo — Rio Jacuí (ANA São Jerônimo gauge) | — | 4.14 m *(provisional = flood − 0.5 m)* | **4.64 m** | ANA telemetry via nivelguaiba.com.br; 2026-07 press coverage |
| Triunfo — Rio Jacuí (context only, not a monitored DCRS station) | — | ~4.65 m | 4.67 m | Correio do Povo, 2026-07 |
| Guaíba lake stations (`DCRS-00076`, `DCRS-00054`, `DCRS-00033`, `DCRS-00122`) — Cais Mauá C6 reference gauge | 2.0 m | 2.55 m (2026 press cites 2.50 m) | **3.0 m** | estado.rs.gov.br, 2024-05-28; G1 / Agora RS, 2026-07 |
| Usina do Gasômetro emergency gauge (Guaíba context, installed 2024-05-03) | — | 3.15 m | 3.60 m | estado.rs.gov.br, 2024-05-28 |
| Porto Alegre Ilhas district (community-level quotas) | — | 2.0 m | 2.20 m | Agora RS, 2026-07 |

> **⚠️ Local datum caveat:** SGB/ANA bulletins warn that quota values are
> *"referências de nível local e arbitrária"*, valid only for the specific
> ruler/gauge they were defined on. Before trusting absolute-level comparisons for a
> station (especially the Lago Guaíba stations mapped to Cais Mauá C6 quotas), verify
> that its `rio_nivel` readings share the same local zero as the official gauge.

> **Charqueadas cota de alerta note:** during the 2026-07-23 event the river was
> already above the cota de alerta when measured at 4.05 m, so the true quota is
> *lower* than 4.05 m. The exact published value has not been located yet — treat
> 4.05 m as a conservative upper bound and replace it once the official figure is
> confirmed by Defesa Civil Municipal de Charqueadas / ANA HIDROWEB.

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
* **Check Station `DCRS-00032` (Charqueadas) `min015` vs `h001`:** Distinguish between instantaneous microbursts / flash floods (`min015 >= 20mm`) and continuous basin flooding (`h024 >= 80mm` + `rio_nivel` approaching the 4.6 m cota de inundação).
