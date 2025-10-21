import { tmdbService } from "../tmdb.service.js";

// Chuẩn hoá dữ liệu năm: lấy số nguyên từ input (VD: "2020", "năm 2019" -> 2019)
export function extractYear(input) {
    if (!input) return null;
    const match = String(input).match(/\d{4}/);
    return match ? parseInt(match[0]) : null;
}

// Chuẩn hoá comparator: chuyển về dạng toán tử thống nhất ('>', '<', '=', 'between', 'none')
export function normalizeDateComparator(input) {
    if (!input) return "none";
    const s = String(input).toLowerCase().trim();

    if (/>|cao|trên|mới|gần|ra mắt|sau/.test(s)) return ">";
    if (/</.test(s) || /cũ|lâu|trước|hoài|xưa/.test(s)) return "<";
    if (/trong|giữa|khoảng|từ.*đến/.test(s)) return "between";
    return "none";
}

/**
 * Hàm xử lý logic lọc phim theo năm
 * @param {Array} movies - danh sách phim TMDb (có release_date)
 * @param {string|object} comparator - so sánh: >, <, between, none
 * @param {number|Array} year - năm hoặc khoảng năm
 * @returns {Array} danh sách phim đã lọc
 */
export function filterMoviesByYear(movies, comparator, year) {
    if (!Array.isArray(movies) || movies.length === 0) return [];

    comparator = normalizeDateComparator(comparator);
    if (!comparator || comparator === "none" || !year) return movies;

    return movies.filter((m) => {
        const movieYear = m.release_date ? parseInt(m.release_date.slice(0, 4)) : null;
        if (!movieYear) {
            console.log(`[YearFilter] Movie '${m.title}' (id=${m.id}) excluded: missing release_date.`);
            return false;
        }

        if (Array.isArray(year) && comparator === "between") {
            const [start, end] = year.map((y) => parseInt(y));
            const match = movieYear >= start && movieYear <= end;
            if (!match) {
                console.log(`[YearFilter] Movie '${m.title}' (${movieYear}) excluded: not in range ${start}-${end}.`);
            }
            return match;
        }

        const y = parseInt(year);
        let match = false;
        switch (comparator) {
            case ">":
                match = movieYear > y;
                if (!match) console.log(`[YearFilter] Movie '${m.title}' (${movieYear}) excluded: not after ${y}.`);
                break;
            case "<":
                match = movieYear < y;
                if (!match) console.log(`[YearFilter] Movie '${m.title}' (${movieYear}) excluded: not before ${y}.`);
                break;
            default:
                match = movieYear === y;
                if (!match) console.log(`[YearFilter] Movie '${m.title}' (${movieYear}) excluded: not equal to ${y}.`);
                break;
        }
        return match;
    });
}

/**
 * Ví dụ sử dụng thực tế: 
 * nhận đầu vào từ Dialogflow rồi trả danh sách phim TMDb
 */
export async function handleDateFilter(query, dateComparator, yearValue) {
    const comparator = normalizeDateComparator(dateComparator);
    const year = Array.isArray(yearValue) ? yearValue.map(extractYear) : extractYear(yearValue);

    try {
        const movies = await tmdbService.searchMovie(query);
        const filtered = filterMoviesByYear(movies, comparator, year);
        return filtered;
    } catch (err) {
        console.error("handleDateFilter error:", err);
        return [];
    }
}

export default {
    extractYear,
    normalizeDateComparator,
    filterMoviesByYear,
    handleDateFilter,
};
