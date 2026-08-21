/**
 * Defesa Civil RS Hydrometeorological Network GraphQL Client.
 * Queries real-time telemetry from station DCRS-00032 (Charqueadas / Baixo Jacuí)
 * and regional monitoring stations in the Carbonífera / Baixo Jacuí / Guaíba basin.
 * 
 * Uses native Node.js 26 fetch API.
 * @module defesaCivilClient
 */

import { logFetch } from './log_database.js';

export const DEFESA_CIVIL_GRAPHQL_URL = process.env.DEFESA_CIVIL_GRAPHQL_URL || 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';
export const DEFESA_CIVIL_CLIENT_NAME = 'casa-militar-defesa-civil-rs';

export const CHARQUEADAS_STATION_CODE = 'DCRS-00032';

export const REGIONAL_STATIONS = [
    { code: 'DCRS-00032', name: 'Charqueadas', river: 'Rio Baixo Jacuí', basin: 'RS - Baixo Jacuí' },
    { code: 'DCRS-00093', name: 'General Câmara / São Jerônimo', river: 'Rio Baixo Jacuí', basin: 'RS - Baixo Jacuí' },
    { code: 'DCRS-00076', name: 'Eldorado do Sul', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba' },
    { code: 'DCRS-00054', name: 'Barra do Ribeiro', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba' },
    { code: 'DCRS-00033', name: 'Porto Alegre - Ipanema', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba' },
    { code: 'DCRS-00122', name: 'Porto Alegre - Cristal', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba' }
];

export const TAGS_DATA_QUERY = `
query GetStationTelemetry($stations: [String!], $clients: [String!]) {
  tags_data(station: $stations, clients: $clients) {
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
        umidade {
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
`;

/**
 * Fetches real-time hydrometeorological telemetry from Defesa Civil RS GraphQL endpoint.
 * 
 * @param {Array<string>} [stations] - List of station codes (defaults to target regional stations).
 * @param {object} [options]
 * @param {boolean} [options.log=true] - Whether to record fetch metadata in SQLite.
 * @param {object} [options.db=null] - Custom SQLite instance for tests.
 * @returns {Promise<Array<object>>} List of telemetry objects per station.
 */
export async function getDefesaCivilTelemetry(stations = ['DCRS-00032', 'DCRS-00093', 'DCRS-00076', 'DCRS-00054'], { log = true, db = null } = {}) {
    const startTime = Date.now();
    const payload = {
        query: TAGS_DATA_QUERY,
        variables: {
            stations,
            clients: [DEFESA_CIVIL_CLIENT_NAME]
        }
    };

    try {
        const response = await fetch(DEFESA_CIVIL_GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'WeatherMonitor-Charqueadas/1.0'
            },
            body: JSON.stringify(payload)
        });

        const durationMs = Date.now() - startTime;

        if (!response.ok) {
            const errorMsg = `Defesa Civil GraphQL error ${response.status} when fetching telemetry`;
            if (log) {
                logFetch({
                    url: DEFESA_CIVIL_GRAPHQL_URL,
                    endpoint: '/graphql?query=Tags_data',
                    statusCode: response.status,
                    durationMs,
                    success: 0,
                    errorMessage: errorMsg
                }, db);
            }
            return [];
        }

        const data = await response.json();
        const stationsList = data?.data?.tags_data?.qualle_meteorologia || [];

        if (log) {
            let responseSizeBytes = null;
            try {
                responseSizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
            } catch {}

            logFetch({
                url: DEFESA_CIVIL_GRAPHQL_URL,
                endpoint: '/graphql?query=Tags_data',
                statusCode: response.status,
                durationMs,
                success: 1,
                responseSizeBytes,
                itemCount: stationsList.length,
                errorMessage: null
            }, db);
        }

        return stationsList;
    } catch (err) {
        const durationMs = Date.now() - startTime;
        if (log) {
            logFetch({
                url: DEFESA_CIVIL_GRAPHQL_URL,
                endpoint: '/graphql?query=Tags_data',
                statusCode: null,
                durationMs,
                success: 0,
                errorMessage: err.message
            }, db);
        }
        return [];
    }
}

/**
 * Evaluates Defesa Civil RS telemetry measurements for Orange (Alerta) or Red (Alerta Máximo) thresholds.
 * 
 * Criteria:
 * - 🔴 Red (Extremo): Rain > 50 mm/h or > 80 mm/3h, Wind >= 100 km/h, Jacuí River level in flood emergency.
 * - 🟠 Orange (Alerta / Risco Severo): Rain >= 20 mm/15min or >= 30 mm/h or >= 50 mm/3h, Wind >= 75 km/h, Jacuí River level in rapid surge.
 * 
 * @param {Array<object>} stationsData - Array of station telemetry objects from GraphQL.
 * @returns {Array<object>} Detected Defesa Civil risk events.
 */
export function evaluateDefesaCivilRisks(stationsData = []) {
    const risks = [];
    if (!Array.isArray(stationsData)) return risks;

    for (const station of stationsData) {
        const code = station.codigo;
        const stationMeta = REGIONAL_STATIONS.find(s => s.code === code) || { name: station.name?.local || code };
        const cityName = stationMeta.name;
        const data = station.data || {};

        const rain15min = parseFloat(data.chuva?.acumulado?.min015?.value) || 0;
        const rain1h = parseFloat(data.chuva?.acumulado?.h001?.value) || 0;
        const rain3h = parseFloat(data.chuva?.acumulado?.h003?.value) || 0;
        const rain24h = parseFloat(data.chuva?.acumulado?.h024?.value) || 0;
        const windGust = parseFloat(data.vento?.velocidade_maxima?.value) || 0;
        const riverLevel = parseFloat(data.rio?.rio_nivel?.value) || null;
        const riverTrend = parseFloat(data.rio?.rio_nivel_tendencia?.value) || 0;
        const riverName = data.rio?.rio_nome?.value || stationMeta.river || 'Rio Jacuí';

        // 1. Chuva Torrencial / Acúmulo Rápido (Orange / Red)
        if (rain1h >= 50 || rain3h >= 80) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Chuva Torrencial Extrema (Telemetria)',
                severity: 'Alerta Máximo (Red)',
                colorTier: 'RED',
                emoji: '🔴',
                affectedCities: [cityName],
                timeframe: 'Telemetria em Tempo Real',
                details: `Acúmulo crítico registrado: ${rain1h} mm em 1h (${rain3h} mm em 3h) na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Precipitação extrema (${rain1h} mm/h) com risco iminente de alagamentos severos.`
            });
        } else if (rain15min >= 20 || rain1h >= 30 || rain3h >= 50) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Chuva Intensa / Risco de Alagamento (Telemetria)',
                severity: 'Alerta (Orange)',
                colorTier: 'ORANGE',
                emoji: '🟠',
                affectedCities: [cityName],
                timeframe: 'Telemetria em Tempo Real',
                details: `Pico de chuva registrado: ${rain15min} mm em 15min / ${rain1h} mm em 1h (${rain3h} mm em 3h) na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Alerta de chuva intensa (${rain1h} mm/h) com impacto no trânsito e transporte.`
            });
        }

        // 2. Rajadas de Vento Severas (Orange / Red)
        if (windGust >= 100) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Vendaval / Rajada Extrema (Telemetria)',
                severity: 'Alerta Máximo (Red)',
                colorTier: 'RED',
                emoji: '🔴',
                affectedCities: [cityName],
                timeframe: 'Telemetria em Tempo Real',
                details: `Rajada de vento destrutiva registrada: ${windGust} km/h na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Rajadas de vento extremas (${windGust} km/h) com perigo de colapso estrutural e quedas de árvores.`
            });
        } else if (windGust >= 75) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Vendaval / Rajadas Fortes (Telemetria)',
                severity: 'Alerta (Orange)',
                colorTier: 'ORANGE',
                emoji: '🟠',
                affectedCities: [cityName],
                timeframe: 'Telemetria em Tempo Real',
                details: `Rajada de vento severa registrada: ${windGust} km/h na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Alerta de ventos fortes (${windGust} km/h) com risco a vias e transporte escolar.`
            });
        }

        // 3. Nível e Tendência do Rio (Baixo Jacuí / Guaíba)
        if (riverLevel !== null) {
            // Se cota de elevação rápida (> +0.5m/h) ou cota extrema
            if (riverTrend >= 0.5) {
                risks.push({
                    source: 'DEFESA_CIVIL_RS',
                    type: `Elevação Crítica do ${riverName} (Telemetria)`,
                    severity: 'Alerta Máximo (Red)',
                    colorTier: 'RED',
                    emoji: '🔴',
                    affectedCities: [cityName],
                    timeframe: 'Telemetria em Tempo Real',
                    details: `Nível do rio: ${riverLevel}m com subida rápida de +${riverTrend}m/h na estação ${code} (${cityName}).`,
                    triggerReason: `Defesa Civil RS: Elevação acelerada do ${riverName} com risco de transbordamento.`
                });
            } else if (riverTrend >= 0.25) {
                risks.push({
                    source: 'DEFESA_CIVIL_RS',
                    type: `Elevação do ${riverName} (Telemetria)`,
                    severity: 'Alerta (Orange)',
                    colorTier: 'ORANGE',
                    emoji: '🟠',
                    affectedCities: [cityName],
                    timeframe: 'Telemetria em Tempo Real',
                    details: `Nível do rio: ${riverLevel}m com tendência de alta (+${riverTrend}m/h) na estação ${code} (${cityName}).`,
                    triggerReason: `Defesa Civil RS: Alerta de subida do ${riverName}.`
                });
            }
        }
    }

    return risks;
}
