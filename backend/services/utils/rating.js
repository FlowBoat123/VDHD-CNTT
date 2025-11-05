// Lightweight rating parsing helper
// Tries to extract a numeric rating and a comparator from Dialogflow-like params
export function parseRatingFilter(params) {
    if (!params || typeof params !== 'object') return null;

    // common parameter names
    let rawRating = params.rating ?? params.point ?? params.vote ?? null;
    let rawComparator = params.rating_comparator ?? params.ratingComparator ?? params.rating_op ?? params.rating_operator ?? params.comparator ?? null;

    // accept array-shaped params (Dialogflow sometimes returns arrays)
    if (Array.isArray(rawRating)) rawRating = rawRating.flat(Infinity)[0];
    if (Array.isArray(rawComparator)) rawComparator = rawComparator.flat(Infinity)[0];

    // sometimes rating may come as object { amount: 7, comparator: 'gte' }
    if (rawRating && typeof rawRating === 'object') {
        if (typeof rawRating.amount === 'number') rawRating = rawRating.amount;
        else if (typeof rawRating.value === 'number') rawRating = rawRating.value;
        else if (typeof rawRating.number === 'number') rawRating = rawRating.number;
        else if (typeof rawRating.text === 'string') rawRating = rawRating.text;
    }

    // comparator may come embedded inside rating string like '>=7' or '> 7'
    if ((typeof rawRating === 'string') && /[<>]=?\s*\d/.test(rawRating)) {
        const m = rawRating.match(/([<>]=?)\s*(\d+(?:\.\d+)?)/);
        if (m) {
            rawComparator = rawComparator || m[1];
            rawRating = m[2];
        }
    }

    // coerce rating to number when possible
    let value = null;
    if (rawRating != null && rawRating !== '') {
        if (typeof rawRating === 'number') value = rawRating;
        else if (typeof rawRating === 'string') {
            const n = Number(rawRating.replace(/[^0-9\.\-]/g, ''));
            if (!Number.isNaN(n)) value = n;
        }
    }

    if (value == null) return null;

    // normalize comparator
    const normalize = (c) => {
        if (!c && c !== 0) return 'eq';
        if (typeof c === 'string') {
            const s = c.trim().toLowerCase();
            if (s === '>=' || s === 'gte' || s === 'greater_or_equal' || s.includes('at least') || s.includes('ít nhất')) return 'gte';
            if (s === '>' || s === 'gt' || s.includes('greater') || s.includes('lớn hơn')) return 'gt';
            if (s === '<=' || s === 'lte' || s.includes('no more than') || s.includes('không quá')) return 'lte';
            if (s === '<' || s === 'lt' || s.includes('less') || s.includes('nhỏ hơn')) return 'lt';
            if (s === '=' || s === 'eq' || s === 'equal' || s.includes('bằng')) return 'eq';
            // try symbolic prefixes
            if (s.startsWith('>=')) return 'gte';
            if (s.startsWith('>')) return 'gt';
            if (s.startsWith('<=')) return 'lte';
            if (s.startsWith('<')) return 'lt';
        }
        return 'eq';
    };

    const comparator = normalize(rawComparator);

    return { value, comparator, rawComparator };
}

export default { parseRatingFilter };
