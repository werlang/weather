import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseMonitorConfig,
  parseForecastDate,
  evaluateHighRisksIn24hWindow,
  onHighRiskEventDetected,
  startMonitoringService,
  createAlertDispatcher,
  performRegionalRiskMonitoring
} from '../src/monitor_service.js';
import { analyzeForecastRisks, parseRadiusArg, getEventCategory } from '../src/risk_analyzer.js';
import { getSurroundingCities } from '../src/inmet_client.js';
import { Sqlite } from '../src/database_driver.js';
import { getDatabase } from '../src/log_database.js';

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

describe('Monitor Service Configuration, Dynamic Updates & Radius Verification', () => {
  it('parseMonitorConfig parses default values correctly when env vars are absent', () => {
    const origRadius = process.env.RADIUS_KM;
    const origInterval = process.env.MONITOR_INTERVAL_MINUTES;
    const origDbPath = process.env.DB_PATH;
    process.env.DB_PATH = ':memory:';
    Sqlite.close();
    delete process.env.RADIUS_KM;
    delete process.env.RADIUS;
    delete process.env.MONITOR_INTERVAL_MINUTES;
    delete process.env.MONITOR_INTERVAL_MS;

    try {
      const config = parseMonitorConfig();
      assert.strictEqual(config.radiusKm, 50);
      assert.strictEqual(config.intervalMs, 15 * 60 * 1000);
      assert.strictEqual(config.intervalMinutes, 15);
    } finally {
      Sqlite.close();
      if (origRadius) process.env.RADIUS_KM = origRadius;
      if (origInterval) process.env.MONITOR_INTERVAL_MINUTES = origInterval;
      if (origDbPath) process.env.DB_PATH = origDbPath;
      else delete process.env.DB_PATH;
    }
  });

  it('parseMonitorConfig prefers database settings over environment variables', () => {
    const origDbPath = process.env.DB_PATH;
    process.env.DB_PATH = ':memory:';
    Sqlite.close();
    process.env.RADIUS_KM = '75';
    process.env.MONITOR_INTERVAL_MINUTES = '10';
    process.env.INMET_MIN_SEVERITY = 'YELLOW';

    try {
      // Fresh database is seeded with defaults (migration 002): 50 km / 15 min / RED / ORANGE.
      const config = parseMonitorConfig();
      assert.strictEqual(config.radiusKm, 50);
      assert.strictEqual(config.intervalMinutes, 15);
      assert.strictEqual(config.inmetMinSeverity, 'RED');
      assert.strictEqual(config.defesaCivilMinSeverity, 'ORANGE');
    } finally {
      Sqlite.close();
      delete process.env.RADIUS_KM;
      delete process.env.MONITOR_INTERVAL_MINUTES;
      delete process.env.INMET_MIN_SEVERITY;
      if (origDbPath) process.env.DB_PATH = origDbPath;
      else delete process.env.DB_PATH;
    }
  });

  it('parseMonitorConfig falls back to environment variables when the database key is absent', () => {
    const origDbPath = process.env.DB_PATH;
    process.env.DB_PATH = ':memory:';
    Sqlite.close();
    const db = getDatabase();
    for (const key of ['radius_km', 'interval_minutes', 'inmet_min_severity', 'defesa_civil_min_severity']) {
      db.delete('system_settings', { key });
    }

    process.env.RADIUS_KM = '75';
    process.env.MONITOR_INTERVAL_MINUTES = '10';
    process.env.INMET_MIN_SEVERITY = 'YELLOW';
    process.env.DEFESA_CIVIL_MIN_SEVERITY = 'ORANGE';

    try {
      const config = parseMonitorConfig();
      assert.strictEqual(config.radiusKm, 75);
      assert.strictEqual(config.intervalMinutes, 10);
      assert.strictEqual(config.inmetMinSeverity, 'YELLOW');
      assert.strictEqual(config.defesaCivilMinSeverity, 'ORANGE');
    } finally {
      Sqlite.close();
      delete process.env.RADIUS_KM;
      delete process.env.MONITOR_INTERVAL_MINUTES;
      delete process.env.INMET_MIN_SEVERITY;
      delete process.env.DEFESA_CIVIL_MIN_SEVERITY;
      if (origDbPath) process.env.DB_PATH = origDbPath;
      else delete process.env.DB_PATH;
    }
  });

  it('getSurroundingCities strictly filters tracked cities by radius (25km vs 50km vs 75km vs 100km)', async () => {
    const cities25 = await getSurroundingCities(25);
    const cities50 = await getSurroundingCities(50);
    const cities75 = await getSurroundingCities(75);
    const cities100 = await getSurroundingCities(100);

    assert.strictEqual(cities25.length, 6, '25km ring must contain exactly 6 cities');
    assert.strictEqual(cities50.length, 20, '50km ring must contain exactly 20 cities');
    assert.strictEqual(cities75.length, 31, '75km ring must contain exactly 31 cities');
    assert.strictEqual(cities100.length, 38, '100km ring must contain exactly 38 cities');

    // Verify distance invariant
    assert.ok(cities25.every(c => c.distKm <= 25));
    assert.ok(cities50.every(c => c.distKm <= 50));
    assert.ok(cities75.every(c => c.distKm <= 75));
    assert.ok(cities100.every(c => c.distKm <= 100));

    // Verify Charqueadas is always center in every ring
    assert.ok(cities25.some(c => c.name === 'Charqueadas' && c.distKm === 0));
  });

  it('classifies every mapped event type into its alert category', () => {
    const cases = [
      [{ type: 'Tempestade Severa / Temporal Extremo' }, 'chuva'],
      [{ type: 'Chuva / Instabilidade' }, 'chuva'],
      [{ type: 'Frio Extremo / Risco de Congelamento' }, 'temperatura'],
      [{ type: 'Geada / Frio Típico de Inverno', details: 'Temp. Mínima: 3°C' }, 'temperatura'],
      [{ type: 'Aviso de Baixa Temperatura' }, 'temperatura'],
      [{ type: 'Onda de Calor Extrema / Risco à Saúde' }, 'temperatura'],
      [{ type: 'Calor Intenso' }, 'temperatura'],
      [{ type: 'Emergência de Baixa Umidade do Ar' }, 'umidade'],
      [{ type: 'Aviso de Baixa Umidade Relativa do Ar' }, 'umidade'],
      [{ type: 'Vendaval / Rajadas Destrutivas de Vento' }, 'vento'],
      [{ type: 'Ventos Fortes / Rajadas de Vento' }, 'vento'],
      [{ type: 'Chuva Torrencial Extrema (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'chuva'],
      [{ type: 'Chuva Intensa / Risco de Alagamento (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'chuva'],
      [{ type: 'Vendaval / Rajada Extrema (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'vento'],
      [{ type: 'Vendaval / Rajadas Fortes (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'vento'],
      [{ type: 'Elevação Crítica do Rio Jacuí (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'rio'],
      [{ type: 'Elevação do Rio Lago Guaíba (Telemetria)', source: 'DEFESA_CIVIL_RS' }, 'rio'],
      // INMET passthrough warnings are classified by their description
      [{ type: 'Possibilidade de Chuva Intensa com Vendavais' }, 'chuva'],
      [{ type: 'Aviso de Onda de Calor' }, 'temperatura'],
    ];
    for (const [event, expected] of cases) {
      assert.strictEqual(getEventCategory(event), expected, `category for ${event.type}`);
    }
  });

  it('startMonitoringService dynamically updates radius, interval timer, and independent threat levels at runtime', () => {
    delete process.env.RADIUS_KM;
    delete process.env.MONITOR_INTERVAL_MINUTES;

    const monitor = startMonitoringService({
      radiusKm: 50,
      intervalMs: 15 * 60 * 1000,
      inmetMinSeverity: 'RED',
      defesaCivilMinSeverity: 'ORANGE',
      registerSignalHandlers: false
    });

    try {
      const initialConfig = monitor.getConfig();
      assert.strictEqual(initialConfig.radiusKm, 50);
      assert.strictEqual(initialConfig.intervalMinutes, 15);
      assert.strictEqual(initialConfig.intervalMs, 900000);
      assert.strictEqual(initialConfig.inmetMinSeverity, 'RED');
      assert.strictEqual(initialConfig.defesaCivilMinSeverity, 'ORANGE');

      // Change interval to 5 min -> timer rescheduled to 300,000 ms
      const updatedInterval = monitor.updateConfig({ intervalMinutes: 5 });
      assert.strictEqual(updatedInterval.intervalMinutes, 5);
      assert.strictEqual(updatedInterval.intervalMs, 300000);

      // Change radius to 100 km -> tracked radius expanded
      const updatedRadius = monitor.updateConfig({ radiusKm: 100 });
      assert.strictEqual(updatedRadius.radiusKm, 100);

      // Change independent threat levels
      const updatedLevels = monitor.updateConfig({
        inmetMinSeverity: 'ORANGE',
        defesaCivilMinSeverity: 'RED'
      });
      assert.strictEqual(updatedLevels.inmetMinSeverity, 'ORANGE');
      assert.strictEqual(updatedLevels.defesaCivilMinSeverity, 'RED');

      const finalConfig = monitor.getConfig();
      assert.strictEqual(finalConfig.radiusKm, 100);
      assert.strictEqual(finalConfig.intervalMinutes, 5);
      assert.strictEqual(finalConfig.inmetMinSeverity, 'ORANGE');
      assert.strictEqual(finalConfig.defesaCivilMinSeverity, 'RED');
    } finally {
      monitor.stop();
    }
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
      alertPolicy: 'school',
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
      alertPolicy: 'school',
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

  it('ignores INMET warnings outside the next 24-hour window', () => {
    const events = evaluateHighRisksIn24hWindow({
      now: new Date('2026-08-21T12:00:00Z'),
      regionalWarnings: [
        {
          id_aviso: 'expired-warning',
          aviso_cor: '#FF0000',
          severidade: 'Grande Perigo',
          descricao: 'Tempestade encerrada',
          inicio: '2026-08-20 00:00',
          fim: '2026-08-20 23:59',
          affectedRegionalCities: ['Charqueadas']
        },
        {
          id_aviso: 'future-warning',
          aviso_cor: '#FF0000',
          severidade: 'Grande Perigo',
          descricao: 'Tempestade futura',
          inicio: '2026-08-23 00:00',
          fim: '2026-08-23 23:59',
          affectedRegionalCities: ['Charqueadas']
        }
      ]
    });

    assert.deepStrictEqual(events, []);
  });

  it('evaluates morning, afternoon, and night forecast periods independently', () => {
    const events = evaluateHighRisksIn24hWindow({
      now: new Date('2026-08-21T10:00:00Z'),
      regionalForecasts: [{
        name: 'Charqueadas',
        forecast: {
          '21/08/2026': {
            manha: { resumo: 'Céu limpo', temp_min: 15, temp_max: 25 },
            tarde: { resumo: 'Tempestade severa com trovoadas', temp_min: 15, temp_max: 25 },
            noite: { resumo: 'Céu limpo', temp_min: 15, temp_max: 22 }
          }
        }
      }]
    });

    assert.strictEqual(events.length, 1);
    assert.match(events[0].timeframe, /tarde/);
  });

  it('keeps distinct INMET warnings with the same type and city', () => {
    const events = evaluateHighRisksIn24hWindow({
      now: new Date('2026-08-21T10:00:00Z'),
      regionalWarnings: [
        {
          id_aviso: 'warning-a',
          aviso_cor: '#FF0000',
          severidade: 'Grande Perigo',
          descricao: 'Tempestade',
          inicio: '2026-08-21 10:00',
          fim: '2026-08-21 12:00',
          riscos: ['Alagamento'],
          affectedRegionalCities: ['Charqueadas']
        },
        {
          id_aviso: 'warning-b',
          aviso_cor: '#FF0000',
          severidade: 'Grande Perigo',
          descricao: 'Tempestade',
          inicio: '2026-08-21 18:00',
          fim: '2026-08-21 23:00',
          riscos: ['Granizo'],
          affectedRegionalCities: ['Charqueadas']
        }
      ]
    });

    assert.strictEqual(events.length, 2);
    assert.deepStrictEqual(events.map(event => event.details), ['Alagamento', 'Granizo']);
  });
});

describe('Alert dispatch state', () => {
  it('sends an active event once and sends it again after it clears', async () => {
    const deliveries = [];
    const dispatch = createAlertDispatcher(async events => {
      deliveries.push(events);
      return { sent: [{ chatId: '123', chunks: 1 }], failed: [] };
    });
    const event = {
      source: 'INMET_OFFICIAL_WARNING',
      eventId: 'warning-1',
      type: 'Tempestade',
      affectedCities: ['Charqueadas'],
      timeframe: '21/08/2026 10:00 -> 12:00'
    };

    await dispatch([event], { dataComplete: true });
    await dispatch([event], { dataComplete: true });
    await dispatch([], { dataComplete: true });
    await dispatch([event], { dataComplete: true });

    assert.strictEqual(deliveries.length, 2);
  });

  it('does not clear active alert state when source data is incomplete', async () => {
    const deliveries = [];
    const dispatch = createAlertDispatcher(async events => {
      deliveries.push(events);
      return { sent: [{ chatId: '123', chunks: 1 }], failed: [] };
    });
    const event = {
      source: 'INMET_OFFICIAL_WARNING',
      eventId: 'warning-1',
      type: 'Tempestade',
      affectedCities: ['Charqueadas'],
      timeframe: '21/08/2026 10:00 -> 12:00'
    };

    await dispatch([event], { dataComplete: true });
    await dispatch([], { dataComplete: false });
    await dispatch([event], { dataComplete: true });

    assert.strictEqual(deliveries.length, 1);
  });
});

describe('Monitoring data quality', () => {
  it('filters high-risk events by the enabled alert categories', async () => {
    const originalFetch = globalThis.fetch;
    const originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = ':memory:';
    Sqlite.close();

    // Telemetry station simultaneously exceeding the orange rain rule and the red river rule
    globalThis.fetch = async url => {
      if (String(url).includes('/avisos/ativos')) return { ok: true, status: 200, json: async () => [] };
      if (String(url).includes('/previsao/')) return { ok: true, status: 200, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            tags_data: {
              qualle_meteorologia: [{
                codigo: 'DCRS-00032',
                data: {
                  chuva: { acumulado: { min015: { value: 25 } } },
                  vento: { velocidade_maxima: { value: 0 } },
                  rio: { rio_nivel: { value: 6.6 }, rio_nivel_tendencia: { value: 0 } }
                }
              }]
            }
          }
        })
      };
    };

    try {
      const unfiltered = await performRegionalRiskMonitoring({
        radiusKm: 25,
        defesaCivilMinSeverity: 'ORANGE',
        alertCallback: null
      });
      assert.strictEqual(unfiltered.highRiskCount, 2);

      const riversOnly = await performRegionalRiskMonitoring({
        radiusKm: 25,
        defesaCivilMinSeverity: 'ORANGE',
        enabledCategories: ['rio'],
        alertCallback: null
      });
      assert.strictEqual(riversOnly.highRiskCount, 1);
      assert.match(riversOnly.events[0].type, /Elevação Crítica/);
    } finally {
      globalThis.fetch = originalFetch;
      Sqlite.close();
      if (originalDbPath === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = originalDbPath;
    }
  });

  it('does not report no-risk when forecasts fail or return empty payloads', async () => {
    const originalFetch = globalThis.fetch;
    const originalDbPath = process.env.DB_PATH;
    const originalSqliteDbPath = process.env.SQLITE_DB_PATH;
    const callbackEvents = [];

    process.env.DB_PATH = ':memory:';
    delete process.env.SQLITE_DB_PATH;
    Sqlite.close();
    let forecastRequests = 0;
    globalThis.fetch = async url => {
      if (String(url).includes('/avisos/ativos')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (String(url).includes('/previsao/')) {
        forecastRequests += 1;
        if (forecastRequests === 1) throw new Error('simulated forecast outage');
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { tags_data: { qualle_meteorologia: [] } } })
      };
    };

    try {
      const result = await performRegionalRiskMonitoring({
        radiusKm: 25,
        alertCallback: events => callbackEvents.push(events)
      });

      assert.strictEqual(result.highRiskCount, 0);
      assert.strictEqual(result.dataQuality.complete, false);
      assert.strictEqual(result.dataQuality.forecastFailures, 6);
      assert.strictEqual(result.dataQuality.telemetryAvailable, false);
      assert.deepStrictEqual(callbackEvents, []);
    } finally {
      globalThis.fetch = originalFetch;
      Sqlite.close();
      if (originalDbPath === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = originalDbPath;
      if (originalSqliteDbPath === undefined) delete process.env.SQLITE_DB_PATH;
      else process.env.SQLITE_DB_PATH = originalSqliteDbPath;
    }
  });
});
