---
name: telegram-bot-ui-design
description: Comprehensive Telegram Bot UI/UX design system, component patterns, and interaction paradigms inspired by top players (@BotFather, @MissRose_bot, @Wallet, @TrojanBot, @WeathermanBot). Use this skill whenever designing or implementing Telegram bot user interfaces, interactive inline keyboards, Unicode cards, progress gauges, river/rain telemetry meters, breadcrumb navigation, toast/modal feedback, command menus, alert templates, or building clean conversational dashboards in grammY and Telegram Bot API.
---

# Telegram Bot UI Design Skill

This skill guides the design, component architecture, and implementation of **modern, high-contrast, interactive Telegram Bot user interfaces** inspired by top industry players (@BotFather, @MissRose_bot, @Wallet, @TrojanBot, @WeathermanBot).

---

## 🏛️ Core Design Principles for Telegram Bots

1. **Zero-Clutter Interaction (In-Place Message Updates):**
   - Never flood the user's chat history with new messages for menu navigation.
   - Always update existing messages using `ctx.editMessageText()` when the user taps an inline button.
   - Always acknowledge callback queries immediately using `ctx.answerCallbackQuery()` to provide instant toast or haptic feedback.

2. **High-Contrast Visual Hierarchy (Cards & Dividers):**
   - Structure cards using clear Unicode box dividers:
     - `CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━'`
     - `CARD_DIVIDER = '─────────────────────────'`
   - Use standardized emoji status badges (`🟢 NORMAL`, `🟡 ATENÇÃO`, `🟠 ALERTA`, `🔴 PERIGO`).

3. **Visual Meters & Telemetry Gauges:**
   - Render continuous numeric data (river levels, rain accumulations, wind speeds) using visual Unicode bars (e.g. `[██████░░░░] 60%`).
   - Pair metrics with trend indicators (`📈 Subindo (+0.12 m/h)`, `🔺 Subida Crítica`, `➡️ Estável`).

4. **Breadcrumb Navigation & Stateful Keyboards:**
   - Always show where the user is in the header (`🏠 Início > ⚙️ Configurações > ⏱️ Intervalo`).
   - Indicate active choices directly on button labels with checkmarks (`[ ✅ 15 min ]`, `[ ⏱️ 30 min ]`).
   - Include intuitive back navigation buttons (`[ ⬅️ Voltar ]`, `[ 🏠 Menu Principal ]`).

5. **Action Trays on Outbound Alerts:**
   - Attach contextual inline buttons to broadcast notifications (e.g. `[ 🌊 Ver Jacuí ]`, `[ ⚡ Avisos INMET ]`, `[ 🏠 Abrir Menu ]`) so users can drill into live data with a single tap.

---

## 🗂️ Reusable Resources Index

| Reference Guide | Content & Purpose | Location |
| :--- | :--- | :--- |
| **Top Players Analysis** | Teardown of UI patterns from @BotFather, @MissRose_bot, @Wallet, @TrojanBot, @WeathermanBot. | [`references/top-players-analysis.md`](references/top-players-analysis.md) |
| **UI Components Library** | Visual card layouts, Unicode dividers, progress gauges, severity badges, and breadcrumb patterns. | [`references/ui-components.md`](references/ui-components.md) |
| **grammY Implementation Patterns** | InlineKeyboard construction, callback query routing, toast notifications, error handling, and `setMyCommands`. | [`references/grammy-ui-patterns.md`](references/grammy-ui-patterns.md) |

---

## ⚡ Quick Start: Standard UI Layout Pattern

```javascript
import { InlineKeyboard } from 'grammy';

export const CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const CARD_DIVIDER = '─────────────────────────';

// 1. Dashboard Layout
export function renderDashboard(data) {
    return [
        '🌤️ PAINEL METEOROLÓGICO • CHARQUEADAS/RS',
        CARD_HEADER,
        '📍 Município Central: Charqueadas - RS',
        `🌊 Rio Jacuí: ${data.riverLevel} m ${renderProgressBar(data.riverLevel, 5.0, 8)}`,
        `   ↳ Tendência: ${renderRiverTrend(data.trend)}`,
        CARD_HEADER,
        '⚡ Status: 🟢 Sistema 100% Operacional',
        CARD_HEADER,
        '💡 Selecione uma opção rápida abaixo:'
    ].join('\n');
}

// 2. Action Keyboard
export function buildDashboardKeyboard() {
    return new InlineKeyboard()
        .text('🔍 Status', 'action:status')
        .text('🌊 Telemetria', 'action:defesa_civil')
        .row()
        .text('⚡ Avisos INMET', 'action:inmet_warnings')
        .text('⚙️ Configurações', 'menu:settings');
}
```
