/**
 * Telegram Bot Keyboard Builders.
 * Pure builders for menus, settings, categories, the email comunicado flow,
 * and the SMS consent flow (inline menus plus the native reply keyboard used
 * to capture a shared contact). No chat state — the orchestrator wires
 * callbacks.
 *
 * @module botKeyboards
 */

import { InlineKeyboard, Keyboard } from './telegram.js';
import {
    INMET_SEVERITY_OPTIONS,
    DEFESA_CIVIL_SEVERITY_OPTIONS,
    CATEGORY_SEVERITY_OPTIONS,
    getTierShortBadge,
    CONSENT_CANCEL_LABEL
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


/**
 * Builds the inline keyboard offered to regular (non-admin) users.
 * Beside the read-only last-scan jump it exposes the public SMS subscription
 * entry, which opens the LGPD consent term without granting admin rights.
 *
 * @returns {InlineKeyboard} Menu with last scan, SMS subscribe, and about.
 */
export function buildRegularKeyboard() {
    return new InlineKeyboard()
        .text('🚨 Ver Últimos Alertas', 'action:last_scan')
        .row()
        .text('📱 Inscrever SMS', 'consent:start')
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
        .text('📱 Inscritos SMS', 'menu:sms')
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


/**
 * Builds the action tray attached to an automatic alert message.
 * Every dispatch channel is consolidated behind the single `🔔 Disparos`
 * entry, so the administrator arms current and future channels in one place.
 *
 * @returns {InlineKeyboard}
 */
export function buildAlertActionKeyboard() {
    return new InlineKeyboard()
        .text('🚨 Alertas Ativos', 'action:active_alerts')
        .row()
        .text('🔔 Disparos', 'action:dispatches')
        .row()
        .text('🏠 Abrir Painel Principal', 'menu:main');
}


/**
 * Builds the action tray of the live active-alerts screen.
 *
 * @param {string} [refreshLabel='🔄 Atualizar'] - Label of the refresh button.
 * @returns {InlineKeyboard}
 */
export function buildActiveAlertsKeyboard(refreshLabel = '🔄 Atualizar') {
    return new InlineKeyboard()
        .text(refreshLabel, 'action:active_alerts')
        .text('⬅️ Menu', 'menu:main')
        .row()
        .text('🔔 Disparos', 'action:dispatches');
}


/**
 * Builds the dispatch-channel screen: one armed/disarmed toggle per channel
 * plus the compose entry points of the manual ones. A channel absent from the
 * map reads as armed, matching the runtime default, so a future channel can
 * be added here without touching the orchestrator.
 *
 * @param {{ telegram?: boolean, email?: boolean, sms?: boolean }} [dispatches={}] - Armed state per channel.
 * @returns {InlineKeyboard}
 */
export function buildDispatchesKeyboard(dispatches = {}) {
    const flag = channel => (dispatches[channel] === false ? '⬜' : '✅');
    const kb = new InlineKeyboard();
    kb.text(`${flag('telegram')} 🤖 Alertas automáticos (Telegram)`, 'dispatch:toggle:telegram').row();
    kb.text(`${flag('email')} 📧 E-mail (comunicado)`, 'dispatch:toggle:email').row();
    kb.text(`${flag('sms')} 📱 SMS para inscritos`, 'dispatch:toggle:sms').row();
    kb.text('📧 Compor e-mail', 'action:email_compose');
    kb.text('📱 Compor SMS', 'action:sms_compose').row();
    kb.text('⬅️ Voltar aos alertas', 'action:active_alerts');
    return kb;
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


/**
 * Builds the SMS compose keyboard. Send only appears when there is both an
 * active alert to report and at least one subscriber to receive it.
 *
 * @param {object} [options] - Availability flags.
 * @param {boolean} [options.canSend=true] - Whether active alerts exist.
 * @param {boolean} [options.hasSubscribers=true] - Whether the list is non-empty.
 * @returns {InlineKeyboard}
 */
export function buildSmsComposeKeyboard({ canSend = true, hasSubscribers = true } = {}) {
    const kb = new InlineKeyboard();
    if (canSend && hasSubscribers) {
        kb.text('📱 Enviar SMS agora', 'action:sms_send').row();
    }
    if (!hasSubscribers) {
        kb.text('👥 Adicionar primeiro inscrito', 'menu:sms').row();
    }
    kb.text('👥 Inscritos SMS', 'menu:sms').row();
    kb.text('⬅️ Voltar aos alertas', 'action:active_alerts');
    return kb;
}


/**
 * Builds the subscriber management keyboard.
 *
 * @returns {InlineKeyboard}
 */
export function buildSmsSubscribersKeyboard() {
    return new InlineKeyboard()
        .text('➕ Adicionar número', 'action:sms_add')
        .text('📋 Listar inscritos', 'action:sms_list')
        .row()
        .text('⬅️ Voltar às Configurações', 'menu:settings');
}


/**
 * Builds the agree/refuse inline keyboard attached to the consent term.
 * The two callbacks are public: citizens subscribe without admin rights.
 *
 * @returns {InlineKeyboard}
 */
export function buildConsentKeyboard() {
    return new InlineKeyboard()
        .text('✅ Concordo', 'consent:agree')
        .text('❌ Recusar', 'consent:decline');
}


/**
 * Builds the native share-contact reply keyboard for the second consent step.
 * `request_contact` is only offered by Telegram on a reply keyboard (never on
 * an inline one), so this is what turns the tap into the phone-number capture.
 *
 * @returns {Keyboard}
 */
export function buildConsentContactKeyboard() {
    return new Keyboard()
        .requestContact('📱 Compartilhar meu número')
        .row()
        .text(CONSENT_CANCEL_LABEL);
}
