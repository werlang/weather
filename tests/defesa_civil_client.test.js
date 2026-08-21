import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    getDefesaCivilTelemetry,
    evaluateDefesaCivilRisks,
    CHARQUEADAS_STATION_CODE,
    REGIONAL_STATIONS
} from '../src/defesa_civil_client.js';
import { evaluateHighRisksIn24hWindow } from '../src/risk_analyzer.js';
import { getDatabase } from '../src/log_database.js';

describe('Defesa Civil RS Telemetry Client & Risk Evaluation', () => {
    let testDb;

    beforeEach(() => {
        testDb = getDatabase(':memory:');
    });

    it('contains Charqueadas target station code and regional definitions', () => {
        assert.strictEqual(CHARQUEADAS_STATION_CODE, 'DCRS-00032');
        assert.ok(REGIONAL_STATIONS.some(s => s.code === 'DCRS-00032' && s.name === 'Charqueadas'));
        assert.ok(REGIONAL_STATIONS.some(s => s.code === 'DCRS-00093'));
        assert.ok(REGIONAL_STATIONS.some(s => s.code === 'DCRS-00076'));
    });

    it('evaluates Orange Alert for rain >= 30mm/h or wind >= 75km/h or rapid river rise >= 0.25m/h', () => {
        const sampleStations = [
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: { min015: { value: 10 }, h001: { value: 35 }, h003: { value: 40 } } },
                    vento: { velocidade_maxima: { value: 60 } },
                    rio: { rio_nivel: { value: 3.8 }, rio_nivel_tendencia: { value: 0.1 } }
                }
            },
            {
                codigo: 'DCRS-00093',
                data: {
                    chuva: { acumulado: { h001: { value: 5 } } },
                    vento: { velocidade_maxima: { value: 80 } },
                    rio: { rio_nivel: { value: 4.1 }, rio_nivel_tendencia: { value: 0.3 } }
                }
            }
        ];

        const risks = evaluateDefesaCivilRisks(sampleStations);
        assert.strictEqual(risks.length, 3); // Rain on 00032, wind on 00093, river trend on 00093
        assert.ok(risks.some(r => r.colorTier === 'ORANGE' && r.type.includes('Chuva Intensa')));
        assert.ok(risks.some(r => r.colorTier === 'ORANGE' && r.type.includes('Vendaval')));
        assert.ok(risks.some(r => r.colorTier === 'ORANGE' && r.type.includes('Elevação do Rio')));
    });

    it('evaluates Red Alert for rain >= 50mm/h or wind >= 100km/h or critical river rise >= 0.5m/h', () => {
        const extremeStation = [
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: { h001: { value: 65 }, h003: { value: 90 } } },
                    vento: { velocidade_maxima: { value: 105 } },
                    rio: { rio_nivel: { value: 5.5 }, rio_nivel_tendencia: { value: 0.6 } }
                }
            }
        ];

        const risks = evaluateDefesaCivilRisks(extremeStation);
        assert.strictEqual(risks.length, 3);
        assert.ok(risks.every(r => r.colorTier === 'RED'));
        assert.ok(risks.some(r => r.type.includes('Chuva Torrencial Extrema')));
        assert.ok(risks.some(r => r.type.includes('Rajada Extrema')));
        assert.ok(risks.some(r => r.type.includes('Elevação Crítica')));
    });

    it('evaluateHighRisksIn24hWindow strictly enforces: Orange for Defesa Civil OR Red with INMET', () => {
        const inmetOrangeWarning = [
            {
                aviso_cor: '#F96602',
                severidade: 'Perigo',
                descricao: 'Tempestade',
                affectedRegionalCities: ['Charqueadas']
            }
        ];

        const inmetRedWarning = [
            {
                aviso_cor: '#FF0000',
                severidade: 'Grande Perigo',
                descricao: 'Tempestade Severa com Ciclone',
                affectedRegionalCities: ['Charqueadas']
            }
        ];

        const dcOrangeTelemetry = [
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: { h001: { value: 35 } } }
                }
            }
        ];

        // 1. INMET Orange alone -> DOES NOT TRIGGER
        const resultInmetOrange = evaluateHighRisksIn24hWindow({
            regionalWarnings: inmetOrangeWarning,
            regionalForecasts: [],
            defesaCivilTelemetry: []
        });
        assert.strictEqual(resultInmetOrange.length, 0, 'INMET Orange alone must not trigger');

        // 2. INMET Red alone -> TRIGGERS
        const resultInmetRed = evaluateHighRisksIn24hWindow({
            regionalWarnings: inmetRedWarning,
            regionalForecasts: [],
            defesaCivilTelemetry: []
        });
        assert.strictEqual(resultInmetRed.length, 1, 'INMET Red must trigger');
        assert.strictEqual(resultInmetRed[0].severity, 'Grande Perigo');
        assert.strictEqual(resultInmetRed[0].colorTier, 'RED');

        // 3. Defesa Civil Orange alone -> TRIGGERS
        const resultDcOrange = evaluateHighRisksIn24hWindow({
            regionalWarnings: [],
            regionalForecasts: [],
            defesaCivilTelemetry: dcOrangeTelemetry
        });
        assert.strictEqual(resultDcOrange.length, 1, 'Defesa Civil Orange must trigger');
        assert.strictEqual(resultDcOrange[0].colorTier, 'ORANGE');
    });

    it('alerts for daily basin rainfall and an already high river level', () => {
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: { h024: { value: 90 } } },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 6.6 }, rio_nivel_tendencia: { value: 0 } }
                }
            }
        ]);

        assert.ok(risks.some(risk => risk.details.includes('90 mm em 24h') && risk.colorTier === 'ORANGE'));
        assert.ok(risks.some(risk => risk.type.includes('Elevação Crítica') && risk.colorTier === 'RED'));
    });

    it('can propagate telemetry failures to the monitoring coordinator', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: false,
            status: 503,
            json: async () => ({})
        });

        try {
            await assert.rejects(
                getDefesaCivilTelemetry([], { log: false, throwOnError: true }),
                /Defesa Civil GraphQL error 503/
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
