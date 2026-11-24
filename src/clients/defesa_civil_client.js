/**
 * Defesa Civil RS Hydrometeorological Network GraphQL Client.
 * Queries real-time telemetry from station DCRS-00032 (Charqueadas / Baixo Jacuí)
 * and regional monitoring stations in the Carbonífera / Baixo Jacuí / Guaíba basin.
 * 
 * Uses native Node.js 26 fetch API.
 * @module defesaCivilClient
 */

import { readFileSync } from 'node:fs';

import { logFetch, logUnknownAlert } from '../model/log_database.js';
import { readBoundedNumber } from '../helpers/env_number.js';

export const DEFESA_CIVIL_GRAPHQL_URL = process.env.DEFESA_CIVIL_GRAPHQL_URL || 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';
export const DEFESA_CIVIL_CLIENT_NAME = 'casa-militar-defesa-civil-rs';

const DEFESA_CIVIL_ENDPOINT = '/graphql?query=Tags_data';
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
const DEFAULT_FETCH_RETRIES = 1;
const DEFAULT_FETCH_RETRY_DELAY_MS = 1000;

export const CHARQUEADAS_STATION_CODE = 'DCRS-00032';

export const REGIONAL_STATIONS = [
    // alertLevelM / floodLevelM = official cota de alerta / cota de inundação (m) per gauge.
    // Sources: Defesa Civil RS bulletins reported by Correio do Povo / Rádio Guaíba
    // (2026-07-23/24), ANA telemetry via nivelguaiba.com.br, estado.rs.gov.br (2024-05-28).
    // Charqueadas cota de alerta is an upper bound: water had already surpassed it at 4.05m.
    // São Jerônimo alert value is provisional (flood - 0.5m); official figure unverified.
    // Guaíba lake stations use the Cais Mauá C6 reference gauge (ANA 87450004):
    // inundação 3.0m is the only formally registered ANA quota; the 2.55m alerta
    // is the Defesa Civil RS operational trigger (2026 press often cites 2.50m).
    // Verify each station's local datum against its reference gauge before trusting absolutes.
    { code: 'DCRS-00032', name: 'Charqueadas', river: 'Rio Baixo Jacuí', basin: 'RS - Baixo Jacuí', alertLevelM: 4.05, floodLevelM: 4.6 },
    { code: 'DCRS-00093', name: 'General Câmara / São Jerônimo', river: 'Rio Baixo Jacuí', basin: 'RS - Baixo Jacuí', alertLevelM: 4.14, floodLevelM: 4.64 },
    { code: 'DCRS-00076', name: 'Eldorado do Sul', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba', alertLevelM: 2.55, floodLevelM: 3 },
    { code: 'DCRS-00054', name: 'Barra do Ribeiro', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba', alertLevelM: 2.55, floodLevelM: 3 },
    { code: 'DCRS-00033', name: 'Porto Alegre - Ipanema', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba', alertLevelM: 2.55, floodLevelM: 3 },
    { code: 'DCRS-00122', name: 'Porto Alegre - Cristal', river: 'Rio Lago Guaíba', basin: 'RS - Lago Guaíba', alertLevelM: 2.55, floodLevelM: 3 }
];

/**
 * Upper bound for a plausible surface wind gust, in km/h.
 *
 * The highest reliably instrumented gust outside a tornado is 408 km/h
 * (Cyclone Olivia, Barrow Island AU, 1996), and an ordinary river-gauge
 * station never approaches it. Above this ceiling the reading is an instrument
 * fault: DCRS-00093 published a saturated 16-bit register (65535/100 =
 * 655.35 km/h) continuously from 2026-09-21 to 2026-09-24, re-firing a RED
 * "Vendaval" alert on every scan cycle.
 * @type {number}
 */
export const MAX_PLAUSIBLE_WIND_GUST_KMH = 300;

/**
 * Upper bound for a wind direction reading, in degrees (a compass bearing is 0–360).
 * @type {number}
 */
export const MAX_PLAUSIBLE_WIND_DIRECTION_DEG = 360;

/**
 * Detects wind telemetry that cannot be a meteorological measurement.
 *
 * Covers the two fault signatures seen in the field:
 * - an impossible magnitude, typically a raw register saturating at 0xFFFF;
 * - an impossible direction (a bearing outside 0–360°, e.g. 6553.5°).
 *
 * Absent or null channels are not faults: stations legitimately publish null
 * when a sensor drops, and the caller already treats them as zero.
 *
 * @param {object|null} [vento=null] - The station `data.vento` block.
 * @returns {string|null} Human-readable fault description, or null when the reading is usable.
 */
export function describeWindSensorFault(vento = null) {
    const gust = parseFloat(vento?.velocidade_maxima?.value);
    const direction = parseFloat(vento?.direcao?.value);

    if (Number.isFinite(gust) && gust > MAX_PLAUSIBLE_WIND_GUST_KMH) {
        return `rajada de ${gust} km/h acima do teto plausível (${MAX_PLAUSIBLE_WIND_GUST_KMH} km/h)`;
    }
    if (Number.isFinite(direction) && (direction < 0 || direction > MAX_PLAUSIBLE_WIND_DIRECTION_DEG)) {
        return `direção de ${direction}° fora do intervalo 0-${MAX_PLAUSIBLE_WIND_DIRECTION_DEG}°`;
    }
    return null;
}

/**
 * Official `Tags_data` GraphQL query published by Defesa Civil RS.
 *
 * The endpoint validates the query text against an exact allowlist and rejects
 * any other spelling with `QUERY_NOT_ALLOWED`, so this string is loaded
 * byte-for-byte from `tags_data.graphql`. Do not re-indent or edit it locally;
 * replace the file only with the text published in the API guide. The client
 * name is embedded in the query and must match `DEFESA_CIVIL_CLIENT_NAME`.
 * @type {string}
 */
export const TAGS_DATA_QUERY = readFileSync(new URL('./tags_data.graphql', import.meta.url), 'utf8');

/**
 * Waits before another fetch attempt.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves once the delay elapses.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolves the per-attempt timeout from an explicit option, `DEFESA_CIVIL_TIMEOUT_MS`,
 * or the 20 s default.
 *
 * @param {number|undefined} timeoutMs - Explicit per-call timeout in milliseconds.
 * @returns {number} Positive timeout in milliseconds.
 */
function resolveTimeoutMs(timeoutMs) {
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
    }
    return readBoundedNumber(process.env.DEFESA_CIVIL_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS, { min: 1000, max: 120000 });
}

/**
 * Decides whether a failed Defesa Civil fetch attempt is worth retrying.
 *
 * Only transport errors (no HTTP status), timeouts, and 5xx server responses
 * are transient. 4xx responses and GraphQL application errors such as
 * `QUERY_NOT_ALLOWED` are deterministic and must not be retried.
 *
 * @param {{ statusCode: number|null, timedOut?: boolean }} failure - Failure metadata from one attempt.
 * @returns {boolean} True when another attempt may succeed.
 */
function isRetryableDefesaCivilFailure({ statusCode, timedOut = false }) {
    if (timedOut) return true;
    if (statusCode === null || statusCode === undefined) return true;
    return statusCode >= 500;
}

/**
 * Fetches real-time hydrometeorological telemetry from Defesa Civil RS GraphQL endpoint.
 *
 * The official query returns every station in the network. The response is
 * filtered down to the requested `stations`, so callers keep receiving only
 * the regional stations they asked for. Each attempt carries a per-attempt
 * timeout (`AbortSignal.timeout`) and transient failures (transport, timeout,
 * or 5xx) are retried once with a short backoff; every attempt is logged to
 * `fetch_logs` with its HTTP status code when available.
 *
 * @param {Array<string>} [stations] - List of station codes (defaults to target regional stations).
 * @param {object} [options]
 * @param {boolean} [options.log=true] - Whether to record fetch metadata in SQLite.
 * @param {object} [options.db=null] - Custom SQLite instance for tests.
 * @param {boolean} [options.throwOnError=false] - Propagate transport and GraphQL errors to the coordinator.
 * @param {number} [options.timeoutMs] - Per-attempt timeout in ms (`DEFESA_CIVIL_TIMEOUT_MS`, default 20000).
 * @param {number} [options.retries=1] - Extra attempts after a transient failure (default 1, total <= 2).
 * @param {number} [options.retryDelayMs=1000] - Backoff in ms between attempts (default 1000).
 * @returns {Promise<Array<object>>} List of telemetry objects per station.
 * @throws {Error} When throwOnError is true and the request or GraphQL response fails.
 */
export async function getDefesaCivilTelemetry(
    stations = ['DCRS-00032', 'DCRS-00093', 'DCRS-00076', 'DCRS-00054'],
    {
        log = true,
        db = null,
        throwOnError = false,
        timeoutMs = undefined,
        retries = DEFAULT_FETCH_RETRIES,
        retryDelayMs = DEFAULT_FETCH_RETRY_DELAY_MS
    } = {}
) {
    const payload = { query: TAGS_DATA_QUERY };
    const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs);
    const attemptLimit = Math.max(0, Number(retries) || 0) + 1;
    const effectiveRetryDelayMs = Math.max(0, Number(retryDelayMs) || 0);

    let lastError = null;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
        const attemptStartTime = Date.now();
        const signal = AbortSignal.timeout(effectiveTimeoutMs);
        let statusCode = null;
        let timedOut = false;

        try {
            const response = await fetch(DEFESA_CIVIL_GRAPHQL_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'WeatherMonitor-Charqueadas/1.0'
                },
                body: JSON.stringify(payload),
                signal
            });

            statusCode = response.status;

            if (!response.ok) {
                const error = new Error(`Defesa Civil GraphQL error ${statusCode} when fetching telemetry`);
                error.statusCode = statusCode;
                throw error;
            }

            const data = await response.json();
            if (Array.isArray(data?.errors) && data.errors.length > 0) {
                const error = new Error(`Defesa Civil GraphQL returned ${data.errors.length} error(s) when fetching telemetry`);
                error.statusCode = statusCode;
                throw error;
            }

            const requestedStations = new Set(stations);
            const stationsList = (data?.data?.tags_data?.qualle_meteorologia || [])
                .filter(station => requestedStations.has(station.codigo));

            if (log) {
                let responseSizeBytes = null;
                try {
                    responseSizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
                } catch {}

                logFetch({
                    url: DEFESA_CIVIL_GRAPHQL_URL,
                    endpoint: DEFESA_CIVIL_ENDPOINT,
                    statusCode,
                    durationMs: Date.now() - attemptStartTime,
                    success: 1,
                    responseSizeBytes,
                    itemCount: stationsList.length,
                    errorMessage: null
                }, db);
            }

            return stationsList;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (statusCode === null && typeof error.statusCode === 'number') {
                statusCode = error.statusCode;
            }
            timedOut = signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError';
            lastError = error;

            if (log) {
                logFetch({
                    url: DEFESA_CIVIL_GRAPHQL_URL,
                    endpoint: DEFESA_CIVIL_ENDPOINT,
                    statusCode,
                    durationMs: Date.now() - attemptStartTime,
                    success: 0,
                    errorMessage: error.message
                }, db);
            }

            if (attempt >= attemptLimit || !isRetryableDefesaCivilFailure({ statusCode, timedOut })) {
                break;
            }

            if (effectiveRetryDelayMs > 0) {
                await sleep(effectiveRetryDelayMs);
            }
        }
    }

    if (throwOnError) throw lastError;
    return [];
}

/**
 * Evaluates Defesa Civil RS telemetry measurements for Orange (Alerta) or Red (Alerta Máximo) thresholds.
 * 
 * Criteria:
 * - 🔴 Red (Extremo): Rain > 50 mm/h or > 80 mm/3h, Wind >= 100 km/h, river level >= the station's official cota de inundação (`floodLevelM`) or rising >= 0.5 m/h.
 * - 🟠 Orange (Alerta / Risco Severo): Rain >= 20 mm/15min equivalent (5-minute `min005` reading x3) or >= 30 mm/h or >= 50 mm/3h, Wind >= 75 km/h, river level above the station's official cota de alerta (`alertLevelM`) or rising >= 0.25 m/h.
 * 
 * River absolute-level rules use the per-station official quotas declared in
 * `REGIONAL_STATIONS`; stations without registered quotas fall back to
 * trend-only detection. See `docs/ALERT_METHODOLOGY.md` §5.3.1 for sources.
 *
 * Reporting policy: telemetry values are relayed verbatim as published by
 * the station, with one exception — readings that cannot be meteorological
 * data at all are discarded and registered in `unknown_alert_sources` instead
 * of raising an alert (see `describeWindSensorFault`: a saturated 16-bit
 * register such as the 655.35 km/h / 6553.5° pair published by DCRS-00093, or
 * a bearing outside 0–360°). Genuine extreme values are still relayed without
 * downscaling. Station labels covering two municipalities
 * (e.g. "General Camara / Sao Jeronimo") are split so `affectedCities`
 * contains real municipality names.
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
        // A station label may cover two municipalities ("General Camara / Sao Jeronimo").
        // Split on "/" so affectedCities uses real municipality names and unique-city
        // counts never exceed the monitored catalog (39-de-38 bug, 2026-09-21).
        const affectedCities = String(cityName || code).split('/').map(s => s.trim()).filter(Boolean);
        const data = station.data || {};

        const rain5min = (() => { const n = parseFloat(data.chuva?.acumulado?.min005?.value); return Number.isFinite(n) ? n : 0; })();
        // The API replaced the 15-minute bucket (`min015`) with a 5-minute one
        // (`min005`). Normalizing x3 preserves the old 20 mm/15min rain rate
        // (84 mm/h) instead of silently making the Orange trigger 3x stricter.
        const rain15minEquivalent = rain5min * 3;
        const rain1h = (() => { const n = parseFloat(data.chuva?.acumulado?.h001?.value); return Number.isFinite(n) ? n : 0; })();
        const rain3h = (() => { const n = parseFloat(data.chuva?.acumulado?.h003?.value); return Number.isFinite(n) ? n : 0; })();
        const rain24h = (() => { const n = parseFloat(data.chuva?.acumulado?.h024?.value); return Number.isFinite(n) ? n : 0; })();
        const windGust = (() => { const n = parseFloat(data.vento?.velocidade_maxima?.value); return Number.isFinite(n) ? n : 0; })();
        const windFaultReason = describeWindSensorFault(data.vento);
        const riverLevel = (() => { const v = data.rio?.rio_nivel?.value; if (v === null || v === undefined || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; })();
        const riverTrend = (() => { const n = parseFloat(data.rio?.rio_nivel_tendencia?.value); return Number.isFinite(n) ? n : 0; })();
        const riverName = data.rio?.rio_nome?.value || stationMeta.river || 'Rio Jacuí';

        // 1. Chuva Torrencial / Acúmulo Rápido (Orange / Red)
        if (rain1h >= 50 || rain3h >= 80) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Chuva Torrencial Extrema (Telemetria)',
                category: 'chuva',
                severity: 'Alerta Máximo (Red)',
                colorTier: 'RED',
                emoji: '🔴',
                affectedCities: [...affectedCities],
                timeframe: 'Telemetria em Tempo Real',
                details: `Acúmulo crítico registrado: ${rain1h} mm em 1h (${rain3h} mm em 3h) na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Precipitação extrema (${rain1h} mm/h) com risco iminente de alagamentos severos.`
            });
        } else if (rain15minEquivalent >= 20 || rain1h >= 30 || rain3h >= 50 || rain24h >= 80) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Chuva Intensa / Risco de Alagamento (Telemetria)',
                category: 'chuva',
                severity: 'Alerta (Orange)',
                colorTier: 'ORANGE',
                emoji: '🟠',
                affectedCities: [...affectedCities],
                timeframe: 'Telemetria em Tempo Real',
                details: `Acúmulo de chuva registrado: ${rain5min} mm em 5min (${rain15minEquivalent} mm equivalentes em 15min) / ${rain1h} mm em 1h / ${rain3h} mm em 3h / ${rain24h} mm em 24h na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Acúmulo de chuva com risco de saturação e alagamentos.`
            });
        }

        // 2. Rajadas de Vento Severas (Orange / Red)
        // Sensor-quality gate: a faulted reading is registered once per station
        // (dedupe key) for audit and never reaches the severity thresholds.
        if (windFaultReason) {
            logUnknownAlert({
                dedupeKey: `defesa_civil_wind_fault:${code}`,
                sourceType: 'defesa_civil_telemetry',
                externalId: code,
                rawText: `Leitura de vento descartada por falha do sensor: ${windFaultReason} (estação ${code} / ${cityName})`,
                city: cityName
            });
        } else if (windGust >= 100) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Vendaval / Rajada Extrema (Telemetria)',
                category: 'vento',
                severity: 'Alerta Máximo (Red)',
                colorTier: 'RED',
                emoji: '🔴',
                affectedCities: [...affectedCities],
                timeframe: 'Telemetria em Tempo Real',
                details: `Rajada de vento destrutiva registrada: ${windGust} km/h na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Rajadas de vento extremas (${windGust} km/h) com perigo de colapso estrutural e quedas de árvores.`
            });
        } else if (windGust >= 75) {
            risks.push({
                source: 'DEFESA_CIVIL_RS',
                type: 'Vendaval / Rajadas Fortes (Telemetria)',
                category: 'vento',
                severity: 'Alerta (Orange)',
                colorTier: 'ORANGE',
                emoji: '🟠',
                affectedCities: [...affectedCities],
                timeframe: 'Telemetria em Tempo Real',
                details: `Rajada de vento severa registrada: ${windGust} km/h na estação ${code} (${cityName}).`,
                triggerReason: `Defesa Civil RS: Alerta de ventos fortes (${windGust} km/h) com risco a vias e transporte escolar.`
            });
        }

        // 3. Nível e Tendência do Rio (cotas oficiais por estação)
        if (riverLevel !== null) {
            const redByQuota = stationMeta.floodLevelM != null && riverLevel >= stationMeta.floodLevelM;
            const orangeByQuota = stationMeta.alertLevelM != null && riverLevel > stationMeta.alertLevelM;

            // A cota absoluta mantém o alerta ativo mesmo quando a subida estabiliza.
            if (redByQuota || riverTrend >= 0.5) {
                const quotaInfo = stationMeta.floodLevelM != null ? ` (cota de inundação: ${stationMeta.floodLevelM}m)` : '';
                risks.push({
                    source: 'DEFESA_CIVIL_RS',
                    type: `Elevação Crítica do ${riverName} (Telemetria)`,
                    category: 'rio',
                    severity: 'Alerta Máximo (Red)',
                    colorTier: 'RED',
                    emoji: '🔴',
                    affectedCities: [...affectedCities],
                    timeframe: 'Telemetria em Tempo Real',
                    details: `Nível do rio: ${riverLevel}m${quotaInfo} com subida rápida de +${riverTrend}m/h na estação ${code} (${cityName}).`,
                    triggerReason: `Defesa Civil RS: Elevação acelerada do ${riverName} com risco de transbordamento.`
                });
            } else if (orangeByQuota || riverTrend >= 0.25) {
                const quotaInfo = orangeByQuota ? ` acima da cota de alerta (${stationMeta.alertLevelM}m)` : '';
                risks.push({
                    source: 'DEFESA_CIVIL_RS',
                    type: `Elevação do ${riverName} (Telemetria)`,
                    category: 'rio',
                    severity: 'Alerta (Orange)',
                    colorTier: 'ORANGE',
                    emoji: '🟠',
                    affectedCities: [...affectedCities],
                    timeframe: 'Telemetria em Tempo Real',
                    details: `Nível do rio: ${riverLevel}m${quotaInfo} com tendência de alta (+${riverTrend}m/h) na estação ${code} (${cityName}).`,
                    triggerReason: `Defesa Civil RS: Alerta de subida do ${riverName}.`
                });
            }
        }
    }

    return risks;
}
