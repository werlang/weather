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
    { command: 'inscrever', description: '📜 Autorizar o recebimento de alertas por SMS' },
    { command: 'sair', description: '🚪 Revogar a autorização de alertas por SMS' },
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

/**
 * Deep-link keyword that opens the citizen SMS subscription consent term.
 * Also reachable as the `/inscrever` slash command.
 */
export const SUBSCRIPTION_KEYWORD = 'inscrever';

/**
 * Label of the reply-keyboard button that aborts the contact-sharing step.
 * Reply keyboards deliver plain text, so the cancel action travels as a message.
 */
export const CONSENT_CANCEL_LABEL = '❌ Cancelar';

/**
 * Masks an E.164 number for official receipts, keeping only the country/DDD
 * prefix and the last four digits — the full number never goes back on screen.
 *
 * @param {string} e164 - Normalized number (`55` + DDD + digits).
 * @returns {string} Masked display form.
 */
function maskSmsNumber(e164) {
    const digits = String(e164 || '').replace(/\D/g, '');
    if (!digits) return '••••';
    const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
    return `+55 ${national.slice(0, 2)} •••••-${national.slice(-4)}`;
}

/**
 * Renders the official LGPD-consent term shown when a citizen starts the
 * subscription flow (`/inscrever` or `/start inscrever`).
 *
 * @returns {string} Consent term with the agree/refuse prompt.
 */
export function buildConsentRequestMessage() {
    return [
        '📜 TERMO DE CONSENTIMENTO — CADASTRO PARA RECEBIMENTO DE ALERTAS METEOROLÓGICOS',
        CARD_HEADER,
        'INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL — CAMPUS CHARQUEADAS',
        'Sistema de Monitoramento de Risco Meteorológico — Charqueadas / RS',
        '',
        'Declaramos estar ciente de que, ao prosseguir, você autoriza de livre e espontânea vontade o IFSUL Campus Charqueadas a tratar o seu número de telefone nos termos da Lei nº 13.709/2018 (LGPD), exclusivamente para a finalidade indicada abaixo.',
        '',
        '1. FINALIDADE — Envio de alertas, avisos e comunicados oficiais de risco meteorológico (chuvas intensas, tempestades, enchentes e condições severas) produzidos pelo monitoramento 24/7 das fontes oficiais INMET e Defesa Civil RS.',
        '2. CARÁTER OPTATIVO E GRATUITO — O cadastro é voluntário e gratuito. A recusa não gera qualquer restrição de uso deste bot.',
        '3. DADOS COLETADOS — Apenas o número de telefone que você compartilhar nesta conversa, associado ao identificador desta conversa.',
        '4. GUARDA E USO — Os dados serão armazenados em base de dados controlada pelo IFSUL Campus Charqueadas, usados somente para a finalidade do item 1, não serão compartilhados com terceiros nem utilizados para fins comerciais ou publicitários.',
        '5. REVOGAÇÃO — A autorização pode ser revogada a qualquer momento, gratuitamente e de forma simplificada, pelo comando /sair, com a exclusão imediata do número do cadastro.',
        '6. CONTROLADOR — IFSUL Campus Charqueadas — Charqueadas / RS (IBGE 4305355).',
        CARD_HEADER,
        'Deseja prosseguir com o cadastro?',
        CARD_DIVIDER,
        '✅ Concordo — registra a sua autorização e avança para o compartilhamento do número.',
        '❌ Recusar — encerra o fluxo sem coletar nenhum dado.'
    ].join('\n');
}

/**
 * Renders the acknowledgement shown in place of the term once the citizen
 * taps "Concordo", clearing the buttons before the contact step.
 *
 * @returns {string} Consent-granted acknowledgement.
 */
export function buildConsentGrantedMessage() {
    return [
        '✅ CONSENTIMENTO REGISTRADO — ETAPA 2 DE 2',
        CARD_HEADER,
        `🕓 Registrado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        'A sua autorização para receber alertas meteorológicos oficiais foi registrada nesta conversa.',
        '',
        'Compartilhe agora o número que deve receber os alertas usando o botão exibido abaixo.',
        CARD_DIVIDER,
        '⚠️ O número somente é validado e gravado no instante em que você tocar no botão de compartilhamento.'
    ].join('\n');
}

/**
 * Renders the refusal acknowledgement — no data was ever collected.
 *
 * @returns {string} Decline message.
 */
export function buildConsentDeclinedMessage() {
    return [
        '❌ CADASTRO NÃO CONCLUÍDO',
        CARD_HEADER,
        'Obrigado por avaliar o termo. NENHUM DADO FOI ARMAZENADO — nenhum número foi coletado nem gravado.',
        '',
        'A qualquer momento você pode retomar o cadastro enviando /inscrever.',
        CARD_DIVIDER,
        'Você continua livre para consultar os últimos alertas deste bot.'
    ].join('\n');
}

/**
 * Renders the cancel acknowledgement for a consent aborted between the
 * agreement and the contact share.
 *
 * @returns {string} Cancellation message.
 */
export function buildConsentCancelledMessage() {
    return [
        '❌ CADASTRO CANCELADO',
        CARD_HEADER,
        'NENHUM DADO FOI ARMAZENADO — o número não foi compartilhado nem gravado.',
        '',
        'Para retomar o cadastro, envie /inscrever novamente.'
    ].join('\n');
}

/**
 * Renders the prompt paired with the native share-contact keyboard.
 *
 * @returns {string} Contact-step instructions.
 */
export function buildContactPromptMessage() {
    return [
        '📱 COMPARTILHE O SEU NÚMERO',
        CARD_HEADER,
        'Toque no botão abaixo: o Telegram entregará o seu número ao bot, que o validará e o gravará somente nesse instante.',
        CARD_DIVIDER,
        `Para abortar sem armazenar nenhum dado, toque em ${CONSENT_CANCEL_LABEL}.`
    ].join('\n');
}

/**
 * Renders the successful-subscription receipt with the masked number.
 *
 * @param {object} [options] - Receipt data.
 * @param {string} [options.phone=''] - Stored E.164 number.
 * @param {boolean} [options.already=false] - True when the number was already enrolled.
 * @returns {string} Confirmation receipt.
 */
export function buildSubscriptionSuccessMessage({ phone = '', already = false } = {}) {
    const lines = [
        already ? '📜 INSCRIÇÃO RECONFIRMADA' : '📜 INSCRIÇÃO CONFIRMADA — AUTORIZAÇÃO REGISTRADA',
        CARD_HEADER,
        already
            ? 'ℹ️ Este número já está inscrito — nenhuma alteração foi necessária.'
            : `📱 Número autorizado: ${maskSmsNumber(phone)}`,
        `🕓 Registrado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        '',
        'Com o seu consentimento, o IFSUL Campus Charqueadas enviará para este número os alertas meteorológicos oficiais (INMET + Defesa Civil RS) detectados pelo monitoramento 24/7.',
        CARD_DIVIDER,
        '🔁 Revogue a autorização a qualquer momento enviando /sair.'
    ];
    return lines.join('\n');
}

/**
 * Renders the rejection of a contact card that is not the sender's own number.
 *
 * @returns {string} Foreign-contact rejection.
 */
export function buildForeignContactMessage() {
    return [
        '❌ CONTATO NÃO ACEITO',
        CARD_HEADER,
        'O Telegram enviou um contato de terceiros. A autorização vale apenas para o número da sua própria conta.',
        '',
        'NENHUM DADO FOI ARMAZENADO — toque novamente no botão e selecione o seu próprio número.'
    ].join('\n');
}

/**
 * Renders the rejection of a number that is not a plausible Brazilian one.
 * The consent stays active so a valid number can be shared right after.
 *
 * @returns {string} Invalid-number rejection.
 */
export function buildContactRejectedMessage() {
    return [
        '❌ NÚMERO INVÁLIDO',
        CARD_HEADER,
        'O número compartilhado não corresponde a um número brasileiro válido (DDD + 8 ou 9 dígitos).',
        '',
        'NENHUM DADO FOI ARMAZENADO — o seu consentimento continua registrado.',
        CARD_DIVIDER,
        'Reenvie o contato pelo botão abaixo.'
    ].join('\n');
}

/**
 * Renders the withdrawal receipt for `/sair`.
 *
 * @param {number} removed - How many numbers this chat had authorized.
 * @returns {string} Withdrawal message.
 */
export function buildWithdrawalMessage(removed) {
    if (!removed) {
        return [
            'ℹ️ NENHUMA INSCRIÇÃO ENCONTRADA',
            CARD_HEADER,
            'Esta conversa não possui número autorizado para receber alertas por SMS.',
            '',
            'Envie /inscrever se desejar autorizar o recebimento de alertas.'
        ].join('\n');
    }
    return [
        '🚪 INSCRIÇÃO CANCELADA — REVOGAÇÃO DE CONSENTIMENTO',
        CARD_HEADER,
        `📛 Número(s) removido(s) por esta conversa: ${removed}`,
        'A autorização para envio de alertas por SMS foi revogada com efeito imediato e o dado foi excluído do cadastro.',
        '',
        'Envie /inscrever quando quiser autorizar novamente.'
    ].join('\n');
}
