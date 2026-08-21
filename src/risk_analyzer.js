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
    return new Date(year, month, day, 0, 0, 0, 0);
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
                const overlaps24hWindow = (dayStart <= windowEnd && dayEnd >= windowStart);

                if (overlaps24hWindow) {
                    const period = dayData.manha ? dayData.manha : dayData;
                    const risks = analyzeForecastRisks(period);

                    const matchingRisks = risks.filter(r => {
                        if (r.severity === 'HIGH') return inmetRank <= SEVERITY_LEVELS.RED;
                        if (r.severity === 'MODERATE') return inmetRank <= SEVERITY_LEVELS.ORANGE;
                        if (r.severity === 'LOW') return inmetRank <= SEVERITY_LEVELS.YELLOW;
                        return false;
                    });

                    for (const r of matchingRisks) {
                        highRiskEvents.push({
                            source: 'FORECAST_ANALYSIS',
                            type: r.type,
                            severity: r.severity === 'HIGH' ? 'HIGH (Red Equivalent)' : r.severity,
                            colorTier: r.severity === 'HIGH' ? 'RED' : (r.severity === 'MODERATE' ? 'ORANGE' : 'YELLOW'),
                            emoji: r.severity === 'HIGH' ? '🔴' : (r.severity === 'MODERATE' ? '🟠' : '🟡'),
                            affectedCities: [cityName],
                            timeframe: `Janela de 24h (${dateStr})`,
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
        const key = `${event.source}_${event.type}_${(event.affectedCities || []).join(',')}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEvents.push(event);
        }
    }

    return uniqueEvents;
}
