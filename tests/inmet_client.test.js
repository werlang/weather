import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CHARQUEADAS_IBGE_CODE,
  BASE_PREVMET_URL,
  CHARQUEADAS_SURROUNDING_CITIES,
  CHARQUEADAS_SURROUNDING_CITIES_100KM,
  getSurroundingCities,
  getRegionalForecasts,
  getRegionalRiskWarnings,
  getAlertEmoji,
  extractWarningGeocodeSet,
  warningAffectsCity
} from '../src/inmet_client.js';

describe('INMET Client Constants & Config', () => {
  it('defines correct IBGE code for Charqueadas', () => {
    assert.strictEqual(CHARQUEADAS_IBGE_CODE, '4305355');
  });

  it('defines correct base API URL', () => {
    assert.strictEqual(BASE_PREVMET_URL, 'https://apiprevmet3.inmet.gov.br');
  });

  it('contains expected list of surrounding cities in 100km radius with Charqueadas as center', () => {
    assert.ok(Array.isArray(CHARQUEADAS_SURROUNDING_CITIES_100KM));
    assert.ok(CHARQUEADAS_SURROUNDING_CITIES_100KM.length >= 30, 'Should cover 30+ municipalities within 100km radius');
    const target = CHARQUEADAS_SURROUNDING_CITIES_100KM.find(c => c.ibgeCode === '4305355');
    assert.ok(target, 'Charqueadas must be included in surrounding cities preset');
    assert.strictEqual(target.name, 'Charqueadas');
    assert.strictEqual(target.distKm, 0);
  });

  it('maps warning colors and severities to correct emojis via getAlertEmoji', () => {
    assert.strictEqual(getAlertEmoji({ aviso_cor: '#FF0000', severidade: 'Grande Perigo' }), '🔴');
    assert.strictEqual(getAlertEmoji({ aviso_cor: '#F96602', severidade: 'Perigo' }), '🟠');
    assert.strictEqual(getAlertEmoji({ aviso_cor: '#FFFE00', severidade: 'Perigo Potencial' }), '🟡');
  });
});

describe('Regional Risk Monitoring Client Functions', () => {
  it('getSurroundingCities(100) returns 100km radius list containing Charqueadas and regional IBGE codes', async () => {
    const cities100 = await getSurroundingCities(100);
    assert.ok(Array.isArray(cities100));
    assert.ok(cities100.length === 38, '100km ring must contain exactly 38 cities');
    const hasCharqueadas = cities100.some(c => c.ibgeCode === '4305355' || c.name === 'Charqueadas');
    assert.strictEqual(hasCharqueadas, true);
  });

  it('getSurroundingCities(50) returns filtered list under 50km radius', async () => {
    const cities50 = await getSurroundingCities(50);
    assert.ok(Array.isArray(cities50));
    assert.ok(cities50.length === 20, '50km ring must contain exactly 20 cities');
    assert.ok(cities50.every(c => c.distKm <= 50));
  });

  it('getRegionalRiskWarnings returns object with regionalWarnings and stateWarnings', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });
    try {
      const testCities = [
        { ibgeCode: '4305355', name: 'Charqueadas' },
        { ibgeCode: '4318408', name: 'São Jerônimo' }
      ];
      const warnings = await getRegionalRiskWarnings(testCities);
      assert.ok(warnings);
      assert.ok(Array.isArray(warnings.regionalWarnings));
      assert.ok(Array.isArray(warnings.stateWarnings));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('getRegionalForecasts handles list of cities gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ '4305355': { '15/08/2026': { manha: { resumo: 'Sol', temp_min: 10, temp_max: 20 } } } }),
      headers: { get: () => null }
    });
    try {
      const testCities = [
        { ibgeCode: '4305355', name: 'Charqueadas', role: 'Center' }
      ];
      const regionalForecasts = await getRegionalForecasts(testCities);
      assert.ok(Array.isArray(regionalForecasts));
      assert.strictEqual(regionalForecasts.length, 1);
      assert.strictEqual(regionalForecasts[0].name, 'Charqueadas');
      assert.ok(typeof regionalForecasts[0].forecast === 'object');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('INMET warning city matching (exact, no substring false positives)', () => {
  // Shape of live red alert id 28224 (2026-09-10): geocodes point to
  // Lajeado Grande - SC, São João do Triunfo - PR and Tenente Portela - RS —
  // none of which are Lajeado, Triunfo or Teutônia in RS.
  const redWarningOtherCities = {
    id_aviso: '28224',
    aviso_cor: '#F80703',
    severidade: 'Grande Perigo',
    descricao: 'Tempestade',
    inicio: '2026-09-10 00:01',
    fim: '2026-09-10 23:59',
    estados: 'Santa Catarina,Rio Grande do Sul,Paraná,Mato Grosso do Sul',
    geocodes: '4209458,4125100,4321402',
    municipios: 'Lajeado Grande - SC (4209458),São João do Triunfo - PR (4125100),Tenente Portela - RS (4321402)',
    riscos: ['Chuva superior a 60 mm/h']
  };

  it('does not match RS cities on out-of-state substring collisions', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [redWarningOtherCities]
    });
    try {
      const cities = [
        { ibgeCode: '4311403', name: 'Lajeado' },
        { ibgeCode: '4322004', name: 'Triunfo' },
        { ibgeCode: '4321451', name: 'Teutônia' },
        { ibgeCode: '4305355', name: 'Charqueadas' }
      ];
      const { regionalWarnings } = await getRegionalRiskWarnings(cities);
      assert.strictEqual(regionalWarnings.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('matches exact RS entries by code and by exact name', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        id_aviso: 'test-1',
        aviso_cor: '#FF0000',
        severidade: 'Grande Perigo',
        descricao: 'Tempestade',
        inicio: '2026-09-10 00:01',
        fim: '2026-09-10 23:59',
        estados: 'Rio Grande do Sul',
        geocodes: '4311403',
        municipios: 'Lajeado - RS (4311403),Charqueadas - RS',
        riscos: ['Vento']
      }]
    });
    try {
      const cities = [
        { ibgeCode: '4311403', name: 'Lajeado' },
        { ibgeCode: '4305355', name: 'Charqueadas' },
        { ibgeCode: '4322004', name: 'Triunfo' }
      ];
      const { regionalWarnings } = await getRegionalRiskWarnings(cities);
      assert.strictEqual(regionalWarnings.length, 1);
      assert.deepStrictEqual(regionalWarnings[0].affectedRegionalCities, ['Lajeado', 'Charqueadas']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extractWarningGeocodeSet merges geocodes and parenthetical codes with trimming', () => {
    const codes = extractWarningGeocodeSet({
      geocodes: '4311403, 4322004,',
      municipios: 'Lajeado - RS (4311403),Charqueadas - RS (4305355)'
    });
    assert.deepStrictEqual([...codes].sort(), ['4305355', '4311403', '4322004']);
    assert.strictEqual(extractWarningGeocodeSet({}).size, 0);
  });

  it('warningAffectsCity requires exact name and RS UF as fallback', () => {
    assert.strictEqual(
      warningAffectsCity({ municipios: 'Charqueadas - RS' }, { ibgeCode: '4305355', name: 'Charqueadas' }),
      true
    );
    assert.strictEqual(
      warningAffectsCity({ municipios: 'Lajeado Grande - SC (4209458)' }, { ibgeCode: '4311403', name: 'Lajeado' }),
      false
    );
    assert.strictEqual(
      warningAffectsCity({ municipios: 'São João do Triunfo - PR (4125100)' }, { ibgeCode: '4322004', name: 'Triunfo' }),
      false
    );
    assert.strictEqual(
      warningAffectsCity({ municipios: 'Lajeado - SC (1111111)' }, { ibgeCode: '4311403', name: 'Lajeado' }),
      false
    );
  });

  it('maps the observed INMET red variant #F80703 to the red emoji', () => {
    assert.strictEqual(getAlertEmoji({ aviso_cor: '#F80703', severidade: 'Severa' }), '🔴');
  });

  it('ships corrected IBGE codes for previously mismatched catalog cities', () => {
    const byName = name => CHARQUEADAS_SURROUNDING_CITIES_100KM.find(c => c.name === name);
    assert.strictEqual(byName('Taquari').ibgeCode, '4321303');
    assert.strictEqual(byName('Mariana Pimentel').ibgeCode, '4311981');
    assert.strictEqual(byName('Sertão Santana').ibgeCode, '4320552');
    assert.strictEqual(byName('Teutônia').ibgeCode, '4321451');
    assert.strictEqual(byName('Estrela').ibgeCode, '4307807');
    assert.strictEqual(byName('Santa Cruz do Sul').ibgeCode, '4316808');
  });
});


