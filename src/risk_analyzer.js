/**
 * Módulo Compartilhado de Análise de Riscos Meteorológicos.
 * Fornece métodos calibrados para identificação de eventos meteorológicos severos
 * com base na regra de disparo:
 * - 🔴 VERMELHO (Grande Perigo) para INMET
 * - 🟠 LARANJA (Alerta / Risco Severo) ou 🔴 VERMELHO (Alerta Máximo) para DEFESA CIVIL RS
 * 
 * @module riskAnalyzer
 */

import { getAlertEmoji } from './inmet_client.js';
import { evaluateDefesaCivilRisks } from './defesa_civil_client.js';

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
 * Classifica os riscos com base no limiar de eventos de alto impacto.
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

    // 2. Frio Extremo / Congelamento / Neve (Critério Vermelho: Tmin <= 0°C com congelamento)
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

    // 3. Onda de Calor Extrema (Critério Vermelho: Tmax >= 40°C)
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
 * Avalia fontes de risco meteorológico (INMET e Defesa Civil RS) na janela de 24 horas.
 * 
 * Regra de Disparo:
 * - 🔴 INMET: Apenas avisos VERMELHOS (Grande Perigo / #FF0000 / Extremo).
 * - 🟠 DEFESA CIVIL RS: Avisos e telemetria LARANJA (Alerta / Risco Severo) ou VERMELHO (Alerta Máximo).
 * - 🔴 PREVISÕES DIÁRIAS: Apenas anomalias extremas (Tmin <= 0°C com congelamento, Tmax >= 40°C, ciclone).
 * 
 * @param {object} params
 * @param {Array<object>} [params.regionalWarnings] - Avisos ativos do INMET.
 * @param {Array<object>} [params.regionalForecasts] - Previsões por município.
 * @param {Array<object>} [params.defesaCivilTelemetry] - Dados de telemetria da Defesa Civil RS.
 * @param {Date} [params.now] - Data/hora de referência.
 * @returns {Array<object>} Lista de eventos de alto risco que disparam alertas.
 */
export function evaluateHighRisksIn24hWindow({
    regionalWarnings = [],
    regionalForecasts = [],
    defesaCivilTelemetry = [],
    now = new Date()
}) {
    const highRiskEvents = [];
    const windowStart = now.getTime();
    const windowEnd = now.getTime() + (24 * 60 * 60 * 1000); // 24 horas

    // 1. Filtrar Avisos Oficiais do INMET — 🔴 APENAS VERMELHO (Grande Perigo)
    for (const warning of regionalWarnings) {
        const severidade = String(warning.severidade || '').toLowerCase();
        const avisoCor = String(warning.aviso_cor || '').toUpperCase();

        const isRedAlert = avisoCor === '#FF0000' ||
            severidade.includes('grande perigo') ||
            severidade.includes('extremo') ||
            severidade.includes('vermelho');

        if (isRedAlert) {
            const risksText = Array.isArray(warning.riscos) ? warning.riscos.join(' | ') : (warning.riscos || '');
            highRiskEvents.push({
                source: 'INMET_OFFICIAL_WARNING',
                type: warning.descricao || warning.tipo || 'Aviso de Grande Perigo (INMET)',
                severity: warning.severidade || 'Grande Perigo',
                colorTier: 'RED',
                emoji: '🔴',
                affectedCities: warning.affectedRegionalCities || [],
                timeframe: `${warning.inicio || warning.hora_inicio || 'Agora'} -> ${warning.fim || warning.hora_fim || 'Próximas horas'}`,
                details: risksText || 'Aviso oficial de Grande Perigo emitido pelo INMET.',
                triggerReason: `INMET 🔴 Grande Perigo emitido para a região.`
            });
        }
    }

    // 2. Avaliar Telemetria e Alertas da DEFESA CIVIL RS — 🟠 LARANJA E 🔴 VERMELHO
    if (Array.isArray(defesaCivilTelemetry) && defesaCivilTelemetry.length > 0) {
        const dcRisks = evaluateDefesaCivilRisks(defesaCivilTelemetry);
        for (const dcr of dcRisks) {
            if (dcr.colorTier === 'ORANGE' || dcr.colorTier === 'RED') {
                highRiskEvents.push(dcr);
            }
        }
    }

    // 3. Analisar Previsões nos Municípios para a janela de 24h (Critérios Severos de Aulas)
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
                const highRisks = risks.filter(r => r.severity === 'HIGH');

                for (const r of highRisks) {
                    highRiskEvents.push({
                        source: 'FORECAST_ANALYSIS',
                        type: r.type,
                        severity: 'HIGH (Red Equivalent)',
                        colorTier: 'RED',
                        emoji: '🔴',
                        affectedCities: [cityName],
                        timeframe: `Janela de 24h (${dateStr})`,
                        details: `${r.detail} em ${cityName}`,
                        triggerReason: `Métrica da previsão meteorológica para ${cityName} atingiu o limiar crítico de suspensão de aulas (${r.detail}).`
                    });
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
