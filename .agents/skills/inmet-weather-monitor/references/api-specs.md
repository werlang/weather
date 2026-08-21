# INMET API Detailed Technical Specifications

Official documentation and implementation guide for the INMET (Instituto Nacional de Meteorologia) public APIs used in the weather and meteorological risk monitoring service.

---

## 1. Forecast Endpoint: `/previsao/{geocodigo}`

Retrieves official 5-day weather forecasts issued by INMET for any municipality in Brazil.

* **Base URL:** `https://apiprevmet3.inmet.gov.br`
* **Method:** `GET`
* **Path:** `/previsao/{geocodigo}`
* **Format:** JSON
* **Auth:** None (Public)

### Request Parameters

| Parameter | Type | In | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `geocodigo` | `string` | path | Yes | 7-digit IBGE municipality code | `4305355` (Charqueadas) |

### Request Headers

| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `User-Agent` | `string` | Yes | Modern browser user agent string (e.g., `Mozilla/5.0...`). Required by INMET security firewalls. |
| `Accept` | `string` | Optional | `application/json` |

### Response Structure & Schema

The root object is keyed by the requested `geocodigo`. Its value is an object mapping forecast dates (`DD/MM/YYYY`) to period-specific or daily summary weather data:

* **Days 1 & 2 (Current day & Tomorrow):** Contain sub-objects for specific time periods:
  * `manha` (Morning: ~06:00 to 12:00)
  * `tarde` (Afternoon: ~12:00 to 18:00)
  * `noite` (Night: ~18:00 to 00:00)
* **Days 3, 4 & 5 (Days 3 to 5):** Contain a single daily summary object.

### Field Definitions

| Field Name | Type | Description | Sample Value |
| :--- | :--- | :--- | :--- |
| `uf` | `string` | State abbreviation | `"RS"` |
| `entidade` | `string` | Municipality name | `"Charqueadas"` |
| `resumo` | `string` | Weather condition description | `"Encoberto com pancadas de chuva e trovoadas"` |
| `temp_max` | `number` | Maximum expected temperature (°C) | `26` |
| `temp_min` | `number` | Minimum expected temperature (°C) | `14` |
| `temp_max_tende` | `string` | Max temperature trend description | `"Ligeira Elevação"`, `"Estável"` |
| `temp_min_tende` | `string` | Min temperature trend description | `"Ligeiro Declínio"`, `"Estável"` |
| `dir_vento` | `string` | Wind direction | `"SE-E"`, `"NE"`, `"S"` |
| `int_vento` | `string` | Wind intensity description | `"Fracos"`, `"Moderados com rajadas"` |
| `umidade_max` | `number` | Maximum relative humidity (%) | `95` |
| `umidade_min` | `number` | Minimum relative humidity (%) | `45` |
| `cod_icone` | `string` | Weather icon numeric identifier | `"6"` |
| `icone` | `string` | Base64-encoded PNG image string | `"data:image/png;base64,iVBORw0KG..."` |
| `estacao` | `string` | Astronomical season | `"Inverno"`, `"Primavera"` |
| `nascer` | `string` | Sunrise time (`HHhMM`) | `"07h04"` |
| `ocaso` | `string` | Sunset time (`HHhMM`) | `"18h05"` |

### Example Response Payload Snippet
```json
{
  "4305355": {
    "21/08/2026": {
      "manha": {
        "uf": "RS",
        "entidade": "Charqueadas",
        "resumo": "Muitas nuvens com possibilidade de chuva isolada",
        "temp_max": 22,
        "temp_min": 13,
        "temp_max_tende": "Ligeira Elevação",
        "temp_min_tende": "Ligeiro Declínio",
        "dir_vento": "E-NE",
        "int_vento": "Fracos a moderados com rajadas",
        "umidade_max": 95,
        "umidade_min": 60,
        "cod_icone": "4",
        "estacao": "Inverno",
        "nascer": "07h02",
        "ocaso": "18h02"
      },
      "tarde": { ... },
      "noite": { ... }
    },
    "22/08/2026": { ... },
    "23/08/2026": {
      "uf": "RS",
      "entidade": "Charqueadas",
      "resumo": "Pancadas de chuva e trovoadas",
      "temp_max": 24,
      "temp_min": 15,
      "dir_vento": "NE",
      "int_vento": "Moderados com rajadas",
      "umidade_max": 90,
      "umidade_min": 55
    }
  }
}
```

---

## 2. Active Severe Risk Warnings Endpoint: `/avisos/ativos`

Retrieves all currently active severe weather warnings across Brazil.

* **Base URL:** `https://apiprevmet3.inmet.gov.br`
* **Method:** `GET`
* **Path:** `/avisos/ativos`
* **Format:** JSON
* **Auth:** None (Public)

### Response Structure

The endpoint returns either a flat JSON array of warning objects, or an object partitioned by dates (e.g. `hoje`, `amanha`). The client normalizes both forms into a flat list.

### Warning Object Schema

| Field Name | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id_aviso` / `codigo` | `string` \| `number` | Unique warning ID | `129845` |
| `tipo` / `descricao` | `string` | Severe meteorological event type | `"Tempestade"`, `"Chuvas Intensas"`, `"Vendaval"`, `"Onda de Frio"` |
| `severidade` | `string` | Alert severity tier | `"Perigo Potencial"`, `"Perigo"`, `"Grande Perigo"` |
| `aviso_cor` | `string` | Official hex color indicator | `"#FFFE00"`, `"#F96602"`, `"#FF0000"` |
| `inicio` / `hora_inicio` | `string` | Alert start timestamp | `"2026-08-21 08:00"` or `"21/08/2026 08:00"` |
| `fim` / `hora_fim` | `string` | Alert expiration timestamp | `"2026-08-21 23:59"` or `"21/08/2026 23:59"` |
| `geocodes` | `string` | Comma-separated list of affected IBGE codes | `"4305355,4318408,4301107,4314902"` |
| `municipios` | `string` | String/list of affected municipality names | `"Charqueadas, São Jerônimo, Triunfo"` |
| `estados` | `string` | Affected states | `"Rio Grande do Sul, Santa Catarina"` |
| `riscos` | `array` \| `string` | Specific meteorological hazard statements | `["Chuva entre 30 e 60 mm/h", "Ventos intensos (60-100 km/h)", "Queda de granizo", "Risco de corte de energia elétrica"]` |
| `instrucoes` | `array` \| `string` | Recommended civil defense safety actions | `["Não se abrigue debaixo de árvores", "Não estacione veículos próximos a torres de transmissão", "Desligue aparelhos elétricos"]` |

### Filtering Implementation Pattern
```javascript
export async function getRegionalRiskWarnings(citiesList) {
    const rawData = await httpGet(`${BASE_PREVMET_URL}/avisos/ativos`);

    let allWarnings = [];
    if (Array.isArray(rawData)) {
        allWarnings = rawData;
    } else if (rawData && typeof rawData === 'object') {
        for (const key of Object.keys(rawData)) {
            if (Array.isArray(rawData[key])) {
                allWarnings.push(...rawData[key]);
            }
        }
    }

    const regionalWarnings = [];
    const stateWarnings = [];

    for (const warning of allWarnings) {
        const geocodes = String(warning.geocodes || '').split(',');
        const municipios = String(warning.municipios || '').toLowerCase();
        const estados = String(warning.estados || '');

        const affectedCities = citiesList.filter(c =>
            geocodes.includes(c.ibgeCode) || municipios.includes(c.name.toLowerCase())
        );

        if (affectedCities.length > 0) {
            regionalWarnings.push({
                ...warning,
                affectedRegionalCities: affectedCities.map(c => c.name)
            });
        } else if (estados.includes('Rio Grande do Sul') || estados.includes('RS')) {
            stateWarnings.push(warning);
        }
    }

    return { regionalWarnings, stateWarnings };
}
```

---

## 3. Automatic Weather Stations Endpoint: `/estacoes/T`

Lists all automatic surface weather stations operated by INMET across Brazil.

* **Base URL:** `https://apitempo.inmet.gov.br`
* **Method:** `GET`
* **Path:** `/estacoes/T`
* **Format:** JSON
* **Auth:** None (Public)

### Station Object Schema

| Field Name | Type | Description | Example (Porto Alegre) |
| :--- | :--- | :--- | :--- |
| `CD_ESTACAO` | `string` | Station alphanumeric code | `"A801"` |
| `DC_NOME` | `string` | Station location name | `"PORTO ALEGRE - JARDIM BOTANICO"` |
| `SG_ESTADO` | `string` | State code | `"RS"` |
| `VL_LATITUDE` | `number` | Station latitude (decimal degrees) | `-30.053888` |
| `VL_LONGITUDE` | `number` | Station longitude (decimal degrees) | `-51.174722` |
| `VL_ALTITUDE` | `number` | Station altitude above sea level (meters) | `46.97` |
| `DT_INICIO_OPERACAO` | `string` | Date station began operation | `"2000-09-22"` |
| `TP_ESTACAO` | `string` | Station type | `"Automatica"` |

### Key Reference Stations for Charqueadas Region
* **Porto Alegre (A801):** Lat `-30.0539`, Lon `-51.1747` (~35 km East of Charqueadas).
* **Campo Bom (A885):** Lat `-29.6761`, Lon `-51.0569` (~50 km Northeast of Charqueadas).
* **Rio Pardo (A883):** Lat `-29.9886`, Lon `-52.3783` (~74 km West of Charqueadas).
* **Caxias do Sul (A837):** Lat `-29.1644`, Lon `-51.1444` (~94 km North of Charqueadas).
* **Santa Cruz do Sul (A893):** Lat `-29.7186`, Lon `-52.4286` (~98 km West-Northwest of Charqueadas).

---

## 4. Native Node.js 26 HTTP Client Pattern

```javascript
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

export async function httpGet(url) {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} when fetching ${url}`);
    }
    return await response.json();
}
```
