# Defesa Civil RS GraphQL & WebSocket Query Specifications

Detailed technical reference for the GraphQL schema, query structures, interval parameters, and client implementations for the **Rede Hidrometeorológica da Defesa Civil do Estado do Rio Grande do Sul**.

---

## 1. Network & Connection Parameters

* **HTTP GraphQL Endpoint:** `https://redehidrometeorologica.defesacivil.rs.gov.br/graphql`
* **WebSocket GraphQL Endpoint:** `wss://redehidrometeorologica.defesacivil.rs.gov.br/graphql`
* **Required Client Scope:** `client: "casa-militar-defesa-civil-rs"` / `clients: ["casa-militar-defesa-civil-rs"]`
* **Content-Type:** `application/json`
* **Transport:** HTTP POST / WebSocket `graphql-transport-ws`

---

## 2. Instantaneous Telemetry Query: `tags_data`

Retrieves the latest sensor measurements and metadata for a list of station codes.

### GraphQL Query Document

```graphql
query GetStationTelemetry(
  $stations: [String!] = ["DCRS-00032", "DCRS-00093", "DCRS-00076", "DCRS-00054", "DCRS-00033", "DCRS-00122"]
  $clients: [String!] = ["casa-militar-defesa-civil-rs"]
) {
  tags_data(
    station: $stations
    clients: $clients
  ) {
    qualle_meteorologia {
      codigo
      name {
        prefix
        general
        local
      }
      timestamp
      position {
        bacia
        latitude
        longitude
        regiao
        altitude
      }
      data {
        rio {
          rio_nome { value }
          rio_nivel { value }
          rio_nivel_tendencia { value }
          rio_area_drenagem { value }
        }
        chuva {
          acumulado {
            s015 { value }
            min005 { value }
            min010 { value }
            min015 { value }
            min030 { value }
            h001 { value }
            h1min30 { value }
            h003 { value }
            h006 { value }
            h012 { value }
            h024 { value }
            h048 { value }
            h072 { value }
            h096 { value }
            h120 { value }
            h144 { value }
            h168 { value }
          }
        }
        temperatura {
          atual { value }
          historico {
            diaatual {
              media { value }
              maxima { value }
              minima { value }
            }
            diaanterior {
              media { value }
              maxima { value }
              minima { value }
            }
          }
        }
        umidade {
          atual { value }
        }
        pressaoatmos {
          atual { value }
          tendencia { value }
        }
        senstermica {
          atual { value }
        }
        radiacaosolar {
          atual { value }
        }
        vento {
          velocidade_media { value }
          velocidade_maxima { value }
          direcao { value }
        }
      }
      filter {
        relacao {
          tem_chuva_acumulada
          tem_nivel_do_rio
          tem_pressao_atmosferica
          tem_umidade
          tem_vento
        }
      }
    }
  }
}
```

---

## 3. Historical Telemetry Query: `historic`

Fetches historical sensor time series for a station across a defined date range.

### GraphQL Query Document

```graphql
query GetStationHistory(
  $system: SystemEnum = Qualle_Hidrometeorologia
  $client: String = "casa-militar-defesa-civil-rs"
  $stationCode: String = "DCRS-00032"
  $startDate: String = "2026-08-14 00:00:00"
  $endDate: String = "2026-08-20 23:59:59"
  $interval: IntervalEnum = HOUR_1
) {
  historic(
    system: $system
    client: $client
    stationCode: $stationCode
    startDate: $startDate
    endDate: $endDate
    interval: $interval
  )
}
```

### Supported `interval` Values

| Parameter (`interval`) | Duration Description | Common Usage |
| :--- | :--- | :--- |
| `MIN_5` | 5 minutes | Flash rain peak analysis |
| `MIN_10` | 10 minutes | High-resolution storm analysis |
| `MIN_15` | 15 minutes | Standard short-term deluge tracking |
| `MIN_30` | 30 minutes | Half-hourly trend |
| `HOUR_1` | 1 hour | Standard hourly time-series |
| `H_1_MIN_30` | 1 hour 30 minutes | Extended interval |
| `HOUR_3` | 3 hours | Medium-term hydrological flow |
| `HOUR_6` | 6 hours | 6-hour synoptic check |
| `HOUR_12` | 12 hours | Semi-diurnal shift |
| `HOUR_24` | 24 hours | Daily summary and total accumulation |
| `HOUR_48` | 48 hours (2 days) | Multi-day flood crest |
| `HOUR_72` | 72 hours (3 days) | Extended flood propagation |
| `HOUR_96` | 96 hours (4 days) | Multi-day storm analysis |
| `HOUR_120` | 120 hours (5 days) | 5-day cumulative rainfall |
| `HOUR_144` | 144 hours (6 days) | 6-day cumulative rainfall |
| `HOUR_168` | 168 hours (7 days) | Weekly hydrographic audit |

---

## 4. Live Telemetry Streaming Subscription: `nowcasting_unique`

Real-time streaming of telemetry events via GraphQL WebSocket.

### GraphQL Subscription Document

```graphql
subscription StreamLiveTelemetry(
  $clients: [String!] = ["casa-militar-defesa-civil-rs"]
) {
  nowcasting_unique(
    clients: $clients
  ) {
    qualle_meteorologia {
      codigo
      name {
        prefix
        general
        local
      }
      timestamp
      position {
        bacia
        latitude
        longitude
        regiao
      }
      data {
        rio {
          rio_nivel { value }
          rio_nivel_tendencia { value }
        }
        chuva {
          acumulado {
            min015 { value }
            h001 { value }
            h003 { value }
            h024 { value }
          }
        }
        temperatura {
          atual { value }
        }
        pressaoatmos {
          atual { value }
          tendencia { value }
        }
        vento {
          velocidade_media { value }
          velocidade_maxima { value }
          direcao { value }
        }
      }
    }
  }
}
```

---

## 5. Node.js 26 Client Implementation

```javascript
/**
 * Executes a GraphQL request against Defesa Civil RS API.
 * 
 * @param {string} query - The GraphQL document string.
 * @param {Record<string, any>} [variables={}] - Optional GraphQL variables.
 * @returns {Promise<any>} Parsed data payload.
 */
export async function executeDefesaCivilGraphQL(query, variables = {}) {
    const GRAPHQL_ENDPOINT = 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';

    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'DefesaCivilMonitor/1.0 (Node.js 26; Linux x86_64)'
        },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
        throw new Error(`Defesa Civil GraphQL error: HTTP ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
        throw new Error(`GraphQL execution errors: ${result.errors.map(e => e.message).join(', ')}`);
    }

    return result.data;
}
```
