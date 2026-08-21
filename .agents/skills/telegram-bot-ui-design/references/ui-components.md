# Telegram Bot UI Components Library

This reference provides reusable UI component patterns, text formatting templates, and layout helpers for Telegram bots.

---

## 1. Visual Card Borders & Dividers

```javascript
export const CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const CARD_DIVIDER = '─────────────────────────';
```

### Usage Pattern
```javascript
export function renderCard(title, items, footer) {
    return [
        title,
        CARD_HEADER,
        ...items,
        CARD_HEADER,
        footer
    ].join('\n');
}
```

---

## 2. Progress Meters & Gauges

Render a proportional gauge using block characters `█` and `░`:

```javascript
/**
 * Renders a visual Unicode gauge/progress meter.
 * E.g. [██████░░░░] 60%
 *
 * @param {number} value - Current value.
 * @param {number} max - Maximum scale value.
 * @param {number} [length=8] - Number of segments.
 * @param {string} [filledChar='█'] - Filled character.
 * @param {string} [emptyChar='░'] - Empty character.
 * @returns {string} E.g. "[████░░░░] 50%"
 */
export function renderProgressBar(value, max, length = 8, filledChar = '█', emptyChar = '░') {
    if (max <= 0 || value === null || value === undefined || isNaN(value)) {
        return `[${emptyChar.repeat(length)}]`;
    }
    const ratio = Math.max(0, Math.min(1, value / max));
    const filled = Math.round(ratio * length);
    const empty = Math.max(0, length - filled);
    const pct = Math.round(ratio * 100);
    return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}] ${pct}%`;
}
```

---

## 3. Dynamic Rate-of-Change & Trend Badges

```javascript
/**
 * Renders a descriptive river level trend with speed context.
 *
 * @param {number|undefined|null} trend - Trend in m/h.
 * @returns {string} Formatted trend indicator.
 */
export function renderRiverTrend(trend) {
    if (trend === undefined || trend === null || isNaN(trend)) return '';
    if (trend >= 0.25) return `🔺 Subida Crítica (+${trend} m/h)`;
    if (trend > 0) return `📈 Subindo (+${trend} m/h)`;
    if (trend === 0) return '➡️ Estável (0.00 m/h)';
    if (trend <= -0.25) return `🔻 Descida Rápida (${trend} m/h)`;
    return `📉 Descendo (${trend} m/h)`;
}
```

---

## 4. Severity Status Badges

```javascript
/**
 * Maps a severity string to a high-contrast visual badge.
 *
 * @param {string} severity
 * @returns {string}
 */
export function renderSeverityBadge(severity = '') {
    const lower = String(severity).toLowerCase();
    if (lower.includes('grande perigo') || lower.includes('máximo') || lower.includes('extremo') || lower.includes('red')) {
        return '🔴 GRANDE PERIGO (CRÍTICO)';
    }
    if (lower.includes('potencial') || lower.includes('amarelo') || lower.includes('yellow') || lower.includes('atenção')) {
        return '🟡 PERIGO POTENCIAL (MODERADO)';
    }
    if (lower.includes('perigo') || lower.includes('laranja') || lower.includes('orange') || lower.includes('alerta')) {
        return '🟠 PERIGO (SEVERO)';
    }
    return '🟢 NORMAL / MONITORAMENTO';
}
```

---

## 5. Breadcrumb Header Formatting

```javascript
export function renderBreadcrumbs(path) {
    // E.g. ['🏠 Início', '⚙️ Configurações', '⏱️ Intervalo'] -> "🏠 Início > ⚙️ Configurações > ⏱️ Intervalo"
    return path.join(' > ');
}
```

---

## 6. Action Trays for Alerts

```javascript
import { InlineKeyboard } from 'grammy';

export function buildAlertActionKeyboard() {
    return new InlineKeyboard()
        .text('🌊 Ver Jacuí & Chuva', 'action:defesa_civil')
        .text('⚡ Avisos INMET', 'action:inmet_warnings')
        .row()
        .text('🏠 Abrir Painel Principal', 'menu:main');
}
```
