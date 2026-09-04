export const BLOCKED_LINK_CODE = 'WILDBERRIES_LINK_BLOCKED';
export const BLOCKED_LINK_MESSAGE = 'Ссылка на Wildberries удалена. Укажите ссылку на другой магазин.';

export function normalizeOrderLink(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.startsWith('//')) return `https:${text}`;
    return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

// Decode a validated URL hostname label (RFC 3492), identically in Node and browsers.
function unicodeLabel(label) {
    if (!label.startsWith('xn--')) return label;
    const input = label.slice(4);
    const delimiter = input.lastIndexOf('-');
    const output = delimiter < 0 ? [] : Array.from(input.slice(0, delimiter), char => char.codePointAt(0));
    let cursor = delimiter < 0 ? 0 : delimiter + 1;
    let n = 128;
    let index = 0;
    let bias = 72;
    while (cursor < input.length) {
        const previous = index;
        let weight = 1;
        for (let k = 36; ; k += 36) {
            if (cursor >= input.length) throw new Error('Invalid IDN');
            const code = input.charCodeAt(cursor++);
            const digit = code >= 48 && code <= 57 ? code - 22 : code - 97;
            if (digit < 0 || digit >= 36) throw new Error('Invalid IDN');
            index += digit * weight;
            if (!Number.isSafeInteger(index)) throw new Error('Invalid IDN');
            const threshold = Math.max(1, Math.min(26, k - bias));
            if (digit < threshold) break;
            weight *= 36 - threshold;
        }
        const length = output.length + 1;
        let delta = Math.floor((index - previous) / (previous === 0 ? 700 : 2));
        delta += Math.floor(delta / length);
        let k = 0;
        while (delta > 455) {
            delta = Math.floor(delta / 35);
            k += 36;
        }
        bias = k + Math.floor(36 * delta / (delta + 38));
        n += Math.floor(index / length);
        index %= length;
        output.splice(index++, 0, n);
    }
    return String.fromCodePoint(...output);
}

export function isWildberriesLink(value) {
    try {
        const hostname = new URL(normalizeOrderLink(value)).hostname;
        const domain = hostname.split('.').map(unicodeLabel).join('.').toLowerCase();
        return /wildberries|вайлдбериз|вайлдберриз/.test(domain);
    } catch (_error) {
        return false; // Invalid URLs are handled by the existing URL validator.
    }
}

export function isBlockedOrderLink(value, existingLink = '') {
    const normalized = normalizeOrderLink(value);
    return isWildberriesLink(normalized) && normalized !== normalizeOrderLink(existingLink);
}
