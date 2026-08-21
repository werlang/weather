#!/usr/bin/env node
/**
 * Serviço de Monitoramento Contínuo de Riscos Meteorológicos Regionais.
 * Executa periodicamente a cada X tempo (configurado via env) e monitora
 * eventos de alto risco na janela das próximas 24 horas.
 * 
 * Desenvolvido para Node.js 26.
 */

import {
    getSurroundingCities,
    getRegionalRiskWarnings,
    getRegionalForecasts
} from './inmet_client.js';

import {
    parseRadiusArg,
    parseForecastDate,
    evaluateHighRisksIn24hWindow
} from './risk_analyzer.js';

import { logAlert, logMonitorCycle } from './log_database.js';

export { parseForecastDate, evaluateHighRisksIn24hWindow };

/**
 * Extrai e valida as configurações de monitoramento a partir das variáveis de ambiente.
 * 
 * @returns {{ intervalMs: number, radiusKm: number, intervalMinutes: number }}
 */
export function parseMonitorConfig() {
    const radiusKm = parseRadiusArg(50);

    // Intervalo de execução (suporta MS, Minutos ou Segundos)
    let intervalMs = 15 * 60 * 1000; // Padrão: 15 minutos

    if (process.env.MONITOR_INTERVAL_MS) {
        const ms = parseInt(process.env.MONITOR_INTERVAL_MS, 10);
        if (!isNaN(ms) && ms >= 1000) intervalMs = ms;
    } else if (process.env.MONITOR_INTERVAL_MINUTES) {
        const mins = parseFloat(process.env.MONITOR_INTERVAL_MINUTES);
        if (!isNaN(mins) && mins > 0) intervalMs = Math.round(mins * 60 * 1000);
    } else if (process.env.MONITOR_INTERVAL_SECONDS) {
        const secs = parseFloat(process.env.MONITOR_INTERVAL_SECONDS);
        if (!isNaN(secs) && secs > 0) intervalMs = Math.round(secs * 1000);
    } else if (process.env.MONITOR_INTERVAL) {
        const val = parseFloat(process.env.MONITOR_INTERVAL);
        if (!isNaN(val) && val > 0) intervalMs = Math.round(val * 60 * 1000);
    }

    // Trava de segurança: mínimo 1 segundo de intervalo
    if (intervalMs < 1000) intervalMs = 1000;

    return {
        radiusKm,
        intervalMs,
        intervalMinutes: Math.round((intervalMs / (60 * 1000)) * 100) / 100
    };
}

/**
 * Relata no console os eventos de alto risco detectados nas próximas 24 horas.
 * A entrega em Telegram é adicionada pelo callback composto do bot.
 * 
 * @param {Array<object>} highRiskEvents - Lista de eventos de alto risco detectados.
 */
export function onHighRiskEventDetected(highRiskEvents) {
    console.log('\n' + '!'.repeat(80));
    console.log('🚨 [ALERTA DISPARADO] EVENTO(S) DE ALTO RISCO DETECTADO(S) NAS PRÓXIMAS 24 HORAS!');
    console.log('!'.repeat(80));
    console.log(` Total de Alertas Severos Detectados: ${highRiskEvents.length}`);
    console.log(` Horário do Disparo:                 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    console.log('-'.repeat(80));

    highRiskEvents.forEach((event, idx) => {
        console.log(` [#${idx + 1}] ${event.emoji} TIPO DE PERIGO:      ${event.type.toUpperCase()}`);
        console.log(`      📍 Municípios Impactados: ${(event.affectedCities || []).join(', ') || 'N/A'}`);
        console.log(`      💡 Motivo do Disparo:     ${event.triggerReason || event.details}`);
        console.log(`      📊 Origem & Severidade:   ${event.source} (${event.severity})`);
        console.log(`      🕒 Janela de Tempo:      ${event.timeframe}`);
        if (event.details && event.details !== event.triggerReason && event.details !== `${event.triggerReason} em ${event.affectedCities?.[0]}`) {
            console.log(`      📝 Detalhes Adicionais:   ${event.details}`);
        }
        console.log('-'.repeat(80));
    });

}

/**
 * Executa uma rodada completa de monitoramento regional de riscos.
 * 
 * @param {object} options
 * @param {number} [options.radiusKm=50] - Raio de monitoramento em KM.
 * @param {function} [options.alertCallback] - Callback customizado para alertas.
 * @returns {Promise<{ citiesCount: number, highRiskCount: number, events: Array<object> }>}
 */
export async function performRegionalRiskMonitoring({ radiusKm = 50, alertCallback = onHighRiskEventDetected } = {}) {
    const startTime = Date.now();
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`\n[${timestamp}] 🔍 Iniciando verificação de riscos regionais (Raio: ${radiusKm}km)...`);

    try {
        const cities = await getSurroundingCities(radiusKm);
        const { regionalWarnings } = await getRegionalRiskWarnings(cities);
        const regionalForecasts = await getRegionalForecasts(cities);

        const highRiskEvents = evaluateHighRisksIn24hWindow({
            regionalWarnings,
            regionalForecasts,
            now: new Date()
        });

        const durationMs = Date.now() - startTime;
        console.log(`[${timestamp}] ✓ Monitoramento concluído. ${cities.length} municípios verificados.`);

        // Persist monitoring cycle log to SQLite
        logMonitorCycle({
            radiusKm,
            citiesCount: cities.length,
            highRiskCount: highRiskEvents.length,
            durationMs,
            success: 1
        });

        // Persist each detected high-risk alert to SQLite
        for (const event of highRiskEvents) {
            logAlert(event);
        }

        if (highRiskEvents.length > 0) {
            if (typeof alertCallback === 'function') {
                await alertCallback(highRiskEvents);
            }
        } else {
            console.log(`[${timestamp}] 🟢 Nenhum evento de alto risco detectado para as próximas 24 horas.`);
        }

        return {
            citiesCount: cities.length,
            highRiskCount: highRiskEvents.length,
            events: highRiskEvents
        };
    } catch (err) {
        const durationMs = Date.now() - startTime;
        logMonitorCycle({
            radiusKm,
            citiesCount: null,
            highRiskCount: 0,
            durationMs,
            success: 0,
            errorMessage: err.message
        });
        console.error(`❌ [${timestamp}] Erro durante o monitoramento regional:`, err.message);
        throw err;
    }
}

/**
 * Inicia o loop contínuo do serviço de monitoramento.
 * 
 * @param {object} options
 * @param {number} [options.intervalMs] - Intervalo em milissegundos.
 * @param {number} [options.radiusKm] - Raio regional em KM.
 * @param {function} [options.alertCallback] - Callback customizado para alertas.
 * @param {boolean} [options.registerSignalHandlers=true] - Registra encerramento
 *   gracioso no processo atual.
 */
export function startMonitoringService(options = {}) {
    const config = parseMonitorConfig();
    const radiusKm = options.radiusKm || config.radiusKm;
    const intervalMs = options.intervalMs || config.intervalMs;
    const alertCallback = options.alertCallback || onHighRiskEventDetected;
    const registerSignalHandlers = options.registerSignalHandlers !== false;
    const intervalMins = Math.round((intervalMs / (60 * 1000)) * 100) / 100;

    console.log('='.repeat(80));
    console.log(' SERVIÇO CONTINUO DE MONITORAMENTO DE RISCOS METEOROLÓGICOS (NODE 26)');
    console.log('='.repeat(80));
    console.log(` • Ponto Central:           Charqueadas - RS`);
    console.log(` • Raio Regional:           ${radiusKm} km`);
    console.log(` • Intervalo de Verificação: A cada ${intervalMins} min (${intervalMs} ms)`);
    console.log(` • Janela de Alerta:        Próximas 24 Horas`);
    console.log(` • Status:                  ATIVO E AGUARDANDO CICLOS`);
    console.log('='.repeat(80));

    let isRunning = false;
    let timerId = null;

    async function cycle() {
        if (isRunning) return;
        isRunning = true;
        try {
            await performRegionalRiskMonitoring({ radiusKm, alertCallback });
        } catch (err) {
            console.error('⚠️ Falha no ciclo de monitoramento, o serviço continuará ativo:', err.message);
        } finally {
            isRunning = false;
        }
    }

    // Primeira execução imediata
    cycle();

    // Agendamento periódico contínuo
    timerId = setInterval(cycle, intervalMs);

    // Encerramento gracioso para contêineres Docker e sinais de processo.
    const stop = () => {
        if (timerId) clearInterval(timerId);
    };

    if (registerSignalHandlers) {
        const cleanup = () => {
            console.log('\n🛑 Encerrando serviço de monitoramento...');
            stop();
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }

    return { timerId, stop };
}

// Executa o serviço diretamente se o script for chamado como módulo principal
if (import.meta.url === `file://${process.argv[1]}`) {
    startMonitoringService();
}
