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
| **River Level** | `rio.rio_nivel.value` | meters (`m`) | Rising above baseline (e.g. > 5.5m alert, > 6.5m flood) | Flooding of riverside communities in Charqueadas |
| **River Trend** | `rio.rio_nivel_tendencia.value` | rate / hr | Positive rapid rise (`> +0.10 m/h`) | Rapid flood wave propagation down Baixo Jacuí |
| **Flash Rain (15m)** | `chuva.acumulado.min015.value` | `mm` | `≥ 15.0 mm` in 15 minutes | Flash flood / urban drainage overflow |
| **Intense Rain (1h)** | `chuva.acumulado.h001.value` | `mm` | `≥ 30.0 mm` in 1 hour | Severe downpour / localized flooding |
| **Daily Rain (24h)** | `chuva.acumulado.h024.value` | `mm` | `≥ 80.0 mm` in 24 hours | Basin saturation / major river level surge |
| **Wind Gust Max** | `vento.velocidade_maxima.value` | `km/h` | `≥ 60 km/h` (Mod), `≥ 80 km/h` (Severe) | Destructive winds, falling trees, power grid outages |
| **Pressure Trend** | `pressaoatmos.tendencia.value` | rate | Sharp drop (`< -2.0 hPa/3h`) | Imminent squall line / cold front passage |

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

When an INMET alert or severe forecast is active, the telemetry verifier confirms if real-world sensors are registering imminent or ongoing severe hazards:

```javascript
export function verifyTelemetryRisks(stationTelemetry) {
    const verifiedRisks = [];

    for (const station of stationTelemetry) {
        const name = station.name?.general || station.codigo;
        const rioNivel = station.data?.rio?.rio_nivel?.value;
        const rioTrend = station.data?.rio?.rio_nivel_tendencia?.value;
        const rain15m = station.data?.chuva?.acumulado?.min015?.value || 0;
        const rain1h = station.data?.chuva?.acumulado?.h001?.value || 0;
        const rain24h = station.data?.chuva?.acumulado?.h024?.value || 0;
        const windGust = station.data?.vento?.velocidade_maxima?.value || 0;

        // 1. Hydrometric flood surge verification
        if (rioNivel !== undefined && rioNivel !== null && rioNivel > 5.0) {
            verifiedRisks.push({
                station: station.codigo,
                location: name,
                type: 'ELEVAÇÃO CRÍTICA DO RIO JACUÍ',
                severity: rioNivel >= 6.5 ? 'CRITICAL' : 'HIGH',
                metric: `Nível do Rio: ${rioNivel}m (Tendência: ${rioTrend || 'N/A'})`,
                timestamp: station.timestamp
            });
        }

        // 2. High intensity flash deluge
        if (rain15m >= 15.0 || rain1h >= 30.0) {
            verifiedRisks.push({
                station: station.codigo,
                location: name,
                type: 'CHUVA TORRENCIAL EM TEMPO REAL',
                severity: 'HIGH',
                metric: `Chuva 15min: ${rain15m}mm | Chuva 1h: ${rain1h}mm | 24h: ${rain24h}mm`,
                timestamp: station.timestamp
            });
        }

        // 3. Destructive wind gusts
        if (windGust >= 60.0) {
            verifiedRisks.push({
                station: station.codigo,
                location: name,
                type: 'RAJADA DE VENTO SEVERA DETECTADA',
                severity: windGust >= 80.0 ? 'CRITICAL' : 'HIGH',
                metric: `Rajada Máxima: ${windGust} km/h`,
                timestamp: station.timestamp
            });
        }
    }

    return verifiedRisks;
}
```

---

## 6. Real-Time Streaming via WebSocket (Nowcasting)

To stream real-time updates without polling:
1. Connect via WebSocket to `wss://redehidrometeorologica.defesacivil.rs.gov.br/graphql` using standard subprotocol `graphql-transport-ws`.
2. Subscribe to `nowcasting_unique(clients: ["casa-militar-defesa-civil-rs"])`.
3. Process incoming station updates as events occur.
