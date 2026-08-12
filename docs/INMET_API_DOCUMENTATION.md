# INMET API Documentation

**Endpoint Base URL:** `https://apiprevmet3.inmet.gov.br`  
**Data Format:** `JSON`  
**Authentication:** Public Open API  

---

## 1. Forecast Endpoint Specification

### `GET /previsao/{geocodigo}`

Retrieves official 5-day weather forecasts issued by **INMET** for any municipality in Brazil using its 7-digit IBGE code.

#### Path Parameters
* `geocodigo` (*string*, required): 7-digit IBGE code for the target municipality.
  * **Charqueadas - RS:** `4305355`
  * **Porto Alegre - RS:** `4314902`

#### Headers
* `User-Agent` (*string*, required): Standard web browser User-Agent string (e.g. `Mozilla/5.0...`). Required by INMET infrastructure security filters.
* `Accept` (*string*, optional): `application/json`

---

## 2. Response Structure & Schema

The root object is keyed by the requested `geocodigo`. Its value is a dictionary mapping forecast dates (`DD/MM/YYYY`) to weather data objects.

* **Days 1 & 2:** Include period-specific breakdowns (`manha`, `tarde`, `noite`).
* **Days 3, 4 & 5:** Include a single daily summary object.

### Field Definitions

| Field Name | Data Type | Description | Sample Value |
| :--- | :--- | :--- | :--- |
| `uf` | `string` | State postal code. | `"RS"` |
| `entidade` | `string` | Municipality name. | `"Charqueadas"` |
| `resumo` | `string` | Weather condition description. | `"Poucas nuvens com possibilidade de geada"` |
| `temp_max` | `number` | Maximum expected temperature (°C). | `17` |
| `temp_min` | `number` | Minimum expected temperature (°C). | `5` |
| `temp_max_tende`| `string` | Maximum temperature trend description. | `"Ligeira Elevação"` |
| `temp_min_tende`| `string` | Minimum temperature trend description. | `"Ligeiro Declínio"` |
| `dir_vento` | `string` | Wind direction. | `"SE-E"`, `"NE"` |
| `int_vento` | `string` | Wind intensity description. | `"Fracos"`, `"Moderados com rajadas"` |
| `umidade_max` | `number` | Maximum relative humidity (%). | `95` |
| `umidade_min` | `number` | Minimum relative humidity (%). | `50` |
| `cod_icone` | `string` | Numerical code for the weather condition icon. | `"1"` |
| `icone` | `string` | Base64-encoded PNG image string for the weather icon. | `"data:image/png;base64,..."` |
| `estacao` | `string` | Current season. | `"Inverno"`, `"Verão"` |
| `nascer` | `string` | Sunrise time (`HHhMM`). | `"07h02"` |
| `ocaso` | `string` | Sunset time (`HHhMM`). | `"18h02"` |

---

## 3. Active Risk Warnings Endpoint

### `GET /avisos/ativos`

Retrieves all currently active severe weather warnings across Brazil.

#### Key JSON Fields
* `id_aviso` / `codigo`: Unique warning identifier.
* `tipo`: Event type (*Chuvas Intensas*, *Tempestade*, *Vendaval*, *Onda de Calor*, *Geada*, *Baixa Umidade*).
* `severidade`: Alert level (*Perigo Potencial* [Yellow], *Perigo* [Orange], *Grande Perigo* [Red]).
* `aviso_cor`: Color hex code (`#FFFE00`, `#F96602`, `#FF0000`).
* `inicio`, `fim`: Validity timestamps (`YYYY-MM-DD HH:MM`).
* `geocodes`: Comma-separated list of affected IBGE city codes.
* `riscos`: List of specific meteorological hazard statements.
* `instrucoes`: Recommended safety actions for citizens and civil defense.

---

## 4. Weather Stations Endpoint

### `GET https://apitempo.inmet.gov.br/estacoes/T`

Lists all automatic weather stations in Brazil.

* **Porto Alegre (A801):** Lat `-30.05`, Lon `-51.17` (~35 km from Charqueadas)
* **Campo Bom (A885):** Lat `-29.67`, Lon `-51.05` (~50 km from Charqueadas)
