/**
 * Módulo Compartilhado de Análise de Riscos Meteorológicos.
 * Fornece métodos compartilhados para a ferramenta CLI sob demanda (monitor_regional_risks.js)
 * e para o serviço de monitoramento continuo (monitor_service.js).
 * 
 * @module riskAnalyzer
 */

import { getAlertEmoji } from './inmet_client.js';

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
 * Analisa os parâmetros de previsão meteorológica de um período/dia e retorna lista de riscos.
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

    // Risco de Tempestade / Chuva Intensa
    if (summary.includes('tempestade') || summary.includes('trovoadas com pancadas')) {
        risks.push({
            type: 'Risco de Tempestade / Trovoadas',
            severity: 'HIGH',
            detail: `Condição prevista: "${forecastDay.resumo}"`
        });
    } else if (summary.includes('chuva') || summary.includes('pancadas') || summary.includes('chuvoso')) {
        risks.push({
            type: 'Chuva / Pancadas de Chuva',
            severity: 'MODERATE',
            detail: `Condição prevista: "${forecastDay.resumo}"`
        });
    }

    // Risco de Geada / Frio Severo
    if (summary.includes('geada') || (tempMin !== undefined && tempMin <= 4)) {
        risks.push({
            type: 'Alerta de Geada / Frio Severo',
            severity: tempMin <= 3 ? 'HIGH' : 'MODERATE',
            detail: `Temp. Mínima: ${tempMin}°C (${forecastDay.resumo || 'Temperatura baixa'})`
        });
    } else if (tempMin !== undefined && tempMin <= 8) {
        risks.push({
            type: 'Aviso de Baixa Temperatura',
            severity: 'LOW',
            detail: `Temp. Mínima: ${tempMin}°C`
        });
    }

    // Risco de Onda de Calor
    if (tempMax !== undefined && tempMax >= 33) {
        risks.push({
            type: 'Risco de Onda de Calor / Calor Extremo',
            severity: tempMax >= 36 ? 'HIGH' : 'MODERATE',
            detail: `Temp. Máxima: ${tempMax}°C`
        });
    }

    // Risco de Baixa Umidade Relativa do Ar
    if (humidityMin !== undefined && humidityMin <= 30) {
        risks.push({
            type: 'Risco de Baixa Umidade Relativa do Ar',
            severity: humidityMin <= 20 ? 'HIGH' : 'MODERATE',
            detail: `Umidade Mínima: ${humidityMin}%`
        });
    }

    // Risco de Ventos Fortes / Rajadas
    if (windInt.includes('forte') || windInt.includes('rajadas')) {
        risks.push({
            type: 'Ventos Fortes / Rajadas de Vento',
            severity: 'MODERATE',
            detail: `Intensidade do vento: ${forecastDay.int_vento}`
        });
    }

    return risks;
}

/**
 * Avalia avisos oficiais do INMET e previsões diárias para filtrar eventos de ALTO RISCO
 * previstos para ocorrer na janela das próximas 24 horas.
 * 
 * @param {object} params
 * @param {Array<object>} [params.regionalWarnings] - Avisos ativos do INMET na região.
 * @param {Array<object>} [params.regionalForecasts] - Previsões por município.
 * @param {Date} [params.now] - Data/hora de referência.
 * @returns {Array<object>} Lista de eventos de alto risco na janela de 24h.
 */
export function evaluateHighRisksIn24hWindow({ regionalWarnings = [], regionalForecasts = [], now = new Date() }) {
    const highRiskEvents = [];
    const windowStart = now.getTime();
    const windowEnd = now.getTime() + (24 * 60 * 60 * 1000); // 24 horas

    // 1. Filtrar Avisos Oficiais do INMET (Grande Perigo / Perigo)
    for (const warning of regionalWarnings) {
        const severidade = String(warning.severidade || '').toLowerCase();
        const avisoCor = String(warning.aviso_cor || '').toUpperCase();

        const isHighSeverity = avisoCor === '#FF0000' ||
            avisoCor === '#F96602' ||
            severidade.includes('grande perigo') ||
            (severidade.includes('perigo') && !severidade.includes('potencial'));

        if (isHighSeverity) {
            const risksText = Array.isArray(warning.riscos) ? warning.riscos.join(' | ') : (warning.riscos || '');
            highRiskEvents.push({
                source: 'INMET_OFFICIAL_WARNING',
                type: warning.descricao || warning.tipo || 'Aviso de Evento Meteorológico Severo',
                severity: warning.severidade || 'Alto Risco',
                emoji: getAlertEmoji(warning),
                affectedCities: warning.affectedRegionalCities || [],
                timeframe: `${warning.inicio || warning.hora_inicio || 'Agora'} -> ${warning.fim || warning.hora_fim || 'Próximas horas'}`,
                details: risksText || 'Aviso oficial do INMET emitido com severidade elevada.',
                triggerReason: `Alerta oficial do INMET (Severidade: ${warning.severidade || 'Perigo/Grande Perigo'}) ativo na região.`
            });
        }
    }

    // 2. Analisar Previsões nos Municípios para a janela de 24h
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
                        severity: 'HIGH',
                        emoji: '⚠️',
                        affectedCities: [cityName],
                        timeframe: `Janela de 24h (${dateStr})`,
                        details: `${r.detail} em ${cityName}`,
                        triggerReason: `Métrica da previsão meteorológica para ${cityName} atingiu o limiar de alto risco (${r.detail}).`
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
