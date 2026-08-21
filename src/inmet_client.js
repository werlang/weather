/**
 * INMET API Client for Weather Forecasts and Meteorological Risk Alerts.
 * Uses native Node 26 fetch API.
 * @module inmetClient
 */

import { logFetch } from '../database/log_database.js';

export const CHARQUEADAS_IBGE_CODE = process.env.CHARQUEADAS_IBGE_CODE || '4305355';
export const BASE_PREVMET_URL = process.env.INMET_PREVMET_URL || 'https://apiprevmet3.inmet.gov.br';
export const BASE_TEMPO_URL = process.env.INMET_TEMPO_URL || 'https://apitempo.inmet.gov.br';
export const BASE_IBGE_API_URL = process.env.IBGE_API_URL || 'https://servicodados.ibge.gov.br/api/v1/localidades';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

export const CHARQUEADAS_SURROUNDING_CITIES_100KM = [
    { ibgeCode: '4305355', name: 'Charqueadas', distKm: 0, ring: 'Centro Alvo' },
    { ibgeCode: '4318408', name: 'São Jerônimo', distKm: 5, ring: 'Zona Imediata (<25km)' },
    { ibgeCode: '4301107', name: 'Arroio dos Ratos', distKm: 12, ring: 'Zona Imediata (<25km)' },
    { ibgeCode: '4322004', name: 'Triunfo', distKm: 15, ring: 'Zona Imediata (<25km)' },
    { ibgeCode: '4306767', name: 'Eldorado do Sul', distKm: 20, ring: 'Zona Imediata (<25km)' },
    { ibgeCode: '4308805', name: 'General Câmara', distKm: 25, ring: 'Zona Imediata (<25km)' },
    { ibgeCode: '4321204', name: 'Taquari', distKm: 27, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4312401', name: 'Montenegro', distKm: 28, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4309308', name: 'Guaíba', distKm: 35, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4302709', name: 'Butiá', distKm: 35, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4301750', name: 'Barão do Triunfo', distKm: 40, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4313375', name: 'Nova Santa Rita', distKm: 40, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4311775', name: 'Mariana Pimentel', distKm: 40, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4314902', name: 'Porto Alegre', distKm: 45, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4304606', name: 'Canoas', distKm: 45, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4312252', name: 'Minas do Leão', distKm: 45, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4320651', name: 'Sertão Santana', distKm: 45, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4303103', name: 'Cachoeirinha', distKm: 48, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4320008', name: 'Sapucaia do Sul', distKm: 48, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4307708', name: 'Esteio', distKm: 50, ring: 'Zona Intermediária (25-50km)' },
    { ibgeCode: '4318705', name: 'São Leopoldo', distKm: 55, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4321402', name: 'Teutônia', distKm: 59, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4313409', name: 'Novo Hamburgo', distKm: 60, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4303905', name: 'Campo Bom', distKm: 62, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4323002', name: 'Viamão', distKm: 65, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4309209', name: 'Gravataí', distKm: 65, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4313953', name: 'Pantano Grande', distKm: 65, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4307609', name: 'Estrela', distKm: 70, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4311403', name: 'Lajeado', distKm: 74, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4315701', name: 'Rio Pardo', distKm: 74, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4322608', name: 'Venâncio Aires', distKm: 75, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4321105', name: 'Tapes', distKm: 80, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4302105', name: 'Bento Gonçalves', distKm: 88, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4303509', name: 'Camaquã', distKm: 90, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4304804', name: 'Carlos Barbosa', distKm: 90, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4308607', name: 'Garibaldi', distKm: 95, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4305108', name: 'Caxias do Sul', distKm: 94, ring: 'Anel Externo (50-100km)' },
    { ibgeCode: '4316800', name: 'Santa Cruz do Sul', distKm: 98, ring: 'Anel Externo (50-100km)' }
];

export const CHARQUEADAS_SURROUNDING_CITIES = CHARQUEADAS_SURROUNDING_CITIES_100KM;

/**
 * Performs an HTTP GET request with standard headers, logs request and response metadata
 * to SQLite, and returns parsed JSON.
 * 
 * @param {string} url - The target URL to fetch.
 * @param {object} [options]
 * @param {boolean} [options.log=true] - Whether to record this fetch into SQLite.
 * @param {object} [options.db] - Optional custom SQLite database instance.
 * @returns {Promise<any>} The parsed JSON payload.
 */
export async function httpGet(url, { log = true, db = null } = {}) {
    const startTime = Date.now();
    try {
        const response = await fetch(url, { headers: HEADERS });
        const durationMs = Date.now() - startTime;

        if (!response.ok) {
            const errorMsg = `HTTP error ${response.status} when fetching ${url}`;
            if (log) {
                logFetch({
                    url,
                    statusCode: response.status,
                    durationMs,
                    success: 0,
                    errorMessage: errorMsg
                }, db);
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();

        if (log) {
            let responseSizeBytes = null;
            try {
                const jsonStr = JSON.stringify(data);
                responseSizeBytes = Buffer.byteLength(jsonStr, 'utf8');
            } catch {}

            let itemCount = null;
            if (Array.isArray(data)) {
                itemCount = data.length;
            } else if (data && typeof data === 'object') {
                itemCount = Object.keys(data).length;
            }

            logFetch({
                url,
                statusCode: response.status,
                durationMs,
                success: 1,
                responseSizeBytes,
                itemCount,
                errorMessage: null
            }, db);
        }

        return data;
    } catch (err) {
        const durationMs = Date.now() - startTime;
        if (log && !err.message?.startsWith('HTTP error')) {
            logFetch({
                url,
                statusCode: null,
                durationMs,
                success: 0,
                errorMessage: err.message
            }, db);
        }
        throw err;
    }
}

/**
 * Retrieves list of surrounding municipalities within target radius (default 50km) around Charqueadas.
 * 
 * @param {number|string} [radiusKm=50] - Target radius in km (e.g. 25, 50, 75, 100).
 * @returns {Promise<Array<{ ibgeCode: string, name: string, distKm?: number, ring?: string, role?: string }>>}
 */
export async function getSurroundingCities(radiusKm = 50) {
    const maxRadius = typeof radiusKm === 'number' ? radiusKm : parseInt(radiusKm, 10) || 50;
    return CHARQUEADAS_SURROUNDING_CITIES_100KM.filter(c => (c.distKm ?? 0) <= maxRadius);
}

/**
 * Fetches the 5-day weather forecast for a given municipality IBGE code.
 * 
 * @param {string} [ibgeCode=CHARQUEADAS_IBGE_CODE] - 7-digit IBGE municipality code.
 * @returns {Promise<Record<string, any>>} Dictionary of forecasts indexed by date (DD/MM/YYYY).
 */
export async function getCityForecast(ibgeCode = CHARQUEADAS_IBGE_CODE) {
    const url = `${BASE_PREVMET_URL}/previsao/${ibgeCode}`;
    const data = await httpGet(url);
    return data?.[ibgeCode] || {};
}

/**
 * Fetches weather forecasts for Charqueadas and all surrounding municipalities in parallel.
 * 
 * @param {Array<{ ibgeCode: string, name: string }>} [citiesList]
 * @returns {Promise<Array<{ ibgeCode: string, name: string, role: string, forecast: Record<string, any> }>>}
 */
export async function getRegionalForecasts(citiesList) {
    const cities = citiesList || await getSurroundingCities();
    const promises = cities.map(async (city) => {
        try {
            const forecast = await getCityForecast(city.ibgeCode);
            return { ...city, forecast };
        } catch (err) {
            return { ...city, forecast: {}, error: err.message };
        }
    });
    return await Promise.all(promises);
}

/**
 * Fetches active meteorological risk warnings from INMET across Brazil and filters for the target municipality.
 * 
 * @param {string} [ibgeCode=CHARQUEADAS_IBGE_CODE] - 7-digit IBGE code.
 * @returns {Promise<{ directCityWarnings: Array<Record<string, any>>, regionalStateWarnings: Array<Record<string, any>> }>}
 */
export async function getActiveRiskWarnings(ibgeCode = CHARQUEADAS_IBGE_CODE) {
    const url = `${BASE_PREVMET_URL}/avisos/ativos`;
    const rawData = await httpGet(url);

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

    const directCityWarnings = [];
    const regionalStateWarnings = [];

    for (const warning of allWarnings) {
        const geocodes = String(warning.geocodes || '').split(',');
        const municipios = String(warning.municipios || '');
        const estados = String(warning.estados || '');

        if (geocodes.includes(ibgeCode) || municipios.includes('Charqueadas')) {
            directCityWarnings.push(warning);
        } else if (estados.includes('Rio Grande do Sul') || estados.includes('RS')) {
            regionalStateWarnings.push(warning);
        }
    }

    return { directCityWarnings, regionalStateWarnings };
}

/**
 * Fetches active INMET risk warnings and filters those affecting any city in the regional list.
 * 
 * @param {Array<{ ibgeCode: string, name: string }>} [citiesList]
 * @returns {Promise<{ regionalWarnings: Array<Record<string, any>>, stateWarnings: Array<Record<string, any>> }>}
 */
export async function getRegionalRiskWarnings(citiesList) {
    const cities = citiesList || await getSurroundingCities();
    const cityIbgeSet = new Set(cities.map(c => c.ibgeCode));
    const cityNameSet = new Set(cities.map(c => c.name.toLowerCase()));

    const url = `${BASE_PREVMET_URL}/avisos/ativos`;
    const rawData = await httpGet(url);

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

        const affectedCities = cities.filter(c =>
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

/**
 * Fetches all automatic weather stations from INMET.
 * 
 * @returns {Promise<Array<Record<string, any>>>} List of weather stations.
 */
export async function getAutomaticStations() {
    const url = `${BASE_TEMPO_URL}/estacoes/T`;
    return await httpGet(url);
}

/**
 * Converte a severidade ou o código de cor hexadecimal do aviso do INMET em um emoji intuitivo.
 * 
 * @param {Record<string, any>} warning - Objeto do aviso retornado pela API do INMET.
 * @returns {string} Emoji representando a severidade do alerta.
 */
export function getAlertEmoji(warning = {}) {
    const color = String(warning.aviso_cor || '').toUpperCase();
    const severity = String(warning.severidade || '').toLowerCase();

    if (color === '#FF0000' || severity.includes('grande perigo') || severity.includes('extremo')) {
        return '🔴'; // Grande Perigo / Risco Extremo (Vermelho)
    }
    if (color === '#F96602' || color === '#FFA500' || (severity.includes('perigo') && !severity.includes('potencial'))) {
        return '🟠'; // Perigo / Risco Severo (Laranja)
    }
    if (color === '#FFFE00' || color === '#FFFF00' || severity.includes('potencial') || severity.includes('moderado')) {
        return '🟡'; // Perigo Potencial / Risco Moderado (Amarelo)
    }

    return '⚪'; // Padrão / Informativo
}
