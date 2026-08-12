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
│   ├── INMET_API_DOCUMENTATION.md          # Detailed API reference for INMET endpoints
│   ├── DEFESA_CIVIL_RS_API_DOCUMENTATION.md # Detailed GraphQL & WebSocket API reference for Defesa Civil RS
│   └── METEOROLOGICAL_RISKS_GUIDE.md        # Guide on severe weather alert levels and filtering logic
├── src/
│   ├── inmet_client.js               # Reusable Node 26 API client for INMET & IBGE
│   ├── risk_analyzer.js              # Shared risk analysis and CLI argument parsing utilities
│   ├── monitor_service.js            # Long-running service triggered by npm start for 24h risk monitoring
│   └── monitor_regional_risks.js     # On-demand CLI regional risk report generator
└── tests/
    ├── inmet_client.test.js          # Unit tests for INMET client
    └── monitor_service.test.js       # Unit tests for 24h window risk monitoring service
```

---

## 🚀 Quick Start (Running via Docker Compose & Node 26)

### 1. Run Continuous Regional Monitoring Service (`npm start`)
```bash
# Starts long-running service with continuous regional risk monitoring
npm start
# or via Docker Compose
docker compose up --build
```

Configurable via `.env`:
- `MONITOR_INTERVAL_MINUTES`: Interval between checks (default: `15` minutes)
- `RADIUS_KM`: Regional monitoring radius in kilometers (default: `50` km)

When a high-risk meteorological event is detected in the next 24h window, it executes the placeholder function `onHighRiskEventDetected(highRiskEvents)` in `src/monitor_service.js`.

### 2. Run Development Stack
```bash
docker compose -f compose.dev.yaml up --build
```

### 3. Run Standalone Regional Risk CLI Report (Default 50km or Custom Distance)
```bash
# Default (50 km radius):
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js

# Custom Distance (e.g. 100 km radius):
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 100
```

### 4. Running Unit Tests
```bash
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test
```

---

## 🌐 Quick API Reference

### 1. Forecast for Charqueadas - RS (INMET)
```http
GET https://apiprevmet3.inmet.gov.br/previsao/4305355
```

### 2. Defesa Civil RS Real-time Telemetry (Charqueadas Station `DCRS-00032`)
```http
POST https://redehidrometeorologica.defesacivil.rs.gov.br/graphql
```

### 3. Microregion Municipalities Endpoint (IBGE)
```http
GET https://servicodados.ibge.gov.br/api/v1/localidades/microrregioes/43025/municipios
```

### 4. Active Severe Risk Alerts (Brazil & Regional Filter - INMET)
```http
GET https://apiprevmet3.inmet.gov.br/avisos/ativos
```

### 5. Automatic Weather Stations List (INMET)
```http
GET https://apitempo.inmet.gov.br/estacoes/T
```

---

## 📚 Documentation Links
* [INMET API Technical Documentation](docs/INMET_API_DOCUMENTATION.md)
* [Defesa Civil RS Hydrometeorological Network API Documentation](docs/DEFESA_CIVIL_RS_API_DOCUMENTATION.md)
* [Meteorological Risk Situations Guide](docs/METEOROLOGICAL_RISKS_GUIDE.md)

