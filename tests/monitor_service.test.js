import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseMonitorConfig,
  parseForecastDate,
  evaluateHighRisksIn24hWindow,
  onHighRiskEventDetected
} from '../src/monitor_service.js';
import { analyzeForecastRisks, parseRadiusArg } from '../src/risk_analyzer.js';

describe('Shared Risk Analyzer Utilities', () => {
  it('parseRadiusArg extracts distance from CLI args and env vars', () => {
    delete process.env.RADIUS_KM;
    delete process.env.RADIUS;

    assert.strictEqual(parseRadiusArg(50), 50);

    process.env.RADIUS_KM = '80';
    assert.strictEqual(parseRadiusArg(50), 80);
    delete process.env.RADIUS_KM;
  });

  it('analyzeForecastRisks classifies storm, frost, heatwave, low humidity and wind risks', () => {
    const stormForecast = { resumo: 'Tempestade com trovoadas com pancadas', temp_min: 15, temp_max: 25 };
    const stormRisks = analyzeForecastRisks(stormForecast);
    assert.strictEqual(stormRisks.some(r => r.severity === 'HIGH' && r.type.includes('Tempestade')), true);

    const subZeroForecast = { resumo: 'Céu limpo com risco de congelamento', temp_min: -1, temp_max: 10 };
    const subZeroRisks = analyzeForecastRisks(subZeroForecast);
    assert.strictEqual(subZeroRisks.some(r => r.severity === 'HIGH' && r.type.includes('Frio Extremo')), true);

    const normalWinterFrost = { resumo: 'Céu limpo com geada', temp_min: 3, temp_max: 12 };
    const normalFrostRisks = analyzeForecastRisks(normalWinterFrost);
    assert.strictEqual(normalFrostRisks.some(r => r.severity === 'MODERATE' && r.type.includes('Geada')), true);

    const heatForecast = { resumo: 'Ensolarado', temp_min: 24, temp_max: 41 };
    const heatRisks = analyzeForecastRisks(heatForecast);
    assert.strictEqual(heatRisks.some(r => r.severity === 'HIGH' && r.type.includes('Calor')), true);

    const humidityForecast = { resumo: 'Seco', umidade_min: 10 };
    const humidityRisks = analyzeForecastRisks(humidityForecast);
    assert.strictEqual(humidityRisks.some(r => r.severity === 'HIGH' && r.type.includes('Umidade')), true);

    const windForecast = { resumo: 'Ventos severos', int_vento: 'Muito forte' };
    const windRisks = analyzeForecastRisks(windForecast);
    assert.strictEqual(windRisks.some(r => r.severity === 'HIGH' && r.type.includes('Vendaval')), true);
  });
});

describe('Monitor Service Configuration & Utilities', () => {
  it('parseMonitorConfig parses default values correctly when env vars are absent', () => {
    const origRadius = process.env.RADIUS_KM;
    const origInterval = process.env.MONITOR_INTERVAL_MINUTES;
    delete process.env.RADIUS_KM;
    delete process.env.RADIUS;
    delete process.env.MONITOR_INTERVAL_MINUTES;
    delete process.env.MONITOR_INTERVAL_MS;

    const config = parseMonitorConfig();
    assert.strictEqual(config.radiusKm, 50);
    assert.strictEqual(config.intervalMs, 15 * 60 * 1000);
    assert.strictEqual(config.intervalMinutes, 15);

    if (origRadius) process.env.RADIUS_KM = origRadius;
    if (origInterval) process.env.MONITOR_INTERVAL_MINUTES = origInterval;
  });

  it('parseMonitorConfig respects MONITOR_INTERVAL_MINUTES and RADIUS_KM env vars', () => {
    process.env.RADIUS_KM = '75';
    process.env.MONITOR_INTERVAL_MINUTES = '10';

    const config = parseMonitorConfig();
    assert.strictEqual(config.radiusKm, 75);
    assert.strictEqual(config.intervalMs, 10 * 60 * 1000);
    assert.strictEqual(config.intervalMinutes, 10);
  });

  it('parseForecastDate parses DD/MM/YYYY dates into valid Date objects', () => {
    const d = parseForecastDate('15/08/2026');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getFullYear(), 2026);
    assert.strictEqual(d.getMonth(), 7); // Mês base 0 (Agosto = 7)
    assert.strictEqual(d.getDate(), 15);
  });

  it('parseForecastDate returns null for invalid formats', () => {
    assert.strictEqual(parseForecastDate(null), null);
    assert.strictEqual(parseForecastDate('invalid'), null);
    assert.strictEqual(parseForecastDate('2026-08-15'), null);
  });
});

describe('24-Hour Window High-Risk Evaluation', () => {
  it('detects high-risk INMET official warnings overlapping 24h window', () => {
    const now = new Date('2026-08-15T10:00:00Z');
    const regionalWarnings = [
      {
        aviso_cor: '#FF0000',
        severidade: 'Grande Perigo',
        descricao: 'Tempestade Severa com Ventos Extremos',
        inicio: '15/08/2026 08:00',
        fim: '15/08/2026 22:00',
        affectedRegionalCities: ['Charqueadas', 'São Jerônimo'],
        riscos: ['Queda de árvores', 'Alagamentos']
      },
      {
        aviso_cor: '#FFFE00',
        severidade: 'Perigo Potencial',
        descricao: 'Chuva Fraca',
        inicio: '15/08/2026 08:00',
        fim: '15/08/2026 22:00',
        affectedRegionalCities: ['Taquari']
      }
    ];

    const highRisks = evaluateHighRisksIn24hWindow({
      regionalWarnings,
      regionalForecasts: [],
      now
    });

    assert.strictEqual(highRisks.length, 1);
    assert.strictEqual(highRisks[0].source, 'INMET_OFFICIAL_WARNING');
    assert.strictEqual(highRisks[0].type, 'Tempestade Severa com Ventos Extremos');
    assert.strictEqual(highRisks[0].severity, 'Grande Perigo');
    assert.ok(highRisks[0].triggerReason.includes('INMET'));
    assert.deepStrictEqual(highRisks[0].affectedCities, ['Charqueadas', 'São Jerônimo']);
  });

  it('detects high-risk forecast conditions (storm, extreme cold, extreme heat) within 24h window', () => {
    const now = new Date(2026, 7, 15, 10, 0, 0); // 15 de Agosto de 2026
    const regionalForecasts = [
      {
        name: 'Charqueadas',
        forecast: {
          '15/08/2026': {
            temp_min: -1,
            temp_max: 18,
            resumo: 'Tempestade com pancadas de chuva fortes',
            umidade_min: 50
          }
        }
      },
      {
        name: 'São Jerônimo',
        forecast: {
          '15/08/2026': {
            temp_min: 24,
            temp_max: 42,
            resumo: 'Ensolarado com calor extremo',
            umidade_min: 10
          }
        }
      }
    ];

    const highRisks = evaluateHighRisksIn24hWindow({
      regionalWarnings: [],
      regionalForecasts,
      now
    });

    assert.ok(highRisks.length >= 3, 'Should detect storm, sub-zero cold, and extreme heatwave');
    const stormEvent = highRisks.find(e => e.type.includes('Tempestade'));
    assert.ok(stormEvent, 'Must detect storm in forecast');
    assert.strictEqual(stormEvent.affectedCities[0], 'Charqueadas');

    const frostEvent = highRisks.find(e => e.type.includes('Frio Extremo'));
    assert.ok(frostEvent, 'Must detect sub-zero severe cold (temp_min <= 0°C)');

    const heatEvent = highRisks.find(e => e.type.includes('Calor'));
    assert.ok(heatEvent, 'Must detect extreme heatwave (temp_max >= 40°C)');
  });

  it('invokes onHighRiskEventDetected callback without errors', () => {
    const dummyEvents = [
      {
        source: 'TEST',
        type: 'Alerta de Teste',
        severity: 'HIGH',
        emoji: '🚨',
        affectedCities: ['Charqueadas'],
        timeframe: 'Próximas 24h',
        details: 'Teste de disparo de alerta'
      }
    ];

    assert.doesNotThrow(() => {
      onHighRiskEventDetected(dummyEvents);
    });
  });
});
