# Weather & Meteorological Risk Monitoring — Charqueadas, RS

A project and documentation suite for programmatically monitoring INMET weather forecasts, active meteorological risk situations, and station data for **Charqueadas - RS** (IBGE Code: `4305355`), structured using Node.js 26 and Docker Compose.

---

## 📁 Repository Structure

```
ifsul/weather/
├── README.md
├── package.json                      # Project manifest & NPM scripts
├── Dockerfile                        # Multi-stage Docker build (development & production)
├── compose.yaml                      # Production Compose specification
├── compose.dev.yaml                  # Development Compose specification (live volume mounts)
├── .env.example                      # Environment variables template
├── .env                              # Active environment configuration
├── docs/
│   ├── INMET_API_DOCUMENTATION.md    # Detailed API reference for INMET endpoints
│   └── METEOROLOGICAL_RISKS_GUIDE.md  # Guide on severe weather alert levels and filtering logic
├── src/
│   ├── inmet_client.js               # Reusable Node 26 API client for INMET & IBGE
│   ├── monitor_charqueadas.js        # Single city monitoring script for Charqueadas - RS
│   └── monitor_regional_risks.js     # Regional risk monitoring script for Charqueadas & surrounding cities
└── tests/
    └── inmet_client.test.js          # Unit tests using Node built-in test runner
```

---

## 🚀 Quick Start (Running via Docker Compose & Node 26)

### 1. Run Development Stack
```bash
docker compose -f compose.dev.yaml up --build
```

### 2. Run Production Stack
```bash
docker compose -f compose.yaml up --build
```

### 3. Run Standalone Single City Monitor (Charqueadas)
```bash
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node /app/src/monitor_charqueadas.js
```

### 4. Run Standalone Regional Risk Monitor (Default 50km or Custom Distance)
```bash
# Default (50 km radius):
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node /app/src/monitor_regional_risks.js

# Custom Distance (e.g. 100 km radius):
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node /app/src/monitor_regional_risks.js 100
# or
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node /app/src/monitor_regional_risks.js --radius=100
```

### 5. Running Unit Tests
```bash
docker run --rm -v /Users/pablowerlang/Documents/Workspaces/ifsul/weather:/app node:26-alpine node --test /app/tests/inmet_client.test.js
```

---

## 🌐 Quick API Reference

### 1. Forecast for Charqueadas - RS
```http
GET https://apiprevmet3.inmet.gov.br/previsao/4305355
```

### 2. Microregion Municipalities Endpoint (IBGE)
```http
GET https://servicodados.ibge.gov.br/api/v1/localidades/microrregioes/43025/municipios
```

### 3. Active Severe Risk Alerts (Brazil & Regional Filter)
```http
GET https://apiprevmet3.inmet.gov.br/avisos/ativos
```

### 4. Automatic Weather Stations List
```http
GET https://apitempo.inmet.gov.br/estacoes/T
```

---

## 📚 Documentation Links
* [INMET API Technical Documentation](docs/INMET_API_DOCUMENTATION.md)
* [Meteorological Risk Situations Guide](docs/METEOROLOGICAL_RISKS_GUIDE.md)
