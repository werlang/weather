import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    getDefesaCivilTelemetry,
    evaluateDefesaCivilRisks,
    CHARQUEADAS_STATION_CODE,
    REGIONAL_STATIONS,
    TAGS_DATA_QUERY
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

    it('declares non-null GraphQL list variables required by the server schema', () => {
        // The live API rejects nullable "$stations"/"$clients" with HTTP 400
        // (GRAPHQL_VALIDATION_FAILED: position expects type "[String!]!").
        assert.ok(TAGS_DATA_QUERY.includes('$stations: [String!]!'));
        assert.ok(TAGS_DATA_QUERY.includes('$clients: [String!]!'));
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

    it('declares official river quotas (alertLevelM / floodLevelM) for every regional station', () => {
        for (const station of REGIONAL_STATIONS) {
            assert.ok(
                typeof station.alertLevelM === 'number' && station.alertLevelM > 0,
                `${station.code} must declare a positive alertLevelM`
            );
            assert.ok(
                typeof station.floodLevelM === 'number' && station.floodLevelM > station.alertLevelM,
                `${station.code} must declare floodLevelM greater than alertLevelM`
            );
        }

        // Official values: Charqueadas cota de inundação = 4.6m (Defesa Civil RS,
        // July 2026 flood); São Jerônimo ANA gauge flood cota = 4.64m; Guaíba
        // reference (Cais Mauá C6) flood cota = 3.0m.
        const charqueadas = REGIONAL_STATIONS.find(s => s.code === CHARQUEADAS_STATION_CODE);
        assert.strictEqual(charqueadas.floodLevelM, 4.6);
        assert.strictEqual(charqueadas.alertLevelM, 4.05);

        const saoJeronimo = REGIONAL_STATIONS.find(s => s.code === 'DCRS-00093');
        assert.strictEqual(saoJeronimo.floodLevelM, 4.64);

        const eldorado = REGIONAL_STATIONS.find(s => s.code === 'DCRS-00076');
        assert.strictEqual(eldorado.floodLevelM, 3);
        assert.strictEqual(eldorado.alertLevelM, 2.55);
    });

    it('raises Red at the official Charqueadas flood cota even with a stable rise', () => {
        // Regression for the July 2026 event: the river reached 4.05m under an
        // active red-alert bulletin with flooding starting at 4.6m, while the old
        // global thresholds (>5.5m / >=6.5m) stayed silent forever.
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 4.7 }, rio_nivel_tendencia: { value: 0 } }
                }
            }
        ]);

        assert.strictEqual(risks.length, 1);
        assert.strictEqual(risks[0].colorTier, 'RED');
        assert.ok(risks[0].type.includes('Elevação Crítica'));
    });

    it('raises Orange above the official Charqueadas alert cota with a stable rise', () => {
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 4.2 }, rio_nivel_tendencia: { value: 0 } }
                }
            }
        ]);

        assert.strictEqual(risks.length, 1);
        assert.strictEqual(risks[0].colorTier, 'ORANGE');
        assert.ok(risks[0].type.includes('Elevação do Rio Baixo Jacuí'));
    });

    it('stays silent below the alert cota when the river level is stable', () => {
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-00032',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 3.9 }, rio_nivel_tendencia: { value: 0 } }
                }
            }
        ]);

        assert.strictEqual(risks.length, 0);
    });

    it('applies the Guaíba lake quotas to downstream stations independently of Jacuí quotas', () => {
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-00076',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 3.1 }, rio_nivel_tendencia: { value: 0 } }
                }
            },
            {
                codigo: 'DCRS-00054',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 2.8 }, rio_nivel_tendencia: { value: 0 } }
                }
            }
        ]);

        assert.strictEqual(risks.length, 2); // 3.1m floods (RED); 2.8m is alerta (ORANGE)
        assert.ok(risks.some(risk => risk.colorTier === 'RED' && risk.type.includes('Elevação Crítica')));
        assert.ok(risks.some(risk => risk.colorTier === 'ORANGE' && risk.type.includes('Elevação do Rio Lago Guaíba')));
    });

    it('falls back to trend-only river detection for unknown stations without registered quotas', () => {
        const risks = evaluateDefesaCivilRisks([
            {
                codigo: 'DCRS-99999',
                data: {
                    chuva: { acumulado: {} },
                    vento: { velocidade_maxima: { value: 0 } },
                    rio: { rio_nivel: { value: 9.5 }, rio_nivel_tendencia: { value: 0.3 } }
                }
            }
        ]);

        // Absolute level must NOT fire (no quotas registered); moderate trend fires Orange.
        assert.strictEqual(risks.length, 1);
        assert.strictEqual(risks[0].colorTier, 'ORANGE');
        assert.ok(risks[0].type.includes('Elevação do Rio Jacuí')); // default river name
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
