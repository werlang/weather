# Defesa Civil RS Hydrometeorological Network API Documentation

**GraphQL HTTP Endpoint:** `https://redehidrometeorologica.defesacivil.rs.gov.br/graphql`  
**GraphQL WebSocket Endpoint:** `wss://redehidrometeorologica.defesacivil.rs.gov.br/graphql`  
**Documentation Portal:** `https://sistemas.defesacivil.rs.gov.br/api-redehidrometeorologica`  
**Interactive Map Portal:** `https://redehidrometeorologica.defesacivil.rs.gov.br/Mapa`  
**Data Format:** `GraphQL JSON`  
**Authentication & Scope:** Public API with client parameter `client: "casa-militar-defesa-civil-rs"`  
**DataProvider:** Defesa Civil do Estado do Rio Grande do Sul (Casa Militar) / MKS  

---

## 1. Overview & Role in Meteorological Risk Monitoring

The **Rede Hidrometeorológica da Defesa Civil RS** is an automated telemetry and observation network covering the state of Rio Grande do Sul.

It serves as a **secondary source of meteorological risk information** alongside INMET:
* **Real-Time Hydrometric Monitoring:** Measures river level heights (`rio_nivel` in meters) and trend velocity (`rio_nivel_tendencia`) specifically for the **Baixo Jacuí** river basin impacting Charqueadas.
* **Granular Rain Telemetry:** Captures precipitation accumulation in short windows (10 seconds `s015`, 5 min, 15 min, 1h, 3h, 6h, up to 7 days `h168`).
* **Microclimate & Wind Tracking:** Provides live wind speed, wind gust maxima (`velocidade_maxima`), barometric pressure trend, and temperature.

---

## 2. Key Station References for Charqueadas & Region

The table below lists active station codes for Charqueadas and the surrounding Carbonífera / Baixo Jacuí region:

| Station Code | Station Name | Latitude | Longitude | River Basin (`bacia`) | Region |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DCRS-00032` | **Charqueadas** | `-29.9478` | `-51.6174` | RS - Baixo Jacuí | Metropolitana de Porto Alegre |
| `DCRS-00093` | **General Câmara / São Jerônimo** | `-29.9555` | `-51.7613` | RS - Baixo Jacuí | Metropolitana de Porto Alegre |
| `DCRS-00076` | **Eldorado do Sul** | `-30.0097` | `-51.3034` | RS - Lago Guaíba | Metropolitana de Porto Alegre |
| `DCRS-00054` | **Barra do Ribeiro - Lago Guaíba** | `-30.2945` | `-51.2988` | RS - Lago Guaíba | Metropolitana de Porto Alegre |
| `DCRS-00033` | **Porto Alegre - Ipanema** | `-30.1419` | `-51.2271` | RS - Lago Guaíba | Metropolitana de Porto Alegre |
| `DCRS-00122` | **Porto Alegre - Cristal** | `-30.0773` | `-51.2452` | RS - Lago Guaíba | Metropolitana de Porto Alegre |

---

## 3. Telemetry Indicators & Metrics Schema

| Metric Category | Field Path | Unit | Description |
| :--- | :--- | :--- | :--- |
| **River Level** | `data.rio.rio_nivel.value` | meters (`m`) | Current river surface height. |
| **River Trend** | `data.rio.rio_nivel_tendencia.value` | rate | Derivative rate of river height change. |
| **River Name** | `data.rio.rio_nome.value` | string | Name of the monitored river body. |
| **Rain Accumulation** | `data.chuva.acumulado.[interval].value` | `mm` | Accumulated rainfall over specified window. |
| **Temperature** | `data.temperatura.atual.value` | °C | Ambient air temperature. |
| **Temp History** | `data.temperatura.historico` | °C | Daily min, max, avg for today (`diaatual`) and yesterday. |
| **Relative Humidity** | `data.umidade.atual.value` | % | Relative humidity percentage. |
| **Atmospheric Pressure**| `data.pressaoatmos.atual.value` | hPa | Barometric pressure. |
| **Pressure Trend** | `data.pressaoatmos.tendencia.value` | rate | Barometric trend indicator. |
| **Wind Speed (Avg)** | `data.vento.velocidade_media.value` | km/h | Mean wind speed. |
| **Wind Speed (Max)** | `data.vento.velocidade_maxima.value` | km/h | Peak wind gust speed. |
| **Wind Direction** | `data.vento.direcao.value` | degrees (°) | Compass direction angle (0-360°). |
| **Heat Sensation** | `data.senstermica.atual.value` | °C | Apparent feel temperature. |
| **Solar Radiation** | `data.radiacaosolar.atual.value` | kWh/m² | Solar irradiance level. |

---

## 4. Time Intervals & Parameters

The rainfall field `chuva.acumulado` and the historical query field `interval` use the following parameter codes:

| Parameter (`acumulado`) | Historical Filter (`interval`) | Duration Description |
| :--- | :--- | :--- |
| `s015` | N/A | 10 seconds |
| `min005` | `MIN_5` | 5 minutes |
| `min010` | `MIN_10` | 10 minutes |
| `min015` | `MIN_15` | 15 minutes |
| `min030` | `MIN_30` | 30 minutes |
| `h001` | `HOUR_1` | 1 hour |
| `h1min30` | `H_1_MIN_30` | 1 hour 30 minutes |
| `h003` | `HOUR_3` | 3 hours |
| `h006` | `HOUR_6` | 6 hours |
| `h012` | `HOUR_12` | 12 hours |
| `h024` | `HOUR_24` | 24 hours (1 day) |
| `h048` | `HOUR_48` | 48 hours (2 days) |
| `h072` | `HOUR_72` | 72 hours (3 days) |
| `h096` | `HOUR_96` | 96 hours (4 days) |
| `h120` | `HOUR_120` | 120 hours (5 days) |
| `h144` | `HOUR_144` | 144 hours (6 days) |
| `h168` | `HOUR_168` | 168 hours (7 days) |

---

## 5. GraphQL Query Specifications

### 5.1 `Tags_data` Query (Current Telemetry by Station Code)

Used to poll recent measurements for one or more station codes:

```graphql
query Tags_data {
  tags_data(
    station: ["DCRS-00032"]
    clients: ["casa-militar-defesa-civil-rs"]
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
            min005 { value }
            min015 { value }
            h001 { value }
            h003 { value }
            h006 { value }
            h012 { value }
            h024 { value }
            h168 { value }
          }
        }
        temperatura {
          atual { value }
          historico {
            diaatual { media { value } maxima { value } minima { value } }
          }
        }
        umidade { atual { value } }
        pressaoatmos { atual { value } tendencia { value } }
        senstermica { atual { value } }
        radiacaosolar { atual { value } }
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

### 5.2 `Historic` Query (Time-Series Historical Query)

Used to request historical telemetry data within a given date range:

```graphql
query Historic {
  historic(
    system: Qualle_Hidrometeorologia
    client: "casa-militar-defesa-civil-rs"
    stationCode: "DCRS-00032"
    startDate: "2026-08-11 00:00:00"
    endDate: "2026-08-12 00:00:00"
    interval: HOUR_1
  )
}
```

### 5.3 `Nowcasting` Subscription (Live Telemetry Streaming via WebSocket)

Used for continuous event streaming of station updates:

```graphql
subscription Nowcasting {
  nowcasting_unique(
    clients: ["casa-militar-defesa-civil-rs"]
  ) {
    qualle_meteorologia {
      codigo
      name { prefix general local }
      timestamp
      position { bacia latitude longitude regiao }
      data {
        rio {
          rio_nivel { value }
          rio_nivel_tendencia { value }
        }
        chuva {
          acumulado {
            h001 { value }
            h003 { value }
            h024 { value }
          }
        }
        vento {
          velocidade_maxima { value }
        }
      }
    }
  }
}
```

---

## 6. Code Usage Examples

### Node.js 26 (Native `fetch`)
```javascript
const response = await fetch("https://redehidrometeorologica.defesacivil.rs.gov.br/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `query GetCharqueadasStation {
      tags_data(
        station: ["DCRS-00032"]
        clients: ["casa-militar-defesa-civil-rs"]
      ) {
        qualle_meteorologia {
          codigo
          name { general }
          timestamp
          data {
            rio { rio_nivel { value } }
            chuva { acumulado { h001 { value } h024 { value } } }
            temperatura { atual { value } }
            vento { velocidade_maxima { value } }
          }
        }
      }
    }`
  })
});

const result = await response.json();
const stationData = result.data.tags_data.qualle_meteorologia[0];
console.log(`Station ${stationData.name.general} (${stationData.codigo}):`);
console.log(`River Level: ${stationData.data.rio.rio_nivel.value} m`);
console.log(`24h Rain: ${stationData.data.chuva.acumulado.h024.value} mm`);
```

### cURL Example
```bash
curl -X POST https://redehidrometeorologica.defesacivil.rs.gov.br/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { tags_data(station: [\"DCRS-00032\"], clients: [\"casa-militar-defesa-civil-rs\"]) { qualle_meteorologia { codigo name { general } data { rio { rio_nivel { value } } chuva { acumulado { h024 { value } } } } } } }"
  }'
```
