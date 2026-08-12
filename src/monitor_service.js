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
 * Função de Gatilho / Placeholder para Eventos de Alto Risco nas Próximas 24 Horas.
 * Chamada automaticamente quando um evento severo é detectado na janela de monitoramento.
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
    console.log(` [#${idx + 1}] ${event.emoji} ${event.type.toUpperCase()}`);
    console.log(`      Origem:             ${event.source}`);
    console.log(`      Severidade:         ${event.severity}`);
    console.log(`      Janela de Tempo:    ${event.timeframe}`);
    console.log(`      Municípios:         ${(event.affectedCities || []).join(', ')}`);
    console.log(`      Detalhes do Risco:  ${event.details}`);
    console.log('-'.repeat(80));
  });

  /**
   * =========================================================================
   * PLACEHOLDER DE ALERTA E INTEGRAÇÕES FUTURAS
   * =========================================================================
   * Esta função pode ser estendida para disparar notificações em tempo real:
   * 
   *  - Webhooks de comunicação (Slack, Discord, Microsoft Teams)
   *  - Serviços de SMS e Notificações Push (Twilio, Firebase SNS)
   *  - Mensagens diretas via WhatsApp API ou Telegram Bot
   *  - Disparo de sirenes ou comunicação direta com Defesa Civil local
   * =========================================================================
   */
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

    console.log(`[${timestamp}] ✓ Monitoramento concluído. ${cities.length} municípios verificados.`);

    if (highRiskEvents.length > 0) {
      if (typeof alertCallback === 'function') {
        alertCallback(highRiskEvents);
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
 */
export function startMonitoringService(options = {}) {
  const config = parseMonitorConfig();
  const radiusKm = options.radiusKm || config.radiusKm;
  const intervalMs = options.intervalMs || config.intervalMs;
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
      await performRegionalRiskMonitoring({ radiusKm });
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

  // Encerramento gracioso para contêineres Docker e sinais de processo
  const cleanup = () => {
    console.log('\n🛑 Encerrando serviço de monitoramento...');
    if (timerId) clearInterval(timerId);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { timerId, stop: cleanup };
}

// Executa o serviço diretamente se o script for chamado como módulo principal
if (import.meta.url === `file://${process.argv[1]}`) {
  startMonitoringService();
}
