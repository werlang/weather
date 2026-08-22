---
name: defesa-civil-rs-telemetry
description: "Use this skill whenever querying the Defesa Civil RS (Rede Hidrometeorológica do Estado do Rio Grande do Sul) GraphQL or WebSocket APIs, retrieving real-time telemetry from station DCRS-00032 (Charqueadas / Baixo Jacuí) or regional stations (DCRS-00093, DCRS-00076, DCRS-00054, DCRS-00033, DCRS-00122), monitoring river levels (rio_nivel, rio_nivel_tendencia), rain accumulation intervals (min005, min015, h001, h003, h024, h168), peak wind gusts (velocidade_maxima), or implementing dual-source risk fusion."
---

# Defesa Civil RS Hydrometeorological Network & Telemetry

Comprehensive operational guide for interacting with the **Rede Hidrometeorológica da Defesa Civil do Estado do Rio Grande do Sul** (Casa Militar / MKS), querying real-time hydrometric and precipitation telemetry for **Charqueadas (Station `DCRS-00032`)** and the Baixo Jacuí basin, and fusing ground-truth observations with INMET 24-hour meteorological risk forecasts.

---

## 1. Quick Reference & Endpoints

* **GraphQL HTTP Endpoint:** `https://redehidrometeorologica.defesacivil.rs.gov.br/graphql`
* **GraphQL WebSocket Endpoint:** `wss://redehidrometeorologica.defesacivil.rs.gov.br/graphql`
* **Default Client Header/Argument:** `client: "casa-militar-defesa-civil-rs"`
* **Target Station Code:** `DCRS-00032` (**Charqueadas**, Baixo Jacuí)
* **Regional Stations:** `DCRS-00093` (General Câmara), `DCRS-00076` (Eldorado do Sul), `DCRS-00054` (Barra do Ribeiro), `DCRS-00033` (Porto Alegre - Ipanema), `DCRS-00122` (Porto Alegre - Cristal)
* **Interactive Map:** `https://redehidrometeorologica.defesacivil.rs.gov.br/Mapa`

For complete GraphQL queries, mutations, subscriptions, and Node.js code snippets, see [references/graphql-queries.md](references/graphql-queries.md).  
For station coordinates, river basin dynamics, and hydrological backwater effects, see [references/station-catalog.md](references/station-catalog.md).

---

## 2. Role as Secondary Ground-Truth Verification Layer

While INMET provides official macroeconomic forecasts and regional warning polygons, Defesa Civil RS provides **hyper-local ground truth telemetry**:

```
+-----------------------------------------------------------------------------------+
|                        METEOROLOGICAL RISK FUSION MODEL                           |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ PRIMARY SOURCE: INMET ]                         [ SECONDARY SOURCE: DEFESA ]   |
|  • 5-day Weather Forecast (/previsao)              • Real-time River Level (m)    |
|  • Severe Warning Polygons (/avisos/ativos)        • River Level Tendency Rate    |
|  • Warning Tiers (Yellow / Orange / Red)          • Short-term Rain (15m, 1h, 24h)|
|  • 24h Lookahead Risk Prediction                   • Instant Wind Gust Maxima     |
|                   |                                                |              |
|                   +-----------------------+------------------------+              |
|                                           |                                       |
|                                           v                                       |
|                             [ DUAL RISK FUSION ENGINE ]                           |
|                             1. Warning Anticipation                               |
|                             2. Ground-Truth Confirmation                          |
|                             3. Critical Threshold Escalation                      |
|                                           |                                       |
|                                           v                                       |
|                              [ UNIFIED ALERT DELIVERY ]                           |
|                              • Admin Telegram Bot Alerts                          |
|                              • Civil Defense Escalation                           |
+-----------------------------------------------------------------------------------+
```

---

## 3. Key Telemetry Indicators & Risk Thresholds

Station `DCRS-00032` (Charqueadas) provides real-time sensor metrics updated at high frequency:

| Indicator Category | Field Path | Unit | Alert Trigger Threshold | Operational Risk Meaning |
| :--- | :--- | :--- | :--- | :--- |
| **River Level** | `rio.rio_nivel.value` | meters (`m`) | Above the station's official quotas (see §3.1): Charqueadas cota de alerta 4.05 m, **cota de inundação 4.6 m** | Flooding of riverside communities in Charqueadas |
| **River Trend** | `rio.rio_nivel_tendencia.value` | rate / hr | `>= +0.25 m/h` (Orange), `>= +0.50 m/h` (Red) | Rapid flood wave propagation down Baixo Jacuí |
| **Flash Rain (15m)** | `chuva.acumulado.min015.value` | `mm` | `>= 20 mm` in 15 minutes | Flash flood / urban drainage overflow |
| **Intense Rain (1h)** | `chuva.acumulado.h001.value` | `mm` | `>= 30 mm` in 1 hour (Orange); `>= 50 mm` or `>= 80 mm` in 3h (Red) | Severe downpour / localized flooding |
| **Daily Rain (24h)** | `chuva.acumulado.h024.value` | `mm` | `>= 80 mm` in 24 hours | Basin saturation / major river level surge |
| **Wind Gust Max** | `vento.velocidade_maxima.value` | `km/h` | `>= 75 km/h` (Orange), `>= 100 km/h` (Red). INMET official bands for comparison: Yellow 40–60, Orange 61–99, Red > 100 km/h | Destructive winds, falling trees, power grid outages |
| **Pressure Trend** | `pressaoatmos.tendencia.value` | rate | Sharp drop (`< -2.0 hPa/3h`) — informational only; no automated risk rule uses pressure today | Imminent squall line / cold front passage |

### 3.1 Official River Quotas (Cotas Oficiais) — Evidence-Based

Absolute river-level triggers MUST use each station's official quotas, not invented
globals. Verified values (sources: Defesa Civil RS bulletins reported by Correio do
Povo / Rádio Guaíba on 2026-07-23/24; ANA telemetry via nivelguaiba.com.br;
estado.rs.gov.br 2024-05-28):

| Station | Gauge point | Cota de atenção | Cota de alerta | Cota de inundação |
| :--- | :--- | :--- | :--- | :--- |
| `DCRS-00032` Charqueadas (Rio Jacuí) | municipal gauge | — | 4.05 m *(upper bound: water had already surpassed the cota de alerta at 4.05 m)* | **4.6 m** |
| `DCRS-00093` General Câmara / São Jerônimo (Rio Jacuí) | ANA São Jerônimo gauge | — | 4.14 m *(provisional = flood − 0.5 m; official value unverified)* | **4.64 m** |
| Guaíba lake stations (`DCRS-00076`, `DCRS-00054`, `DCRS-00033`, `DCRS-00122`) | Cais Mauá C6 reference | 2.0 m | 2.55 m | **3.0 m** |

> **⚠️ Local datum caveat:** SGB/ANA warn that quota values are *"referências de nível
> local e arbitrária"* valid only for the specific ruler/gauge they were defined for.
> Before trusting absolute-level comparisons for any station, cross-check its live
> `rio_nivel` reading against the corresponding official gauge (e.g., Cais Mauá C6
> for the Guaíba lake stations).

---

## 4. Querying Defesa Civil RS Telemetry in Node.js 26

Use native `fetch` to POST GraphQL queries directly:

```javascript
/**
 * Fetches current telemetry for Charqueadas and regional Defesa Civil stations.
 * 
 * @param {string[]} [stations=['DCRS-00032']] - Array of station codes.
 * @returns {Promise<Array<object>>} List of station telemetry objects.
 */
export async function getDefesaCivilTelemetry(stations = ['DCRS-00032']) {
    const GRAPHQL_ENDPOINT = 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';
    
    const query = `
      query GetStationTelemetry($stationList: [String!]!) {
        tags_data(
          station: $stationList
          clients: ["casa-militar-defesa-civil-rs"]
        ) {
          qualle_meteorologia {
            codigo
            name { general local prefix }
            timestamp
            position { bacia latitude longitude regiao altitude }
            data {
              rio {
                rio_nome { value }
                rio_nivel { value }
                rio_nivel_tendencia { value }
              }
              chuva {
                acumulado {
                  min015 { value }
                  h001 { value }
                  h003 { value }
                  h024 { value }
                  h168 { value }
                }
              }
              temperatura {
                atual { value }
                historico { diaatual { minima { value } maxima { value } } }
              }
              pressaoatmos { atual { value } tendencia { value } }
              vento {
                velocidade_media { value }
                velocidade_maxima { value }
                direcao { value }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            variables: { stationList: stations }
        })
    });

    if (!response.ok) {
        throw new Error(`Defesa Civil GraphQL error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    return payload?.data?.tags_data?.qualle_meteorologia || [];
}
```

---

## 5. Secondary Risk Verification Algorithm

The canonical implementation is `evaluateDefesaCivilRisks()` in
`src/defesa_civil_client.js`. It evaluates three independent rule groups per station:
rain accumulation, wind gusts, and river level/trend (using the per-station official
quotas from §3.1). The simplified shape of the algorithm:

```javascript
export function verifyTelemetryRisks(stationTelemetry) {
    const verifiedRisks = [];

    for (const station of stationTelemetry) {
        const meta = REGIONAL_STATIONS.find(s => s.code === station.codigo)
            || { name: station.name?.local || station.codigo };
        const data = station.data || {};
        const rain15min = parseFloat(data.chuva?.acumulado?.min015?.value) || 0;
        const rain1h = parseFloat(data.chuva?.acumulado?.h001?.value) || 0;
        const windGust = parseFloat(data.vento?.velocidade_maxima?.value) || 0;
        const riverLevel = parseFloat(data.rio?.rio_nivel?.value) || null;
        const riverTrend = parseFloat(data.rio?.rio_nivel_tendencia?.value) || 0;

        // 1. Rain: RED >= 50mm/1h or 80mm/3h; ORANGE >= 20mm/15min, 30mm/1h, 50mm/3h or 80mm/24h
        if (rain1h >= 50) {
            verifiedRisks.push({ type: 'CHUVA TORRENCIAL EXTREMA', severity: 'CRITICAL', ... });
        } else if (rain15min >= 20 || rain1h >= 30) {
            verifiedRisks.push({ type: 'CHUVA INTENSA / ALAGAMENTO', severity: 'HIGH', ... });
        }

        // 2. Wind gusts: RED >= 100 km/h; ORANGE >= 75 km/h
        if (windGust >= 100) {
            verifiedRisks.push({ type: 'VENDAVAL / RAJADA EXTREMA', severity: 'CRITICAL', ... });
        } else if (windGust >= 75) {
            verifiedRisks.push({ type: 'VENDAVAL / RAJADAS FORTES', severity: 'HIGH', ... });
        }

        // 3. River level vs OFFICIAL quotas + trend rate (absolute cota keeps the alert
        //    active even after the rise stabilizes)
        if (riverLevel !== null) {
            if ((meta.floodLevelM != null && riverLevel >= meta.floodLevelM) || riverTrend >= 0.5) {
                verifiedRisks.push({ type: 'ELEVAÇÃO CRÍTICA DO RIO', severity: 'CRITICAL', ... });
            } else if ((meta.alertLevelM != null && riverLevel > meta.alertLevelM) || riverTrend >= 0.25) {
                verifiedRisks.push({ type: 'ELEVAÇÃO DO RIO', severity: 'HIGH', ... });
            }
        }
    }

    return verifiedRisks;
}
```

Historical note: before the July 2026 Jacuí flood event this skill suggested global
thresholds (> 5.5 m alert / > 6.5 m flood). Those values exceeded Charqueadas' actual
cota de inundação (4.6 m) and would have stayed silent during a real red-alert flood.
Never reintroduce hard-coded global river thresholds — always use per-station quotas.

---

## 6. Real-Time Streaming via WebSocket (Nowcasting)

To stream real-time updates without polling:
1. Connect via WebSocket to `wss://redehidrometeorologica.defesacivil.rs.gov.br/graphql` using standard subprotocol `graphql-transport-ws`.
2. Subscribe to `nowcasting_unique(clients: ["casa-militar-defesa-civil-rs"])`.
3. Process incoming station updates as events occur.
