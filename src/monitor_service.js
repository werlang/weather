#!/usr/bin/env node
/**
 * Serviço de Monitoramento Contínuo de Riscos Meteorológicos Regionais.
 * Executa periodicamente a cada X tempo e monitora eventos de risco na janela das próximas 24 horas.
 * 
 * Persiste e carrega configurações (raio, intervalo, limiares independentes por instituto)
 * diretamente no banco de dados SQLite (`database/weather_logs.db` na tabela `system_settings`),
 * garantindo sobrevivência a reinicializações e comandos do bot Telegram.
 * 
 * @module monitorService
 */

import {
    getSurroundingCities,
    getRegionalRiskWarnings,
    getRegionalForecasts
} from './inmet_client.js';

import { getDefesaCivilTelemetry } from './defesa_civil_client.js';

import {
    parseRadiusArg,
    parseForecastDate,
    evaluateHighRisksIn24hWindow,
    normalizeSeverityTier,
    getRiskEventKey,
    ALERT_CATEGORIES,
    getEventCategory
} from './risk_analyzer.js';

import {
    logAlert,
    logMonitorCycle,
    saveSystemSetting,
    loadAllSettings
} from './log_database.js';

export { parseForecastDate, evaluateHighRisksIn24hWindow };

/**
 * Lê e processa as configurações prioritárias:
 * 1º Banco SQLite (tabela system_settings) — fonte da verdade, semeada com
 *    padrões na primeira execução (migration 002) e atualizada via bot/CLI.
 * 2º Variáveis de ambiente — apenas fallback quando a chave não existe no banco.
 * 3º Valores padrão seguros.
 *
 * @returns {{ intervalMs: number, radiusKm: number, intervalMinutes: number, inmetMinSeverity: string, defesaCivilMinSeverity: string }}
 */
export function parseMonitorConfig() {
    let saved = {};
    try {
        saved = loadAllSettings();
    } catch {}

    // 1. Raio Regional em KM (banco > ambiente > padrão)
    let radiusKm = 50;
    if (saved.radius_km) {
        const parsed = parseInt(saved.radius_km, 10);
        if (!isNaN(parsed) && parsed > 0) radiusKm = parsed;
    } else if (process.env.RADIUS_KM || process.env.RADIUS) {
        radiusKm = parseRadiusArg(50);
    }

    // 2. Intervalo de execução (banco > ambiente > padrão)
    let intervalMs = 15 * 60 * 1000; // Padrão: 15 minutos
    if (saved.interval_minutes) {
        const mins = parseFloat(saved.interval_minutes);
        if (!isNaN(mins) && mins > 0) intervalMs = Math.round(mins * 60 * 1000);
    } else if (process.env.MONITOR_INTERVAL_MS) {
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

    // 3. Limiares independentes de severidade por instituto
    const inmetMinSeverity = normalizeSeverityTier(
        saved.inmet_min_severity || process.env.INMET_MIN_SEVERITY || 'RED'
    );
    const defesaCivilMinSeverity = normalizeSeverityTier(
        saved.defesa_civil_min_severity || process.env.DEFESA_CIVIL_MIN_SEVERITY || 'ORANGE'
    );

    // 4. Categorias de alerta habilitadas (ausente no banco = habilitada)
    const enabledCategories = Object.keys(ALERT_CATEGORIES)
        .filter(categoryId => saved[`alert_cat_${categoryId}`] !== '0');

    return {
        radiusKm,
        intervalMs,
        intervalMinutes: Math.round((intervalMs / (60 * 1000)) * 100) / 100,
        inmetMinSeverity,
        defesaCivilMinSeverity,
        enabledCategories
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
        if (event.details) console.log(`      📝 Detalhes Adicionais:   ${event.details}`);
        console.log('-'.repeat(80));
    });
}

/**
 * Creates a stateful dispatcher that sends only newly active events.
 * The active set is replaced only after a complete data cycle and successful
 * delivery, so a transient source outage cannot clear an alert or create spam.
 *
 * @param {function} alertCallback - Callback that delivers an alert batch.
 * @returns {function(Array<object>, object): Promise<object>} Alert dispatcher.
 */
export function createAlertDispatcher(alertCallback) {
    let activeAlertKeys = new Set();

    return async (events = [], { dataComplete = true } = {}) => {
        const normalizedEvents = Array.isArray(events) ? events : [];
        const currentAlertKeys = new Set();
        const newEvents = [];

        for (const event of normalizedEvents) {
            const key = getRiskEventKey(event);
            currentAlertKeys.add(key);
            if (!activeAlertKeys.has(key) && !newEvents.some(item => getRiskEventKey(item) === key)) {
                newEvents.push(event);
            }
        }

        let delivery = null;
        if (newEvents.length > 0) {
            delivery = await alertCallback(newEvents);
        }

        const deliveryFailed = Array.isArray(delivery?.failed) && delivery.failed.length > 0;
        if (dataComplete && !deliveryFailed) {
            activeAlertKeys = currentAlertKeys;
        }

        return {
            delivery,
            deliveredEvents: newEvents,
            suppressedCount: normalizedEvents.length - newEvents.length
        };
    };
}

/**
 * Executa uma verificação completa de riscos nos municípios dentro do raio definido.
 * 
 * @param {object} [options]
 * @param {number} [options.radiusKm=50] - Raio de monitoramento em KM.
 * @param {'RED'|'ORANGE'|'YELLOW'|'OFF'} [options.inmetMinSeverity='RED'] - Nível mínimo para alertas INMET.
 * @param {'RED'|'ORANGE'|'YELLOW'|'OFF'} [options.defesaCivilMinSeverity='ORANGE'] - Nível mínimo para Defesa Civil RS.
 * @param {string[]|null} [options.enabledCategories=null] - Categorias habilitadas (null = todas).
 * @param {function|null} [options.alertCallback] - Callback customizado para alertas.
 * @returns {Promise<{ citiesCount: number, highRiskCount: number, events: Array<object>, dataQuality: object }>}
 */
export async function performRegionalRiskMonitoring({
    radiusKm = 50,
    inmetMinSeverity = 'RED',
    defesaCivilMinSeverity = 'ORANGE',
    enabledCategories = null,
    alertCallback = onHighRiskEventDetected
} = {}) {
    const startTime = Date.now();
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`\n[${timestamp}] 🔍 Iniciando verificação de riscos regionais (Raio: ${radiusKm}km | INMET: ${inmetMinSeverity} | Defesa Civil: ${defesaCivilMinSeverity})...`);

    try {
        const cities = await getSurroundingCities(radiusKm);
        const [warningsResult, forecastsResult, telemetryResult] = await Promise.allSettled([
            getRegionalRiskWarnings(cities),
            getRegionalForecasts(cities),
            getDefesaCivilTelemetry(undefined, { throwOnError: true })
        ]);

        const dataErrors = [];
        let regionalWarnings = [];
        let regionalForecasts = [];
        let defesaCivilTelemetry = [];

        const warningsAvailable = warningsResult.status === 'fulfilled' && Array.isArray(warningsResult.value?.regionalWarnings);
        if (warningsAvailable) {
            regionalWarnings = warningsResult.value.regionalWarnings;
        } else {
            dataErrors.push(`INMET warnings unavailable: ${warningsResult.reason?.message || 'invalid response'}`);
        }

        let forecastFailures = 0;
        if (forecastsResult.status === 'fulfilled' && Array.isArray(forecastsResult.value)) {
            regionalForecasts = forecastsResult.value;
            const missingForecasts = Math.max(0, cities.length - regionalForecasts.length);
            const unusableForecasts = regionalForecasts.filter(city => {
                const forecast = city?.forecast;
                return city?.error || !forecast || typeof forecast !== 'object' || Array.isArray(forecast) || Object.keys(forecast).length === 0;
            }).length;
            forecastFailures = missingForecasts + unusableForecasts;
            if (forecastFailures > 0) {
                dataErrors.push(`INMET forecasts failed or were empty for ${forecastFailures} of ${cities.length} municipalities`);
            }
        } else {
            forecastFailures = cities.length;
            dataErrors.push(`INMET forecasts unavailable: ${forecastsResult.reason?.message || 'invalid response'}`);
        }

        if (telemetryResult.status === 'fulfilled' && Array.isArray(telemetryResult.value) && telemetryResult.value.length > 0) {
            defesaCivilTelemetry = telemetryResult.value;
        } else {
            const telemetryError = telemetryResult.reason?.message || 'empty response';
            dataErrors.push(`Defesa Civil telemetry unavailable: ${telemetryError}`);
        }

        const dataQuality = {
            complete: dataErrors.length === 0,
            warningsAvailable,
            forecastsAvailable: forecastsResult.status === 'fulfilled' && forecastFailures === 0,
            telemetryAvailable: telemetryResult.status === 'fulfilled' && defesaCivilTelemetry.length > 0,
            forecastFailures,
            errors: dataErrors
        };

        const highRiskEvents = evaluateHighRisksIn24hWindow({
            regionalWarnings,
            regionalForecasts,
            defesaCivilTelemetry,
            inmetMinSeverity,
            defesaCivilMinSeverity,
            now: new Date()
        }).filter(event =>
            !Array.isArray(enabledCategories) || enabledCategories.includes(getEventCategory(event))
        );

        const durationMs = Date.now() - startTime;
        console.log(`[${timestamp}] ✓ Monitoramento concluído. ${cities.length} municípios verificados.`);

        // Persist monitoring cycle log to SQLite
        logMonitorCycle({
            radiusKm,
            citiesCount: cities.length,
            highRiskCount: highRiskEvents.length,
            durationMs,
            success: dataQuality.complete,
            errorMessage: dataQuality.errors.join('; ') || null
        });

        // Persist each detected high-risk alert to SQLite
        for (const event of highRiskEvents) {
            logAlert(event);
        }

        if (highRiskEvents.length > 0) {
            if (typeof alertCallback === 'function') {
                await alertCallback(highRiskEvents);
            }
        } else if (dataQuality.complete) {
            console.log(`[${timestamp}] 🟢 Nenhum evento de alto risco detectado para as próximas 24 horas.`);
        } else {
            console.warn(`[${timestamp}] ⚠️ Dados incompletos; nenhum alerta de ausência de risco será emitido. ${dataQuality.errors.join(' | ')}`);
        }

        return {
            citiesCount: cities.length,
            highRiskCount: highRiskEvents.length,
            events: highRiskEvents,
            dataQuality
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
 * Inicia o loop contínuo do serviço de monitoramento com suporte a persistência SQLite e reconfiguração dinâmica.
 * 
 * @param {object} options
 * @param {number} [options.intervalMs] - Intervalo em milissegundos.
 * @param {number} [options.radiusKm] - Raio regional em KM.
 * @param {'RED'|'ORANGE'|'YELLOW'|'OFF'} [options.inmetMinSeverity] - Nível mínimo para alertas INMET.
 * @param {'RED'|'ORANGE'|'YELLOW'|'OFF'} [options.defesaCivilMinSeverity] - Nível mínimo para Defesa Civil RS.
 * @param {function} [options.alertCallback] - Callback customizado para alertas.
 * @param {boolean} [options.registerSignalHandlers=true] - Registra encerramento gracioso no processo.
 */
export function startMonitoringService(options = {}) {
    const config = parseMonitorConfig();
    let currentRadiusKm = options.radiusKm || config.radiusKm;
    let currentIntervalMs = options.intervalMs || config.intervalMs;
    let currentInmetMinSeverity = options.inmetMinSeverity || config.inmetMinSeverity;
    let currentDefesaCivilMinSeverity = options.defesaCivilMinSeverity || config.defesaCivilMinSeverity;
    let currentEnabledCategories = options.enabledCategories || config.enabledCategories;
    const alertCallback = typeof options.alertCallback === 'function'
        ? options.alertCallback
        : onHighRiskEventDetected;
    const dispatchAlerts = createAlertDispatcher(alertCallback);
    const registerSignalHandlers = options.registerSignalHandlers !== false;
    const intervalMins = Math.round((currentIntervalMs / (60 * 1000)) * 100) / 100;

    console.log('='.repeat(80));
    console.log(' SERVIÇO CONTINUO DE MONITORAMENTO DE RISCOS METEOROLÓGICOS (NODE 26)');
    console.log('='.repeat(80));
    console.log(` • Ponto Central:           Charqueadas - RS`);
    console.log(` • Raio Regional:           ${currentRadiusKm} km`);
    console.log(` • Intervalo de Verificação: A cada ${intervalMins} min (${currentIntervalMs} ms)`);
    console.log(` • Nível Alerta INMET:      ${currentInmetMinSeverity}`);
    console.log(` • Nível Alerta Defesa Civil: ${currentDefesaCivilMinSeverity}`);
    console.log(` • Armazenamento:           SQLite (database/weather_logs.db)`);
    console.log(` • Janela de Alerta:        Próximas 24 Horas`);
    console.log(` • Status:                  ATIVO E AGUARDANDO CICLOS`);
    console.log('='.repeat(80));

    let isRunning = false;
    let timerId = null;

    async function cycle() {
        if (isRunning) return;
        isRunning = true;
        try {
            const result = await performRegionalRiskMonitoring({
                radiusKm: currentRadiusKm,
                inmetMinSeverity: currentInmetMinSeverity,
                defesaCivilMinSeverity: currentDefesaCivilMinSeverity,
                enabledCategories: currentEnabledCategories,
                alertCallback: null
            });
            await dispatchAlerts(result.events, {
                dataComplete: result.dataQuality?.complete !== false
            });
        } catch (err) {
            console.error('⚠️ Falha no ciclo de monitoramento, o serviço continuará ativo:', err.message);
        } finally {
            isRunning = false;
        }
    }

    function rescheduleTimer() {
        if (timerId) clearInterval(timerId);
        timerId = setInterval(cycle, currentIntervalMs);
    }

    // Primeira execução imediata
    cycle();
    rescheduleTimer();

    // Encerramento gracioso para contêineres Docker e sinais de processo.
    const stop = () => {
        if (timerId) clearInterval(timerId);
    };

    const updateConfig = ({ radiusKm, intervalMinutes, intervalMs, inmetMinSeverity, defesaCivilMinSeverity, enabledCategories }) => {
        if (typeof radiusKm === 'number' && radiusKm > 0) {
            currentRadiusKm = radiusKm;
            try { saveSystemSetting('radius_km', radiusKm); } catch {}
        }
        if (typeof intervalMinutes === 'number' && intervalMinutes > 0) {
            currentIntervalMs = Math.round(intervalMinutes * 60 * 1000);
            try { saveSystemSetting('interval_minutes', intervalMinutes); } catch {}
            rescheduleTimer();
        } else if (typeof intervalMs === 'number' && intervalMs >= 1000) {
            currentIntervalMs = intervalMs;
            const mins = Math.round((intervalMs / (60 * 1000)) * 100) / 100;
            try { saveSystemSetting('interval_minutes', mins); } catch {}
            rescheduleTimer();
        }
        if (inmetMinSeverity) {
            currentInmetMinSeverity = normalizeSeverityTier(inmetMinSeverity);
            try { saveSystemSetting('inmet_min_severity', currentInmetMinSeverity); } catch {}
        }
        if (defesaCivilMinSeverity) {
            currentDefesaCivilMinSeverity = normalizeSeverityTier(defesaCivilMinSeverity);
            try { saveSystemSetting('defesa_civil_min_severity', currentDefesaCivilMinSeverity); } catch {}
        }
        if (Array.isArray(enabledCategories)) {
            for (const categoryId of Object.keys(ALERT_CATEGORIES)) {
                const enabled = enabledCategories.includes(categoryId);
                try { saveSystemSetting(`alert_cat_${categoryId}`, enabled ? '1' : '0'); } catch {}
            }
            currentEnabledCategories = Object.keys(ALERT_CATEGORIES)
                .filter(categoryId => enabledCategories.includes(categoryId));
        }
        return getConfig();
    };

    const getConfig = () => ({
        radiusKm: currentRadiusKm,
        intervalMs: currentIntervalMs,
        intervalMinutes: Math.round((currentIntervalMs / (60 * 1000)) * 100) / 100,
        inmetMinSeverity: currentInmetMinSeverity,
        defesaCivilMinSeverity: currentDefesaCivilMinSeverity,
        enabledCategories: [...(currentEnabledCategories || [])]
    });

    if (registerSignalHandlers) {
        const cleanup = () => {
            console.log('\n🛑 Encerrando serviço de monitoramento...');
            stop();
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }

    return { timerId, stop, updateConfig, getConfig, cycle };
}

// Executa o serviço diretamente se o script for chamado como módulo principal
if (import.meta.url === `file://${process.argv[1]}`) {
    startMonitoringService();
}
