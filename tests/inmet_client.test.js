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
  getAlertEmoji
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
    assert.ok(cities100.length >= 30);
    const hasCharqueadas = cities100.some(c => c.ibgeCode === '4305355' || c.name === 'Charqueadas');
    assert.strictEqual(hasCharqueadas, true);
  });

  it('getSurroundingCities(50) returns filtered list under 50km radius', async () => {
    const cities50 = await getSurroundingCities(50);
    assert.ok(Array.isArray(cities50));
    assert.ok(cities50.length < CHARQUEADAS_SURROUNDING_CITIES_100KM.length);
    assert.ok(cities50.every(c => c.distKm <= 50));
  });

  it('getRegionalRiskWarnings returns object with regionalWarnings and stateWarnings', async () => {
    const testCities = [
      { ibgeCode: '4305355', name: 'Charqueadas' },
      { ibgeCode: '4318408', name: 'São Jerônimo' }
    ];
    const warnings = await getRegionalRiskWarnings(testCities);
    assert.ok(warnings);
    assert.ok(Array.isArray(warnings.regionalWarnings));
    assert.ok(Array.isArray(warnings.stateWarnings));
  });

  it('getRegionalForecasts handles list of cities gracefully', async () => {
    const testCities = [
      { ibgeCode: '4305355', name: 'Charqueadas', role: 'Center' }
    ];
    const regionalForecasts = await getRegionalForecasts(testCities);
    assert.ok(Array.isArray(regionalForecasts));
    assert.strictEqual(regionalForecasts.length, 1);
    assert.strictEqual(regionalForecasts[0].name, 'Charqueadas');
    assert.ok(typeof regionalForecasts[0].forecast === 'object');
  });
});


