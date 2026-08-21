# grammY UI & Interaction Patterns Reference

This document outlines grammY patterns for building stateful keyboards, routing callback queries, displaying toast notifications, and maintaining responsive, non-blocking bot UI.

---

## 1. Inline Keyboard Builders

Use grammY's `InlineKeyboard` to compose modular button matrices:

```javascript
import { InlineKeyboard } from 'grammy';

export function buildMatrixKeyboard(options, currentSelection) {
    const kb = new InlineKeyboard();

    options.forEach((opt, idx) => {
        const isSelected = opt.value === currentSelection;
        const label = `${isSelected ? '✅ ' : '⏱️ '}${opt.label}`;
        kb.text(label, `set_option:${opt.value}`);
        if (idx % 2 === 1) kb.row(); // 2 buttons per row
    });

    kb.row().text('⬅️ Voltar', 'menu:main');
    return kb;
}
```

---

## 2. In-Place Message Mutation (`editMessageText`)

To avoid polluting user chat history, update messages in place:

```javascript
bot.on('callback_query:data', async ctx => {
    const data = ctx.callbackQuery.data;

    // Always acknowledge the callback query
    if (data === 'menu:main') {
        await ctx.answerCallbackQuery('🌤️ Painel Principal');
        return ctx.editMessageText(renderMainMenu(), {
            reply_markup: buildMainMenuKeyboard()
        });
    }

    if (data.startsWith('set_interval:')) {
        const mins = parseInt(data.split(':')[1], 10);
        updateConfig({ intervalMinutes: mins });
        
        // Show toast notification
        await ctx.answerCallbackQuery(`✅ Intervalo atualizado para ${mins} min!`);
        
        return ctx.editMessageText(renderIntervalMenu(mins), {
            reply_markup: buildIntervalKeyboard(mins)
        });
    }
});
```

---

## 3. Toast Feedback vs Modal Dialogs

```javascript
// A. Toast notification (banner at the top of the Telegram app)
await ctx.answerCallbackQuery({ text: '✅ Dados atualizados com sucesso!' });

// B. Modal alert popup (requires explicit user dismissal button)
await ctx.answerCallbackQuery({
    text: '⚠️ ATENÇÃO: Nível do Rio Jacuí em cota de alerta crítico!',
    show_alert: true
});
```

---

## 4. Registering Native Bot Commands (`setMyCommands`)

Registering commands with BotFather enables native autocomplete in Telegram clients:

```javascript
export const BOT_COMMANDS = [
    { command: 'start', description: '🌤️ Painel meteorológico e menu interativo' },
    { command: 'menu', description: '🌤️ Abrir painel principal' },
    { command: 'status', description: '📊 Status do monitor e telemetria' },
    { command: 'jacui', description: '🌊 Rio Jacuí e dados da Defesa Civil RS' },
    { command: 'inmet', description: '⚡ Avisos meteorológicos oficiais' },
    { command: 'config', description: '⚙️ Ajustes de intervalo, raio e alertas' },
    { command: 'help', description: '📖 Ajuda e guia operacional' },
    { command: 'chatid', description: '🆔 Consultar ID deste chat Telegram' }
];

export async function registerCommands(bot) {
    try {
        await bot.api.setMyCommands(BOT_COMMANDS);
    } catch (err) {
        console.warn('Failed to register Telegram commands:', err.message);
    }
}
```
