/**
 * Módulo Compartilhado de Análise de Riscos Meteorológicos.
 * Fornece métodos calibrados para identificação de eventos meteorológicos severos
 * com suporte a níveis de severidade independentes para cada instituto (INMET e DEFESA CIVIL RS).
 * 
 * @module riskAnalyzer
 */

import { getAlertEmoji } from './inmet_client.js';
import { evaluateDefesaCivilRisks } from './defesa_civil_client.js';

/**
 * Severity ranking map for comparison.
 * OFF: 0, YELLOW: 1, ORANGE: 2, RED: 3
 */
export const SEVERITY_LEVELS = {
    OFF: 0,
    YELLOW: 1,
    ORANGE: 2,
    RED: 3
};

/**
 * Normalizes input severity strings to canonical uppercase tiers.
 * 
 * @param {string|number} tier - Input tier representation.
 * @returns {'OFF' | 'YELLOW' | 'ORANGE' | 'RED'}
 */
export function normalizeSeverityTier(tier) {
    const upper = String(tier || '').toUpperCase().trim();
    if (upper === 'RED' || upper === 'VERMELHO' || upper === 'GRANDE PERIGO' || upper === 'EXTREMO') return 'RED';
    if (upper === 'ORANGE' || upper === 'LARANJA' || upper === 'PERIGO' || upper === 'ALERTA') return 'ORANGE';
    if (upper === 'YELLOW' || upper === 'AMARELO' || upper === 'PERIGO POTENCIAL' || upper === 'ATENCAO' || upper === 'ATENÇÃO') return 'YELLOW';
    return 'OFF';
}

/**
 * Creates a Date for a calendar timestamp reported in São Paulo local time.
 * INMET and Defesa Civil timestamps without an explicit offset use the
 * municipality's local timezone, while the process may run in a UTC container.
 *
 * @param {number} year - Calendar year.
 * @param {number} month - Calendar month, from 1 to 12.
 * @param {number} day - Calendar day.
 * @param {number} [hour=0] - Hour of day.
 * @param {number} [minute=0] - Minute of hour.
 * @param {number} [second=0] - Second of minute.
 * @returns {Date|null} Parsed timestamp or null when the calendar value is invalid.
 */
function createSaoPauloDate(year, month, day, hour = 0, minute = 0, second = 0) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
        !Number.isInteger(year) || year < 1 ||
        !Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(day) || day < 1 || day > lastDay ||
        !Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59 ||
        !Number.isInteger(second) || second < 0 || second > 59
    ) {
        return null;
    }

    return new Date(
        `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
        `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-03:00`
    );
}

/**
 * Parses an INMET warning timestamp, accepting the documented ISO-like and
 * Brazilian formats. Values without an offset are interpreted as São Paulo time.
 *
 * @param {string|Date|null|undefined} value - Warning timestamp.
 * @returns {Date|null} Parsed timestamp or null when unavailable or invalid.
 */
export function parseWarningDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    if (value === null || value === undefined) return null;

    const text = String(value).trim();
    if (!text) return null;

    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    const brazilianMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    const match = isoMatch || brazilianMatch;
    if (!match) return null;

    const year = Number(isoMatch ? match[1] : match[3]);
    const month = Number(match[2]);
    const day = Number(isoMatch ? match[3] : match[1]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    return createSaoPauloDate(year, month, day, hour, minute, second);
}

/**
 * Builds a stable identity for one risk event across monitoring cycles.
 * Provider identifiers take precedence; otherwise the event's type, location,
 * and timeframe distinguish separate hazards without using changing readings.
 *
 * @param {object} event - Normalized risk event.
 * @returns {string} Stable event identity.
 */
export function getRiskEventKey(event = {}) {
    const cities = Array.isArray(event.affectedCities)
        ? event.affectedCities.join('|')
        : String(event.affectedCities || '');
    const fallbackIdentity = [event.type || '', cities, event.timeframe || ''].join('|');
    return [event.source || '', event.eventId || fallbackIdentity].join('|');
}

/**
 * Processa argumentos da linha de comando e variáveis de ambiente para obter o raio regional em KM.
 * 
 * @param {number} [defaultRadius=50] - Raio padrão caso não informado.
 * @returns {number} Raio em KM.
 */
export function parseRadiusArg(defaultRadius = 50) {
    if (process.env.RADIUS_KM || process.env.RADIUS) {
        const envVal = parseInt(process.env.RADIUS_KM || process.env.RADIUS, 10);
        if (!isNaN(envVal) && envVal > 0) return envVal;
    }

    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--radius=') || arg.startsWith('--dist=') || arg.startsWith('--distance=')) {
            const val = parseInt(arg.split('=')[1], 10);
            if (!isNaN(val) && val > 0) return val;
        } else if (arg === '-r' || arg === '--radius' || arg === '-d' || arg === '--distance') {
            const val = parseInt(args[i + 1], 10);
            if (!isNaN(val) && val > 0) return val;
        } else if (!arg.startsWith('-')) {
            const val = parseInt(arg, 10);
            if (!isNaN(val) && val > 0) return val;
        }
    }

    return defaultRadius;
}

/**
 * Converte data da previsão no formato DD/MM/YYYY em objeto Date do JavaScript.
 * 
 * @param {string} dateStr - Data no formato DD/MM/YYYY.
 * @returns {Date|null} Objeto Date correspondente.
 */
export function parseForecastDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Mês base zero
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return createSaoPauloDate(year, month + 1, day);
}

/**
 * Analisa os parâmetros de previsão meteorológica de um período/dia.
 * 
 * @param {Record<string, any>} forecastDay - Dados de previsão.
 * @returns {Array<{ type: string, severity: 'LOW' | 'MODERATE' | 'HIGH', detail: string }>}
 */
export function analyzeForecastRisks(forecastDay) {
    const risks = [];
    if (!forecastDay) return risks;

    const summary = (forecastDay.resumo || '').toLowerCase();
    const tempMin = forecastDay.temp_min;
    const tempMax = forecastDay.temp_max;
    const humidityMin = forecastDay.umidade_min;
    const windInt = (forecastDay.int_vento || '').toLowerCase();

    // 1. Tempestades Extremas / Ciclones (Critério Vermelho)
    if (summary.includes('ciclone') || summary.includes('temporal') || summary.includes('tempestade') || (summary.includes('granizo') && summary.includes('chuva'))) {
        risks.push({
            type: 'Tempestade Severa / Temporal Extremo',
            severity: 'HIGH',
            detail: `Condição prevista: "${forecastDay.resumo}" (Risco à mobilidade e segurança escolar)`
        });
    } else if (summary.includes('chuva') || summary.includes('pancadas') || summary.includes('trovoadas') || summary.includes('chuvoso')) {
        risks.push({
            type: 'Chuva / Instabilidade',
            severity: 'MODERATE',
            detail: `Condição prevista: "${forecastDay.resumo}"`
        });
    }

    // 2. Frio Extremo / Congelamento / Neve
    if (summary.includes('neve') || summary.includes('chuva congelada') || (tempMin !== undefined && tempMin <= 0)) {
        risks.push({
            type: 'Frio Extremo / Risco de Congelamento',
            severity: 'HIGH',
            detail: `Temp. Mínima Extrema: ${tempMin}°C (${forecastDay.resumo || 'Frio crítico com risco de congelamento'})`
        });
    } else if (summary.includes('geada') || (tempMin !== undefined && tempMin <= 4)) {
        risks.push({
            type: 'Geada / Frio Típico de Inverno',
            severity: 'MODERATE',
            detail: `Temp. Mínima: ${tempMin}°C (${forecastDay.resumo || 'Temperatura baixa típica'})`
        });
    } else if (tempMin !== undefined && tempMin <= 8) {
        risks.push({
            type: 'Aviso de Baixa Temperatura',
            severity: 'LOW',
            detail: `Temp. Mínima: ${tempMin}°C`
        });
    }

    // 3. Onda de Calor Extrema
    if (tempMax !== undefined && tempMax >= 40) {
        risks.push({
            type: 'Onda de Calor Extrema / Risco à Saúde',
            severity: 'HIGH',
            detail: `Temp. Máxima Extrema: ${tempMax}°C (Risco de estresse térmico em salas de aula)`
        });
    } else if (tempMax !== undefined && tempMax >= 34) {
        risks.push({
            type: 'Calor Intenso',
            severity: 'MODERATE',
            detail: `Temp. Máxima: ${tempMax}°C`
        });
    }

    // 4. Baixa Umidade do Ar (Emergência: <= 12%)
    if (humidityMin !== undefined && humidityMin <= 12) {
        risks.push({
            type: 'Emergência de Baixa Umidade do Ar',
            severity: 'HIGH',
            detail: `Umidade Mínima Crítica: ${humidityMin}% (Suspensão de atividades físicas)`
        });
    } else if (humidityMin !== undefined && humidityMin <= 25) {
        risks.push({
            type: 'Aviso de Baixa Umidade Relativa do Ar',
            severity: 'MODERATE',
            detail: `Umidade Mínima: ${humidityMin}%`
        });
    }

    // 5. Ventos Destrutivos / Vendaval / Ciclone
    if (summary.includes('ciclone') || summary.includes('vendaval') || windInt.includes('muito forte') || (windInt.includes('forte') && summary.includes('vento'))) {
        risks.push({
            type: 'Vendaval / Rajadas Destrutivas de Vento',
            severity: 'HIGH',
            detail: `Intensidade do vento: ${forecastDay.int_vento || forecastDay.resumo}`
        });
    } else if (windInt.includes('forte') || windInt.includes('rajadas')) {
        risks.push({
            type: 'Ventos Fortes / Rajadas de Vento',
            severity: 'MODERATE',
            detail: `Intensidade do vento: ${forecastDay.int_vento}`
        });
    }

    return risks;
}

/**
 * Avalia fontes de risco meteorológico com níveis de severidade independentes para cada instituto.
 * 
 * @param {object} params
 * @param {Array<object>} [params.regionalWarnings] - Avisos ativos do INMET.
 * @param {Array<object>} [params.regionalForecasts] - Previsões por município.
 * @param {Array<object>} [params.defesaCivilTelemetry] - Dados de telemetria da Defesa Civil RS.
 * @param {'RED' | 'ORANGE' | 'YELLOW' | 'OFF'} [params.inmetMinSeverity='RED'] - Nível mínimo para alertas INMET.
 * @param {'RED' | 'ORANGE' | 'YELLOW' | 'OFF'} [params.defesaCivilMinSeverity='ORANGE'] - Nível mínimo para Defesa Civil RS.
 * @param {string} [params.alertPolicy] - Preset de compatibilidade ('school', 'red_only', 'all').
 * @param {Date} [params.now] - Data/hora de referência.
 * @returns {Array<object>} Lista de eventos de risco que atingiram o limiar configurado.
 */
export function evaluateHighRisksIn24hWindow({
    regionalWarnings = [],
    regionalForecasts = [],
    defesaCivilTelemetry = [],
    inmetMinSeverity = 'RED',
    defesaCivilMinSeverity = 'ORANGE',
    alertPolicy = null,
    now = new Date()
}) {
    // Se preset legado informado, mapeia para os níveis independentes
    let inmetLevel = inmetMinSeverity;
    let dcLevel = defesaCivilMinSeverity;
    if (alertPolicy === 'school') {
        inmetLevel = 'RED';
        dcLevel = 'ORANGE';
    } else if (alertPolicy === 'red_only') {
        inmetLevel = 'RED';
        dcLevel = 'RED';
    } else if (alertPolicy === 'all') {
        inmetLevel = 'YELLOW';
        dcLevel = 'YELLOW';
    }

    const inmetRank = SEVERITY_LEVELS[normalizeSeverityTier(inmetLevel)] ?? SEVERITY_LEVELS.RED;
    const dcRank = SEVERITY_LEVELS[normalizeSeverityTier(dcLevel)] ?? SEVERITY_LEVELS.ORANGE;

    const highRiskEvents = [];
    const windowStart = now.getTime();
    const windowEnd = now.getTime() + (24 * 60 * 60 * 1000); // 24 horas

    // 1. Filtrar Avisos Oficiais do INMET conforme inmetMinSeverity
    if (inmetRank > 0) {
        for (const warning of regionalWarnings) {
            const warningStart = parseWarningDate(warning.inicio || warning.hora_inicio);
            const warningEnd = parseWarningDate(warning.fim || warning.hora_fim);
            const warningOverlapsWindow =
                (!warningStart || warningStart.getTime() <= windowEnd) &&
                (!warningEnd || warningEnd.getTime() >= windowStart);

            if (!warningOverlapsWindow) continue;

            const severidade = String(warning.severidade || '').toLowerCase();
            const avisoCor = String(warning.aviso_cor || '').toUpperCase();

            let warningTier = 'YELLOW';
            if (avisoCor === '#FF0000' || severidade.includes('grande perigo') || severidade.includes('extremo')) {
                warningTier = 'RED';
            } else if (avisoCor === '#F96602' || (severidade.includes('perigo') && !severidade.includes('potencial'))) {
                warningTier = 'ORANGE';
            }

            const warningRank = SEVERITY_LEVELS[warningTier] || 1;
            if (warningRank >= inmetRank) {
                const risksText = Array.isArray(warning.riscos) ? warning.riscos.join(' | ') : (warning.riscos || '');
                highRiskEvents.push({
                    source: 'INMET_OFFICIAL_WARNING',
                    eventId: warning.id_aviso || warning.codigo || null,
                    type: warning.descricao || warning.tipo || 'Aviso Meteorológico (INMET)',
                    severity: warning.severidade || (warningTier === 'RED' ? 'Grande Perigo' : (warningTier === 'ORANGE' ? 'Perigo' : 'Perigo Potencial')),
                    colorTier: warningTier,
                    emoji: getAlertEmoji(warning),
                    affectedCities: warning.affectedRegionalCities || [],
                    timeframe: `${warning.inicio || warning.hora_inicio || 'Agora'} -> ${warning.fim || warning.hora_fim || 'Próximas horas'}`,
                    details: risksText || 'Aviso oficial emitido pelo INMET.',
                    triggerReason: `INMET (${warning.severidade || warningTier}) ativo na região.`
                });
            }
        }
    }

    // 2. Avaliar Telemetria e Alertas da DEFESA CIVIL RS conforme defesaCivilMinSeverity
    if (dcRank > 0 && Array.isArray(defesaCivilTelemetry) && defesaCivilTelemetry.length > 0) {
        const dcRisks = evaluateDefesaCivilRisks(defesaCivilTelemetry);
        for (const dcr of dcRisks) {
            const dcrRank = SEVERITY_LEVELS[dcr.colorTier] || 2;
            if (dcrRank >= dcRank) {
                highRiskEvents.push(dcr);
            }
        }
    }

    // 3. Analisar Previsões nos Municípios para a janela de 24h
    if (inmetRank > 0) {
        for (const cityData of regionalForecasts) {
            const cityName = cityData.name;
            const forecast = cityData.forecast || {};

            for (const [dateStr, dayData] of Object.entries(forecast)) {
                const forecastDate = parseForecastDate(dateStr);
                if (!forecastDate) continue;

                const dayStart = forecastDate.getTime();
                const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;
                const periodDefinitions = [
                    { key: 'manha', label: 'manhã', startHour: 6, endHour: 12 },
                    { key: 'tarde', label: 'tarde', startHour: 12, endHour: 18 },
                    { key: 'noite', label: 'noite', startHour: 18, endHour: 24 }
                ];
                const definedPeriods = periodDefinitions
                    .filter(periodDefinition => dayData?.[periodDefinition.key])
                    .map(periodDefinition => ({
                        ...periodDefinition,
                        data: dayData[periodDefinition.key]
                    }));
                const periods = definedPeriods.length > 0
                    ? definedPeriods
                    : [{ key: null, label: null, startHour: 0, endHour: 24, data: dayData }];

                for (const period of periods) {
                    const periodStart = dayStart + (period.startHour * 60 * 60 * 1000);
                    const periodEnd = dayStart + (period.endHour * 60 * 60 * 1000) - 1;
                    const overlaps24hWindow = periodStart <= windowEnd && periodEnd >= windowStart;

                    if (!overlaps24hWindow) continue;

                    const risks = analyzeForecastRisks(period.data);
                    const matchingRisks = risks.filter(r => {
                        if (r.severity === 'HIGH') return inmetRank <= SEVERITY_LEVELS.RED;
                        if (r.severity === 'MODERATE') return inmetRank <= SEVERITY_LEVELS.ORANGE;
                        if (r.severity === 'LOW') return inmetRank <= SEVERITY_LEVELS.YELLOW;
                        return false;
                    });

                    for (const r of matchingRisks) {
                        const periodSuffix = period.label ? `, ${period.label}` : '';
                        highRiskEvents.push({
                            source: 'FORECAST_ANALYSIS',
                            type: r.type,
                            severity: r.severity === 'HIGH' ? 'HIGH (Red Equivalent)' : r.severity,
                            colorTier: r.severity === 'HIGH' ? 'RED' : (r.severity === 'MODERATE' ? 'ORANGE' : 'YELLOW'),
                            emoji: r.severity === 'HIGH' ? '🔴' : (r.severity === 'MODERATE' ? '🟠' : '🟡'),
                            affectedCities: [cityName],
                            timeframe: `Janela de 24h (${dateStr}${periodSuffix})`,
                            details: `${r.detail} em ${cityName}`,
                            triggerReason: `Métrica da previsão meteorológica para ${cityName}: ${r.detail}`
                        });
                    }
                }
            }
        }
    }

    // Remover duplicatas idênticas
    const uniqueEvents = [];
    const seenKeys = new Set();
    for (const event of highRiskEvents) {
        const key = getRiskEventKey(event);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEvents.push(event);
        }
    }

    return uniqueEvents;
}

/**
 * Groups high-risk events that share the same hazard type and severity tier,
 * merging their affected municipalities. This produces a compact, aggregated
 * report (e.g. one “Geada” entry for 18 cities instead of 18 separate lines)
 * while preserving the original event count for metrics.
 *
 * @param {Array<object>} events - Normalized risk events.
 * @returns {Array<object>} Aggregated events, sorted by severity descending.
 */
export function aggregateRiskEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return [];

    const groups = new Map();
    for (const event of events) {
        const key = `${event.source || 'UNKNOWN'}|${event.type}|${event.colorTier || event.severity}`;
        if (!groups.has(key)) {
            groups.set(key, {
                ...event,
                affectedCities: [...(event.affectedCities || [])],
                _count: 1,
                _timeframes: new Set([event.timeframe]),
            });
        } else {
            const grouped = groups.get(key);
            for (const city of event.affectedCities || []) {
                if (!grouped.affectedCities.includes(city)) grouped.affectedCities.push(city);
            }
            grouped._count += 1;
            grouped._timeframes.add(event.timeframe);
        }
    }

    return Array.from(groups.values())
        .map(grouped => {
            const cities = [...grouped.affectedCities].sort((a, b) => a.localeCompare(b, 'pt-BR'));
            const aggregated = grouped._count > 1;
            const timeframe = grouped._timeframes.size === 1
                ? [...grouped._timeframes][0]
                : `Próximas 24h (${grouped._count} ocorrências)`;
            const { _count, _timeframes, ...rest } = grouped;
            return {
                ...rest,
                affectedCities: cities,
                timeframe,
                triggerReason: aggregated
                    ? `${rest.type} detectado em ${cities.length} municípios (${_count} ocorrências na janela)`
                    : rest.triggerReason,
                details: aggregated
                    ? `${rest.type} — ${cities.length} municípios afetados (ex.: ${rest.details})`
                    : rest.details,
                aggregatedCount: _count,
            };
        })
        .sort((left, right) => (SEVERITY_LEVELS[right.colorTier] ?? 0) - (SEVERITY_LEVELS[left.colorTier] ?? 0));
}
