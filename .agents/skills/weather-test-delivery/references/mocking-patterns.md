# Deterministic Mocking Patterns Reference

This reference provides native JavaScript mocking recipes for Node 26 without external mocking frameworks (no Sinon, Nock, or Jest mocks).

---

## 1. INMET REST API Mocking (`fetch` Monkey-Patching)

Because `inmet_client.js` uses native `fetch`, mock HTTP responses by temporarily reassigning `globalThis.fetch` in a scoped block:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCityForecast, getActiveRiskWarnings } from '../src/inmet_client.js';

describe('INMET Client Mocking', () => {
  it('mocks 5-day forecast response deterministically', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        if (url.includes('/previsao/4305355')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              '4305355': {
                '20/08/2026': {
                  manha: { resumo: 'Céu claro', temp_min: 12, temp_max: 24, temp_min_tarde: 15, temp_max_tarde: 24, umidade_min: 40 },
                  tarde: { resumo: 'Ensolarado', temp_min: 12, temp_max: 24, umidade_min: 35 },
                  noite: { resumo: 'Poucas nuvens', temp_min: 14, temp_max: 20, umidade_min: 50 }
                }
              }
            })
          };
        }
        throw new Error(`Unexpected unmocked URL: ${url}`);
      };

      const forecast = await getCityForecast('4305355');
      assert.ok(forecast['20/08/2026']);
      assert.strictEqual(forecast['20/08/2026'].manha.resumo, 'Céu claro');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('mocks active severe alerts endpoint', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (url.includes('/avisos/ativos')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hoje: [
                {
                  id: 101,
                  aviso_cor: '#FF0000',
                  severidade: 'Grande Perigo',
                  descricao: 'Tempestade Severa',
                  inicio: '20/08/2026 12:00',
                  fim: '20/08/2026 23:59',
                  geocodes: ['4305355', '4318408'],
                  municipios: ['Charqueadas', 'São Jerônimo'],
                  riscos: ['Ventos > 100km/h', 'Granizo']
                }
              ],
              futuro: []
            })
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const warnings = await getActiveRiskWarnings('4305355');
      assert.strictEqual(warnings.length, 1);
      assert.strictEqual(warnings[0].severidade, 'Grande Perigo');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

---

## 2. Defesa Civil RS GraphQL Mocking

For hydrometeorological station telemetry (`https://redehidrometeorologica.defesacivil.rs.gov.br/graphql`):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Defesa Civil RS Telemetry Mocking', () => {
  it('mocks station DCRS-00032 (Charqueadas) river level and rainfall query', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/graphql'));
        assert.strictEqual(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.ok(body.query.includes('tags_data') || body.query.includes('qualle_meteorologia'));

        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              tags_data: {
                qualle_meteorologia: [
                  {
                    codigo: 'DCRS-00032',
                    name: { local: 'Charqueadas' },
                    timestamp: '2026-08-20T18:00:00Z',
                    position: { bacia: 'RS - Baixo Jacuí', latitude: -29.9478, longitude: -51.6174 },
                    data: {
                      rio: {
                        rio_nome: { value: 'Rio Jacuí' },
                        rio_nivel: { value: 6.85 }, // Level in meters
                        rio_nivel_tendencia: { value: 'SUBINDO' }
                      },
                      chuva: {
                        acumulado: {
                          h001: { value: 25.4 },
                          h024: { value: 85.2 }
                        }
                      },
                      vento: {
                        velocidade_media: { value: 35.0 },
                        velocidade_maxima: { value: 72.5 }
                      }
                    }
                  }
                ]
              }
            }
          })
        };
      };

      // Execute station query function under test
      const response = await fetch('https://redehidrometeorologica.defesacivil.rs.gov.br/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query { tags_data(station: ["DCRS-00032"]) { ... } }' })
      });
      const result = await response.json();
      const station = result.data.tags_data.qualle_meteorologia[0];

      assert.strictEqual(station.codigo, 'DCRS-00032');
      assert.strictEqual(station.data.rio.rio_nivel.value, 6.85);
      assert.strictEqual(station.data.chuva.acumulado.h024.value, 85.2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

---

## 3. Telegram Bot & grammY Test Double Pattern

Use lightweight dependency injection without bringing in heavy mock libraries:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramBotClient } from '../src/telegram.js';
import { WeatherTelegramBot } from '../src/telegram_bot.js';

/**
 * Creates a controllable fake bot matching grammY's core interface.
 */
export function createFakeBot() {
  const bot = {
    commandHandlers: new Map(),
    eventHandlers: new Map(),
    sentMessages: [],
    command(cmd, handler) {
      this.commandHandlers.set(cmd, handler);
    },
    on(filter, handler) {
      this.eventHandlers.set(filter, handler);
    },
    catch(handler) {
      this.errorHandler = handler;
    },
    start: async (options) => {
      options?.onStart?.({ username: 'weather_mock_bot' });
    },
    stop(reason) {
      this.stopReason = reason;
    }
  };
  bot.api = {
    sendMessage: async (chatId, text, options) => {
      bot.sentMessages.push({ chatId, text, options });
      return { message_id: bot.sentMessages.length };
    }
  };
  return bot;
}

describe('Telegram Bot Verification', () => {
  it('handles /status command and delivers reply to authorized admin', async () => {
    const fakeBot = createFakeBot();
    const telegramClient = new TelegramBotClient({
      token: 'mock-token',
      adminChatIds: ['12345678'],
      botFactory: () => fakeBot,
      logger: { error() {}, log() {} }
    });

    new WeatherTelegramBot({
      telegram: telegramClient,
      getStatus: () => '📡 Status: All systems operational'
    });

    const replies = [];
    const mockCtx = {
      chat: { id: 12345678 },
      reply: async (msg) => replies.push(msg)
    };

    const statusHandler = fakeBot.commandHandlers.get('status');
    await statusHandler(mockCtx);

    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /All systems operational/);
  });
});
```

---

## 4. Deterministic Clock & Date Injection

Avoid relying on `new Date()` directly in core business logic. Accept an optional `now` parameter:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHighRisksIn24hWindow } from '../src/monitor_service.js';

describe('24h Window Evaluation with Frozen Clock', () => {
  it('correctly evaluates window starting at fixed timestamp', () => {
    // Fixed timestamp: 2026-08-20 10:00:00 UTC
    const fixedNow = new Date('2026-08-20T10:00:00Z');

    const regionalWarnings = [
      {
        aviso_cor: '#FF0000',
        severidade: 'Grande Perigo',
        descricao: 'Ventos Furacão',
        inicio: '20/08/2026 08:00',
        fim: '20/08/2026 22:00',
        affectedRegionalCities: ['Charqueadas']
      }
    ];

    const risks = evaluateHighRisksIn24hWindow({
      regionalWarnings,
      regionalForecasts: [],
      now: fixedNow
    });

    assert.strictEqual(risks.length, 1);
    assert.strictEqual(risks[0].type, 'Ventos Furacão');
  });
});
```

---

## 5. Environment Variable Isolation in Tests

Always save and restore `process.env` properties inside test blocks:

```javascript
it('parses custom environment configuration safely', () => {
  const origRadius = process.env.RADIUS_KM;
  const origToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    process.env.RADIUS_KM = '85';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';

    // Call configuration parser
    // assert expectations...
  } finally {
    if (origRadius !== undefined) process.env.RADIUS_KM = origRadius;
    else delete process.env.RADIUS_KM;

    if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
  }
});
```
