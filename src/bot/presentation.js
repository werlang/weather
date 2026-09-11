/**
 * Telegram Bot Presentation Atoms.
 * Pure UI constants, severity options, badges, commands, and welcome copy.
 * No dependencies — imported by keyboards and the bot orchestrator.
 * 
 * @module botPresentation
 */

/**
 * Unicode visual divider constants for high-contrast card UI.
 */
export const CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const CARD_DIVIDER = '─────────────────────────';




/**
 * INMET independent severity options.
 */
export const INMET_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Grande Perigo)', desc: 'Apenas alertas extremos com risco à vida e bens.' },
    { id: 'ORANGE', label: '🟠 Laranja (Perigo) ou superior', desc: 'Inclui tempestades e chuvas intensas moderadas/severas.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Perigo Potencial) ou superior', desc: 'Modo informativo amplo para qualquer aviso.' },
    { id: 'OFF', label: '🚫 Desativar Alertas INMET', desc: 'Não emite alertas automáticos originados do INMET.' }
];

/**
 * Defesa Civil RS independent severity options.
 */
export const DEFESA_CIVIL_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Alerta Máximo)', desc: 'Precipitação torrencial extrema e inundações iminentes.' },
    { id: 'ORANGE', label: '🟠 Laranja (Alerta / Severo) ou superior', desc: 'Chuva >= 30mm/h, ventos >= 75km/h, subida rápida do Jacuí.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Atenção) ou superior', desc: 'Chuva moderada >= 15mm/h ou ventos >= 50km/h.' },
    { id: 'OFF', label: '🚫 Desativar Alertas Defesa Civil', desc: 'Não emite alertas automáticos da Defesa Civil RS.' }
];

/**
 * Alert-category independent severity options (same 4-tier model as institutes).
 */
export const CATEGORY_SEVERITY_OPTIONS = [
    { id: 'RED', label: '🔴 Vermelho (Grande Perigo)', desc: 'Apenas eventos críticos com risco elevado.' },
    { id: 'ORANGE', label: '🟠 Laranja (Perigo) ou superior', desc: 'Inclui eventos moderados a severos.' },
    { id: 'YELLOW', label: '🟡 Amarelo (Perigo Potencial) ou superior', desc: 'Modo informativo para qualquer severidade.' },
    { id: 'OFF', label: '🚫 Desativado', desc: 'Silencia todos os alertas desta categoria.' }
];

/**
 * Formats a severity tier into a readable emoji badge.
 * 
 * @param {string} tier 
 * @returns {string}
 */
export function getTierBadge(tier) {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === 'RED') return '🔴 Vermelho (Grande Perigo)';
    if (normalized === 'ORANGE') return '🟠 Laranja (Alerta / Perigo)';
    if (normalized === 'YELLOW') return '🟡 Amarelo (Atenção / Potencial)';
    return '🚫 Desativado';
}


/**
 * Maps a severity tier to its short colored circle badge for compact menu buttons.
 *
 * @param {string} tier
 * @returns {string}
 */
export function getTierShortBadge(tier) {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === 'RED') return '🔴 Vermelho';
    if (normalized === 'ORANGE') return '🟠 Laranja';
    if (normalized === 'YELLOW') return '🟡 Amarelo';
    return '🚫 Desativado';
}


/**
 * Standard Telegram Bot command menu definition for autocomplete.
 */
export const BOT_COMMANDS = [
    { command: 'start', description: '🌤️ Painel meteorológico e menu interativo' },
    { command: 'menu', description: '🌤️ Abrir painel principal' },
    { command: 'status', description: '📊 Status do monitor e do banco de dados' },
    { command: 'alertas', description: '🚨 Avisos e alertas ativos (INMET + Defesa Civil RS)' },
    { command: 'config', description: '⚙️ Ajustes de intervalo, raio e alertas' },
    { command: 'help', description: '📖 Ajuda e guia operacional' }
];

/**
 * Maps a severity string or canonical tier to a high-contrast visual badge.
 * Understands Portuguese severity names, canonical tiers (RED/ORANGE/YELLOW),
 * and the analyzer's English gradings (HIGH/MODERATE/LOW).
 *
 * @param {string} severity
 * @returns {string}
 */
export function renderSeverityBadge(severity = '') {
    const lower = String(severity).toLowerCase();
    const upper = String(severity).toUpperCase();
    if (upper === 'UNKNOWN' || lower.includes('não classificad')) {
        return '❓ DESCONHECIDO — REVISAR';
    }
    if (upper === 'RED' || lower.includes('grande perigo') || lower.includes('máximo') || lower.includes('extremo') || lower.includes('red') || lower.includes('high')) {
        return '🔴 GRANDE PERIGO (CRÍTICO)';
    }
    if (upper === 'YELLOW' || lower.includes('potencial') || lower.includes('amarelo') || lower.includes('yellow') || lower.includes('atenção') || lower.includes('low')) {
        return '🟡 PERIGO POTENCIAL (MODERADO)';
    }
    if (upper === 'ORANGE' || lower.includes('perigo') || lower.includes('laranja') || lower.includes('orange') || lower.includes('alerta') || lower.includes('moderate')) {
        return '🟠 PERIGO (SEVERO)';
    }
    return '🟢 NORMAL / MONITORAMENTO';
}
/**
 * Invite-code prompt shown to non-admin users.
 * Also serves as friendly hello for regular users — includes last-scan hint.
 *
 * @returns {string}
 */
export function buildInviteRequiredMessage() {
    return buildRegularWelcomeMessage();
}

/**
 * Builds friendly hello for regular (non-admin) users with last-scan hint.
 * Keeps "restrito ao administrador" phrase for backward compat with existing tests
 * and clear permission messaging.
 *
 * @returns {string}
 */
export function buildRegularWelcomeMessage() {
    return [
        '👋 Olá! Bem-vindo ao Monitor Meteorológico — Charqueadas / RS',
        CARD_HEADER,
        'Sou o bot de monitoramento 24/7 de riscos (INMET + Defesa Civil RS).',
        'Este bot está restrito ao administrador configurado para ajustes e varreduras ao vivo,',
        'mas você pode consultar os últimos alertas já verificados sem gerar nova varredura.',
        '',
        '🔑 Para acesso completo, peça a um administrador um código de convite',
        '   em: ⚙️ Configurações → 👥 Convidar Administrador',
        '   O código tem 8 caracteres A-Z0-9 e expira em 5 minutos (uso único).',
        '   Basta colar o código aqui como mensagem (pode estar dentro de frase).',
        '',
        CARD_DIVIDER,
        '💡 Toque em “🚨 Ver Últimos Alertas” abaixo para ver o último scan.'
    ].join('\n');
}
