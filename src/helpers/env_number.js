/**
 * Numeric environment variable parsing shared by the INMET client and the
 * monitoring cycle.
 *
 * `Number('')` is `0` and `Number('95%')` is `NaN`, so reading `process.env`
 * straight into a comparison silently disables whichever gate the value
 * controls. Every numeric knob must fall back to its default when the input is
 * absent, blank, non-finite, or outside the accepted range.
 *
 * @module envNumber
 */

/**
 * Reads a bounded numeric environment value.
 *
 * @param {string|undefined|null} raw - Raw environment value.
 * @param {number} fallback - Value used when the input is unusable.
 * @param {{ min?: number, max?: number, integer?: boolean }} [limits] - Accepted range.
 * @returns {number} A usable number inside the range.
 */
export function readBoundedNumber(raw, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
    if (raw === undefined || raw === null) return fallback;
    const trimmed = String(raw).trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return fallback;
    const value = integer ? Math.trunc(parsed) : parsed;
    return value < min || value > max ? fallback : value;
}
