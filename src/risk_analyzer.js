/**
 * Módulo Compartilhado de Análise de Riscos Meteorológicos.
 * Fornece métodos calibrados para identificação de eventos meteorológicos severos
 * com impacto na mobilidade urbana e na tomada de decisão sobre suspensão de aulas.
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
 * Analisa os parâmetros de previsão meteorológica de um período/dia.
 * Classifica os riscos com base no potencial de interrupção de transporte escolar e risco à segurança física.
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

    // 1. Tempestades Severas / Chuvas Torrenciais (Critério: Risco direto ao deslocamento e estrutura)
    if (summary.includes('tempestade') || summary.includes('temporal') || summary.includes('trovoadas com pancadas') || (summary.includes('granizo') && summary.includes('chuva'))) {
        risks.push({
            type: 'Tempestade Severa / Temporal',
            severity: 'HIGH',
            detail: `Condição prevista: "${forecastDay.resumo}" (Risco a transporte escolar e segurança)`
        });
    } else if (summary.includes('chuva') || summary.includes('pancadas') || summary.includes('chuvoso')) {
        risks.push({
            type: 'Chuva / Pancadas de Chuva',
            severity: 'MODERATE',
            detail: `Condição prevista: "${forecastDay.resumo}"`
        });
    }

    // 2. Frio Extremo / Congelamento / Neve
    // No RS, 2°C a 4°C é rotina de inverno (MODERATE). HIGH apenas com congelamento, neve ou Tmin <= 0°C.
    if (summary.includes('neve') || summary.includes('chuva congelada') || (tempMin !== undefined && tempMin <= 0)) {
        risks.push({
            type: 'Frio Extremo / Risco de Congelamento',
            severity: 'HIGH',
            detail: `Temp. Mínima Extrema: ${tempMin}°C (${forecastDay.resumo || 'Frio com risco de congelamento'})`
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

    // 3. Onda de Calor Extrema (Critério de Suspensão de Aulas: Tmax >= 40°C)
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

    // 4. Baixa Umidade do Ar (Emergência de Saúde: <= 12%)
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

    // 5. Ventos Destrutivos / Vendaval / Ciclone (Critério: Ventos fortes com risco a vias e telhados)
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
 * Avalia avisos oficiais do INMET e previsões diárias para filtrar eventos de ALTO RISCO
 * com impacto direto na segurança física e recomendação de suspensão de aulas presenciais.
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

    // 1. Filtrar Avisos Oficiais do INMET com potencial de interrupção de aulas / transporte
    for (const warning of regionalWarnings) {
        const severidade = String(warning.severidade || '').toLowerCase();
        const avisoCor = String(warning.aviso_cor || '').toUpperCase();
        const descricao = String(warning.descricao || warning.tipo || '').toLowerCase();

        // 🔴 Grande Perigo (Sempre prioritário / Recomendação Imediata de Suspensão de Aulas)
        const isRedAlert = avisoCor === '#FF0000' || severidade.includes('grande perigo') || severidade.includes('extremo');

        // 🟠 Perigo (Avisos de perigo que afetam transporte e integridade: tempestade, chuvas intensas, vendaval, ciclone, inundações, granizo)
        const isOrangeDisruptive = (avisoCor === '#F96602' || (severidade.includes('perigo') && !severidade.includes('potencial'))) &&
            (descricao.includes('tempestade') ||
             descricao.includes('chuva') ||
             descricao.includes('vendaval') ||
             descricao.includes('vento') ||
             descricao.includes('ciclone') ||
             descricao.includes('granizo') ||
             descricao.includes('inunda') ||
             descricao.includes('alagamento') ||
             descricao.includes('enxurrada') ||
             descricao.includes('frio') ||
             descricao.includes('calor'));

        if (isRedAlert || isOrangeDisruptive) {
            const risksText = Array.isArray(warning.riscos) ? warning.riscos.join(' | ') : (warning.riscos || '');
            highRiskEvents.push({
                source: 'INMET_OFFICIAL_WARNING',
                type: warning.descricao || warning.tipo || 'Aviso de Evento Meteorológico Severo',
                severity: warning.severidade || (isRedAlert ? 'Grande Perigo' : 'Perigo'),
                emoji: getAlertEmoji(warning),
                affectedCities: warning.affectedRegionalCities || [],
                timeframe: `${warning.inicio || warning.hora_inicio || 'Agora'} -> ${warning.fim || warning.hora_fim || 'Próximas horas'}`,
                details: risksText || 'Aviso oficial do INMET emitido com severidade elevada.',
                triggerReason: `Alerta oficial do INMET (${warning.severidade || 'Perigo/Grande Perigo'}) com risco à mobilidade escolar e segurança física.`
            });
        }
    }

    // 2. Analisar Previsões nos Municípios para a janela de 24h (Critérios Severos de Aulas)
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
                        triggerReason: `Métrica da previsão para ${cityName} atingiu o limiar de suspensão de aulas (${r.detail}).`
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
