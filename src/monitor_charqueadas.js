#!/usr/bin/env node
/**
 * Ferramenta CLI para monitoramento de riscos meteorológicos e previsão do tempo para Charqueadas - RS.
 * Desenvolvido para Node.js 26.
 */

import { getActiveRiskWarnings, getCityForecast, CHARQUEADAS_IBGE_CODE, getAlertEmoji } from './inmet_client.js';

async function main() {
  console.log('='.repeat(65));
  console.log(' MONITORAMENTO DE RISCOS & PREVISÃO METEOROLÓGICA INMET');
  console.log(' Município: Charqueadas - RS (Código IBGE: 4305355)');
  console.log(` Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  console.log('='.repeat(65));
  console.log();

  // 1. Buscar Alertas de Risco
  try {
    const { directCityWarnings, regionalStateWarnings } = await getActiveRiskWarnings(CHARQUEADAS_IBGE_CODE);

    console.log(`▶ ALERTAS DIRETOS DE PERIGO SEVERO PARA CHARQUEADAS (${directCityWarnings.length} ativos):`);
    if (directCityWarnings.length > 0) {
      directCityWarnings.forEach((risk, idx) => {
        const severity = risk.severidade || 'Desconhecida';
        const emoji = getAlertEmoji(risk);
        const start = risk.inicio || risk.hora_inicio || 'N/A';
        const end = risk.fim || risk.hora_fim || 'N/A';
        const risksDesc = risk.riscos || [];
        const instructions = risk.instrucoes || [];

        console.log(`\n  [${idx + 1}] Nível de Alerta: ${emoji} ${severity}`);
        console.log(`      Validade: ${start} -> ${end}`);
        if (risksDesc.length > 0) {
          console.log(`      Riscos: ${Array.isArray(risksDesc) ? risksDesc.join(', ') : risksDesc}`);
        }
        if (instructions.length > 0) {
          console.log(`      Ação de Segurança: ${Array.isArray(instructions) ? instructions.join(', ') : instructions}`);
        }
      });
    } else {
      console.log('  ✓ Nenhum aviso de grande perigo direto ativo para Charqueadas no momento.');
    }

    console.log();
    console.log(`▶ ALERTAS ESTADUAIS NO RIO GRANDE DO SUL (${regionalStateWarnings.length} ativos):`);
    if (regionalStateWarnings.length > 0) {
      regionalStateWarnings.forEach((risk) => {
        console.log(`  - [${getAlertEmoji(risk)} ${risk.severidade || 'Risco'}] ${risk.tipo || 'Evento'} (Período: ${risk.inicio || 'N/A'} -> ${risk.fim || 'N/A'})`);
      });
    } else {
      console.log('  ✓ Nenhum alerta estadual adicional no RS.');
    }
  } catch (error) {
    console.error('❌ Falha ao buscar alertas ativos:', error.message);
  }

  console.log();
  console.log('▶ RESUMO DA PREVISÃO DO TEMPO DE 5 DIAS:');
  try {
    const forecast = await getCityForecast(CHARQUEADAS_IBGE_CODE);

    for (const [dateStr, data] of Object.entries(forecast)) {
      if (data.manha) {
        const m = data.manha;
        const summary = m.resumo || 'N/A';
        const tMin = m.temp_min ?? 'N/A';
        const tMax = m.temp_max ?? 'N/A';
        const wind = `${m.dir_vento || ''} (${m.int_vento || ''})`;
        console.log(`  • ${dateStr} (Manhã): ${summary} | Temp: ${tMin}°C a ${tMax}°C | Vento: ${wind}`);
      } else if (data.resumo) {
        const summary = data.resumo || 'N/A';
        const tMin = data.temp_min ?? 'N/A';
        const tMax = data.temp_max ?? 'N/A';
        console.log(`  • ${dateStr} (Diário): ${summary} | Temp: ${tMin}°C a ${tMax}°C`);
      }
    }
  } catch (error) {
    console.error('❌ Falha ao buscar previsão do tempo:', error.message);
  }

  console.log('\n' + '='.repeat(65));
}

main().catch(err => {
  console.error('Erro fatal de execução:', err);
  process.exit(1);
});
