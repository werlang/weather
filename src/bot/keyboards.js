/**
 * Telegram Bot Inline Keyboards.
 * Pure InlineKeyboard builders for menus, settings, categories, and the
 * email comunicado flow. No chat state — the orchestrator wires callbacks.
 *
 * @module botKeyboards
 */

import { InlineKeyboard } from './telegram.js';
import {
    INMET_SEVERITY_OPTIONS,
    DEFESA_CIVIL_SEVERITY_OPTIONS,
    CATEGORY_SEVERITY_OPTIONS,
    getTierShortBadge
} from './presentation.js';
import { ALERT_CATEGORIES, normalizeSeverityTier } from '../monitoring/risk_analyzer.js';


export function buildMainMenuKeyboard() {
    return new InlineKeyboard()
        .text('🔍 Status & Varredura', 'action:status')
        .text('🚨 Alertas Ativos', 'action:active_alerts')
        .row()
        .text('⚙️ Configurações', 'menu:settings')
        .text('❓ Ajuda & Comandos', 'action:help');
}


export function buildRegularKeyboard() {
    return new InlineKeyboard()
        .text('🚨 Ver Últimos Alertas', 'action:last_scan')
        .row()
        .text('ℹ️ Sobre o Bot', 'action:regular_about');
}


export function buildSettingsKeyboard(config = {}) {
    const total = Object.keys(ALERT_CATEGORIES).length;
    const tierMap = config.categoryMinSeverities || {};
    const enabledCount = Object.values(tierMap).filter(tier => normalizeSeverityTier(tier) !== 'OFF').length;
    // If no map provided (should not happen), assume all active
    const displayCount = Object.keys(tierMap).length === 0 ? total : enabledCount;
    return new InlineKeyboard()
        .text('⏱️ Alterar Intervalo', 'menu:interval')
        .text('📍 Alterar Raio Regional', 'menu:radius')
        .row()
        .text(`🚨 Categorias de Alerta: ${displayCount}/${total}`, 'menu:categories')
        .row()
        .text(`🏛️ Limiar INMET: ${getTierShortBadge(config.inmetMinSeverity)}`, 'menu:inmet_level')
        .row()
        .text(`🛡️ Limiar Defesa Civil: ${getTierShortBadge(config.defesaCivilMinSeverity)}`, 'menu:defesa_civil_level')
        .row()
        .text('👥 Convidar Administrador', 'menu:admins')
        .row()
        .text('⬅️ Voltar ao Menu Principal', 'menu:main');
}


export function buildAdminsKeyboard({ hasActiveCode = false } = {}) {
    const kb = new InlineKeyboard();
    kb.text('🎟️ Gerar Código de Convite (8 caracteres)', 'action:generate_invite').row();
    if (hasActiveCode) {
        kb.text('🔁 Regenerar Código', 'action:generate_invite').row();
        kb.text('🚫 Revogar Código Ativo', 'action:revoke_invite').row();
    }
    kb.text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildCategoriesKeyboard(categoryMinSeverities = {}) {
    const kb = new InlineKeyboard();
    for (const [categoryId, definition] of Object.entries(ALERT_CATEGORIES)) {
        const tier = categoryMinSeverities[categoryId] ?? 'YELLOW';
        const badge = getTierShortBadge(tier);
        kb.text(`${definition.emoji} ${definition.label}: ${badge}`, `menu:category:${categoryId}`).row();
    }
    kb.text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildCategoryLevelKeyboard(categoryId, currentLevel = 'YELLOW') {
    const kb = new InlineKeyboard();
    const norm = String(currentLevel || '').toUpperCase();
    CATEGORY_SEVERITY_OPTIONS.forEach(opt => {
        const isCurrent = norm === opt.id;
        const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
        kb.text(label, `set_cat:${categoryId}:${opt.id}`).row();
    });
    kb.text('⬅️ Voltar às Categorias', 'menu:categories');
    return kb;
}


export function buildIntervalKeyboard(currentMinutes = 15) {
    const intervals = [5, 15, 30, 60];
    const kb = new InlineKeyboard();

    intervals.forEach((mins, idx) => {
        const isCurrent = Math.round(currentMinutes) === mins;
        const label = `${isCurrent ? '✅ ' : '⏱️ '}${mins} min`;
        kb.text(label, `set_interval:${mins}`);
        if (idx % 2 === 1) kb.row();
    });

    kb.row().text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildRadiusKeyboard(currentRadius = 50) {
    const radii = [
        { km: 25, name: '25 km' },
        { km: 50, name: '50 km' },
        { km: 75, name: '75 km' },
        { km: 100, name: '100 km' }
    ];
    const kb = new InlineKeyboard();

    radii.forEach((r, idx) => {
        const isCurrent = Math.round(currentRadius) === r.km;
        const label = `${isCurrent ? '✅ ' : '📍 '}${r.name}`;
        kb.text(label, `set_radius:${r.km}`);
        if (idx % 2 === 1) kb.row();
    });

    kb.row().text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildInmetLevelKeyboard(currentLevel = 'RED') {
    const kb = new InlineKeyboard();
    const norm = String(currentLevel || '').toUpperCase();
    INMET_SEVERITY_OPTIONS.forEach(opt => {
        const isCurrent = norm === opt.id;
        const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
        kb.text(label, `set_inmet:${opt.id}`).row();
    });
    kb.text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildDefesaCivilLevelKeyboard(currentLevel = 'ORANGE') {
    const kb = new InlineKeyboard();
    const norm = String(currentLevel || '').toUpperCase();
    DEFESA_CIVIL_SEVERITY_OPTIONS.forEach(opt => {
        const isCurrent = norm === opt.id;
        const label = `${isCurrent ? '✅ ' : ''}${opt.label}`;
        kb.text(label, `set_dc:${opt.id}`).row();
    });
    kb.text('⬅️ Voltar às Configurações', 'menu:settings');
    return kb;
}


export function buildAlertActionKeyboard() {
    return new InlineKeyboard()
        .text('🚨 Alertas Ativos', 'action:active_alerts')
        .row()
        .text('📧 Enviar comunicado por e-mail', 'action:email_compose')
        .row()
        .text('🏠 Abrir Painel Principal', 'menu:main');
}


export function buildActiveAlertsKeyboard(refreshLabel = '🔄 Atualizar') {
    return new InlineKeyboard()
        .text(refreshLabel, 'action:active_alerts')
        .text('⬅️ Menu', 'menu:main')
        .row()
        .text('📧 Enviar comunicado por e-mail', 'action:email_compose');
}


export function buildEmailComposeKeyboard(canSend = true) {
    const kb = new InlineKeyboard();
    if (canSend) {
        kb.text('✅ Enviar com esta mensagem', 'action:email_send').row();
        kb.text('✏️ Editar mensagem', 'action:email_edit').row();
        kb.text('⏭️ Enviar sem mensagem', 'action:email_send_plain').row();
    }
    kb.text('⬅️ Voltar aos alertas', 'action:active_alerts');
    return kb;
}
