#!/usr/bin/env node
/**
 * Ferramenta CLI para monitoramento de riscos meteorológicos e alertas do INMET
 * para Charqueadas - RS e municípios vizinhos em um raio configurável (padrão: 50km).
 * Relatório sob demanda gerado via linha de comando.
 * 
 * Desenvolvido para Node.js 26.
 */

import {
    getSurroundingCities,
    getRegionalRiskWarnings,
    getRegionalForecasts,
    getAlertEmoji
} from './inmet_client.js';

import {
    parseRadiusArg,
    analyzeForecastRisks
} from './risk_analyzer.js';

async function main() {
    const radiusKm = parseRadiusArg();

    console.log('='.repeat(80));
    console.log(` MONITORAMENTO REGIONAL DE RISCOS METEOROLÓGICOS — RAIO DE ${radiusKm}KM (CHARQUEADAS - RS)`);
    console.log(` Ponto Central:        Charqueadas - RS (Código IBGE: 4305355)`);
    console.log(` Raio de Cobertura:    ${radiusKm} km`);
    console.log(` Data/Hora de Execução: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    console.log('='.repeat(80));
    console.log();

    // 1. Obter Lista de Municípios na Região
    let cities = [];
    try {
        cities = await getSurroundingCities(radiusKm);
        console.log(`▶ 1. MUNICÍPIOS MONITORADOS NO RAIO DE ${radiusKm}KM (${cities.length} no total):`);

        const immediate = cities.filter(c => (c.distKm ?? 0) <= 25);
        const intermediate = cities.filter(c => (c.distKm ?? 0) > 25 && (c.distKm ?? 0) <= 50);
        const outer = cities.filter(c => (c.distKm ?? 0) > 50);

        if (immediate.length > 0) {
            console.log(`   • Zona Imediata (<25km):      ${immediate.map(c => c.name).join(', ')}`);
        }
        if (intermediate.length > 0) {
            console.log(`   • Zona Intermediária (25-50km): ${intermediate.map(c => c.name).join(', ')}`);
        }
        if (outer.length > 0) {
            console.log(`   • Anel Externo (50-100km):     ${outer.map(c => c.name).join(', ')}`);
        }
        console.log();
    } catch (err) {
        console.error('❌ Falha ao buscar municípios da região:', err.message);
        return;
    }

    // 2. Buscar Avisos Oficiais Ativos do INMET
    console.log(`▶ 2. AVISOS OFICIAIS DE PERIGO SEVERO ATIVOS DO INMET (RAIO DE ${radiusKm}KM):`);
    try {
        const { regionalWarnings, stateWarnings } = await getRegionalRiskWarnings(cities);

        if (regionalWarnings.length > 0) {
            console.log(`   🚨 ${regionalWarnings.length} AVISO(S) DO INMET AFETANDO DIRETAMENTE A REGIÃO DE ${radiusKm}KM:\n`);
            regionalWarnings.forEach((warning, idx) => {
                const severity = warning.severidade || 'Desconhecida';
                const eventType = warning.descricao || warning.tipo || 'Evento Severo';
                const emoji = getAlertEmoji(warning);
                const start = warning.inicio || warning.hora_inicio || 'N/A';
                const end = warning.fim || warning.hora_fim || 'N/A';
                const affected = (warning.affectedRegionalCities || []).join(', ') || 'Municípios da Região';
                const risksDesc = warning.riscos || [];
                const instructions = warning.instrucoes || [];

                console.log(`   [Aviso #${idx + 1}] Evento: ${eventType} | Severidade: ${emoji} ${severity}`);
                console.log(`              Período de Validade:     ${start}  --->  ${end}`);
                console.log(`              Municípios Afetados:     ${affected}`);
                if (risksDesc.length > 0) {
                    console.log(`              Descrição dos Riscos:    ${Array.isArray(risksDesc) ? risksDesc.join(' | ') : risksDesc}`);
                }
                if (instructions.length > 0) {
                    const instStr = Array.isArray(instructions) ? instructions.join(' ') : instructions;
                    console.log(`              Instruções de Segurança: ${instStr.substring(0, 160)}${instStr.length > 160 ? '...' : ''}`);
                }
                console.log('   ' + '-'.repeat(75));
            });
        } else {
            console.log(`   ✓ Nenhum aviso de grande perigo ou tempestade severa direto ativo para o raio de ${radiusKm}km no momento.`);
        }

        if (stateWarnings.length > 0) {
            console.log(`\n   ℹ️  Alertas em nível estadual no Rio Grande do Sul (${stateWarnings.length} ativos):`);
            stateWarnings.forEach(w => {
                console.log(`      - [${getAlertEmoji(w)} ${w.severidade || 'Risco'}] ${w.descricao || w.tipo || 'Evento'} (${w.inicio || 'N/A'} -> ${w.fim || 'N/A'})`);
            });
        }
    } catch (err) {
        console.error('❌ Falha ao buscar alertas do INMET:', err.message);
    }

    console.log('\n' + '='.repeat(80));

    // 3. Previsões e Riscos para os Próximos Dias
    console.log(`▶ 3. RISCOS METEOROLÓGICOS PARA OS PRÓXIMOS DIAS (HORIZONTE DE 5 DIAS - ${radiusKm}KM):`);
    try {
        const regionalData = await getRegionalForecasts(cities);

        const dateMap = new Map();

        for (const cityData of regionalData) {
            const cityName = cityData.name;
            const forecast = cityData.forecast || {};

            for (const [dateStr, dayData] of Object.entries(forecast)) {
                if (!dateMap.has(dateStr)) {
                    dateMap.set(dateStr, []);
                }

                const samplePeriod = dayData.manha ? dayData.manha : dayData;
                const tempMin = samplePeriod.temp_min;
                const tempMax = samplePeriod.temp_max;
                const summary = samplePeriod.resumo || 'N/A';
                const wind = samplePeriod.int_vento || 'N/A';
                const humidityMin = samplePeriod.umidade_min;

                const risks = analyzeForecastRisks(samplePeriod);

                dateMap.get(dateStr).push({
                    city: cityName,
                    summary,
                    tempMin,
                    tempMax,
                    wind,
                    humidityMin,
                    risks
                });
            }
        }

        if (dateMap.size === 0) {
            console.log('   ⚠️  Nenhuma informação de previsão disponível no momento.');
        } else {
            for (const [dateStr, cityForecasts] of dateMap.entries()) {
                console.log(`\n📅 DATA: ${dateStr}`);

                const allRisksForDate = [];
                let globalMaxTemp = -Infinity;
                let globalMinTemp = Infinity;

                cityForecasts.forEach(cf => {
                    if (cf.tempMax !== undefined && cf.tempMax > globalMaxTemp) globalMaxTemp = cf.tempMax;
                    if (cf.tempMin !== undefined && cf.tempMin < globalMinTemp) globalMinTemp = cf.tempMin;
                    cf.risks.forEach(r => {
                        allRisksForDate.push({ ...r, city: cf.city });
                    });
                });

                let riskBadge = '🟢 RISCO BAIXO / ESTÁVEL';
                const highCount = allRisksForDate.filter(r => r.severity === 'HIGH').length;
                const modCount = allRisksForDate.filter(r => r.severity === 'MODERATE').length;

                if (highCount > 0) {
                    riskBadge = '🔴 RISCO ALTO ELEVADO';
                } else if (modCount > 0) {
                    riskBadge = '🟡 ALERTA DE RISCO MODERADO';
                }

                console.log(`   Status Geral:      ${riskBadge}`);
                console.log(`   Variação Térmica:  ${globalMinTemp !== Infinity ? globalMinTemp : 'N/A'}°C a ${globalMaxTemp !== -Infinity ? globalMaxTemp : 'N/A'}°C em ${cityForecasts.length} municípios`);

                if (allRisksForDate.length > 0) {
                    console.log(`   Riscos Identificados no Raio de ${radiusKm}km:`);
                    const severityRank = { 'HIGH': 3, 'MODERATE': 2, 'LOW': 1 };
                    const groupedByType = new Map();
                    allRisksForDate.forEach(r => {
                        if (!groupedByType.has(r.type)) {
                            groupedByType.set(r.type, { severity: r.severity, detail: r.detail, cities: [r.city] });
                        } else {
                            const existing = groupedByType.get(r.type);
                            existing.cities.push(r.city);
                            if ((severityRank[r.severity] || 0) > (severityRank[existing.severity] || 0)) {
                                existing.severity = r.severity;
                                existing.detail = r.detail;
                            }
                        }
                    });

                    for (const [type, data] of groupedByType.entries()) {
                        const levelStr = data.severity === 'HIGH' ? '⚠️ ALTO' : data.severity === 'MODERATE' ? '⚡ MODERADO' : 'ℹ️  BAIXO';
                        console.log(`     - [${levelStr}] ${type}: ${data.detail}`);
                        const affectedCitiesStr = data.cities.length > 8 ? `${data.cities.slice(0, 8).join(', ')} + ${data.cities.length - 8} mais` : data.cities.join(', ');
                        console.log(`       Municípios Afetados (${data.cities.length}): ${affectedCitiesStr}`);
                    }
                } else {
                    console.log('   ✓ Nenhum risco meteorológico significativo detectado na previsão para esta data.');
                }

                console.log('   Amostra de Previsões por Município:');
                cityForecasts.slice(0, 12).forEach(cf => {
                    const tStr = `${cf.tempMin ?? '?'}°C a ${cf.tempMax ?? '?'}°C`;
                    console.log(`     • ${cf.city.padEnd(18)}: ${cf.summary.padEnd(38)} | Temp: ${tStr}`);
                });
                if (cityForecasts.length > 12) {
                    console.log(`     ... e mais ${cityForecasts.length - 12} municípios no raio de ${radiusKm}km.`);
                }
            }
        }
    } catch (err) {
        console.error('❌ Falha ao analisar previsões da região:', err.message);
    }

    console.log('\n' + '='.repeat(80));
    console.log('▶ 4. RECOMENDAÇÕES DA DEFESA CIVIL E CORPO DE BOMBEIROS:');
    console.log('   • Telefone de Emergência da Defesa Civil:  199');
    console.log('   • Corpo de Bombeiros Militar:               193');
    console.log('   • Em caso de chuvas intensas/alagamentos: Evite trafegar por vias alagadas ou atravessar arroios e sangradouros transbordados.');
    console.log('   • Em caso de ventos fortes: Mantenha distância de torres de transmissão, árvores de grande porte e estruturas publicitárias.');
    console.log('='.repeat(80));
}

main().catch(err => {
    console.error('Erro fatal de execução:', err);
    process.exit(1);
});
