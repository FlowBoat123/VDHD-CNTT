import { tmdbService } from "../tmdb.service.js";

/**
 * Lightweight person utilities.
 * Assumes adapter already coerces Dialogflow parameter shapes to plain strings/numbers/arrays.
 */
export const normalizePerson = (name) => {
    if (typeof name !== "string") return "";
    return name
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/^phim\s+/i, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim();
};

export const coerceToName = (item) => {
    if (item == null) return null;
    if (typeof item === "string") return item.trim();
    if (typeof item === "number") return String(item);
    if (typeof item === "object") {
        return (
            (typeof item.name === "string" && item.name.trim()) ||
            (typeof item.value === "string" && item.value.trim()) ||
            (typeof item.text === "string" && item.text.trim()) ||
            null
        );
    }
    return null;
};

export const normalizePersons = (input) => {
    if (input == null) return [];
    const arr = Array.isArray(input) ? input.flat(Infinity) : [input];
    return arr.map(coerceToName).filter((s) => typeof s === "string" && s.length).map(normalizePerson);
};

export const findPerson = async (input) => {
    const names = normalizePersons(input);
    if (!names.length) return null;
    const q = names[0];
    try {
        const raw = await tmdbService.searchPerson(q);
        let results = [];
        if (Array.isArray(raw)) results = raw;
        else if (raw && Array.isArray(raw.results)) results = raw.results;
        else if (raw && raw.data && Array.isArray(raw.data.results)) results = raw.data.results;

        if (!results.length) return null;

        try {
            results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        } catch (e) {
            // ignore sort errors
        }
        return results[0] || null;
    } catch (err) {
        // keep function quiet; callers handle nulls
        return null;
    }
};

export const resolvePersons = async (inputs) => {
    const arr = Array.isArray(inputs) ? inputs.flat(Infinity) : [inputs];
    return Promise.all(arr.map((it) => findPerson(it).catch(() => null)));
};

export default { normalizePerson, normalizePersons, coerceToName, findPerson, resolvePersons };
