import translate from "@vitalets/google-translate-api";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const MOVIES_PER_REQUEST = 8;

export class TMDbService {
  constructor() {
    this.genreCache = null;
    this.genreMap = {};
    this.translateCache = new Map(); // cache translations by key `${text}::${targetLang}`
    this.translateCooldownUntil = 0; // timestamp to avoid repeated 429 attempts
  }

  // Generic fetch wrapper for TMDb
  async fetchFromTMDb(endpoint, opts = {}) {
    const hasLang = Object.prototype.hasOwnProperty.call(opts, "language");
    const lang = opts.language;

    const url =
      `${TMDB_BASE_URL}${endpoint}` +
      `${endpoint.includes("?") ? "&" : "?"}api_key=${TMDB_API_KEY}` +
      (hasLang ? (lang ? `&language=${lang}` : "") : "&language=null");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDb API error: ${res.status}`);
    return res.json();
  }

  // Translate helper using google-translate-api
  async translateText(text, targetLang = "vi") {
    if (!text) return "";

    const key = `${text}::${targetLang}`;
    if (this.translateCache.has(key)) return this.translateCache.get(key);

    const now = Date.now();
    if (this.translateCooldownUntil && now < this.translateCooldownUntil) {
      // We're in cooldown due to previous rate-limit — skip trying to translate
      return text;
    }

    try {
      const result = await translate(text, { to: targetLang });
      const out = result && result.text ? result.text : text;
      try {
        this.translateCache.set(key, out);
      } catch (e) {
        // ignore cache set failures
      }
      return out;
    } catch (err) {
      // If rate-limited, set a short cooldown to avoid spamming the translate service
      try {
        const status = err && err.message ? err.message : String(err);
        if (typeof status === 'string' && status.includes('429')) {
          // 60s cooldown
          this.translateCooldownUntil = Date.now() + 60 * 1000;
          console.warn('Translate rate-limited, entering cooldown for 60s');
        }
      } catch (e) {
        // ignore
      }
      console.warn("Translate failed, fallback to original:", err && err.message ? err.message : err);
      return text;
    }
  }

  // ---------------------------------------------------------------------
  // Movie lists
  // ---------------------------------------------------------------------

  async getTrendingMovies(timeWindow = "week") {
    const data = await this.fetchFromTMDb(`/trending/movie/${timeWindow}`);
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  async searchMovies(query) {
    const data = await this.fetchFromTMDb(
      `/search/movie?query=${encodeURIComponent(query)}`
    );
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  async getPopularMovies() {
    const data = await this.fetchFromTMDb("/movie/popular");
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  async getTopRatedMovies() {
    const data = await this.fetchFromTMDb("/movie/top_rated");
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  async getSimilarMovies(movieId) {
    const data = await this.fetchFromTMDb(`/movie/${movieId}/similar`);
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // Movie detail with automatic fallback and translation
  async getMovieDetails(movieId, opts = {}) {
    const { skipTranslate = false } = opts;
    const vi = await this.fetchFromTMDb(
      `/movie/${movieId}?append_to_response=credits,external_ids`,
      { language: "vi-VN" }
    );

    const needFallback =
      !vi.overview ||
      !vi.title ||
      (vi.overview && vi.overview.trim().length < 10);

    if (!needFallback) return vi;

    const en = await this.fetchFromTMDb(
      `/movie/${movieId}?append_to_response=credits,external_ids`,
      { language: "en-US" }
    );

    if (skipTranslate) {
      return {
        ...vi,
        overview: vi.overview || en.overview,
        title: vi.title || en.title,
      };
    }

    return {
      ...vi,
      overview: await this.translateText(vi.overview || en.overview),
      title: vi.title || en.title,
    };
  }

  // ---------------------------------------------------------------------
  // Discover
  // ---------------------------------------------------------------------

  async discoverMoviesByGenre(genreId, maxResults = MOVIES_PER_REQUEST) {
    // TMDb returns paginated results (20 per page). We'll fetch multiple pages until we
    // accumulate up to maxResults or run out of pages. This helps build a larger pool for genre searches.
    const collected = [];
    let page = 1;
    const perPage = 20; // TMDb default page size
    const maxPages = Math.ceil(maxResults / perPage) + 1; // small safety headroom

    while (collected.length < maxResults && page <= maxPages) {
      try {
        const data = await this.fetchFromTMDb(`/discover/movie?with_genres=${genreId}&sort_by=popularity.desc&page=${page}`);
        const results = Array.isArray(data && data.results) ? data.results : [];
        for (const r of results) {
          if (!r) continue;
          collected.push(r);
          if (collected.length >= maxResults) break;
        }
        // stop if there are no more results
        if (!data || !data.total_pages || page >= data.total_pages) break;
        page += 1;
      } catch (e) {
        console.warn('discoverMoviesByGenre page fetch failed', e && e.message ? e.message : e);
        break;
      }
    }

    return collected.slice(0, maxResults);
  }

  async discoverMoviesByYear(releaseYear, range, opts = {}) {
    const { page = 1, maxResults = MOVIES_PER_REQUEST, personId, genreId } =
      opts;
    const parts = [];

    if (personId) parts.push(`with_people=${personId}`);
    if (genreId) parts.push(`with_genres=${genreId}`);

    if (releaseYear) {
      parts.push(`primary_release_year=${releaseYear}`);
    } else {
      parts.push(`primary_release_date.gte=${range[0]}-01-01`);
      parts.push(`primary_release_date.lte=${range[1]}-12-31`);
    }

    parts.push("sort_by=popularity.desc");
    parts.push(`page=${page}`);

    const data = await this.fetchFromTMDb(`/discover/movie?${parts.join("&")}`);
    return data.results.slice(0, maxResults);
  }

  async discoverMoviesByRating(value, comparator = "gte", opts = {}) {
    if (value == null) return [];

    const parts = [];
    const eps = 0.01;

    let gte = null,
      lte = null;
    if (comparator === "gte") gte = value;
    else if (comparator === "gt") gte = value + eps;
    else if (comparator === "lte") lte = value;
    else if (comparator === "lt") lte = value - eps;
    else if (comparator === "eq") {
      gte = value - eps;
      lte = value + eps;
    } else gte = value;

    if (opts.genreId) parts.push(`with_genres=${opts.genreId}`);
    if (opts.personId) parts.push(`with_people=${opts.personId}`);
    if (gte != null) parts.push(`vote_average.gte=${gte}`);
    if (lte != null) parts.push(`vote_average.lte=${lte}`);

    if (opts.releaseYear) {
      parts.push(`primary_release_year=${opts.releaseYear}`);
    } else if (opts.releaseYearRange) {
      parts.push(`primary_release_date.gte=${opts.releaseYearRange[0]}-01-01`);
      parts.push(`primary_release_date.lte=${opts.releaseYearRange[1]}-12-31`);
    }

    parts.push("sort_by=popularity.desc");
    parts.push(`page=${opts.page || 1}`);

    const data = await this.fetchFromTMDb(`/discover/movie?${parts.join("&")}`);
    return data.results.slice(0, opts.maxResults || MOVIES_PER_REQUEST);
  }

  // ---------------------------------------------------------------------
  // Genres
  // ---------------------------------------------------------------------

  async getGenres() {
    if (this.genreCache) return this.genreCache;

    // Try to fetch genres in Vietnamese first, then English; merge by id and prefer Vietnamese name when available.
    let viGenres = [];
    let enGenres = [];
    try {
      const viData = await this.fetchFromTMDb("/genre/movie/list", { language: "vi-VN" });
      viGenres = Array.isArray(viData && viData.genres) ? viData.genres : [];
    } catch (e) {
      console.warn("getGenres: failed to fetch Vietnamese genres, will try English fallback", e && e.message ? e.message : e);
      viGenres = [];
    }

    try {
      const enData = await this.fetchFromTMDb("/genre/movie/list", { language: "en-US" });
      enGenres = Array.isArray(enData && enData.genres) ? enData.genres : [];
    } catch (e) {
      console.warn("getGenres: failed to fetch English genres", e && e.message ? e.message : e);
      enGenres = [];
    }

    // Build a map by id preferring Vietnamese name when present
    const merged = new Map();
    for (const g of enGenres) {
      if (!g || typeof g.id === 'undefined') continue;
      merged.set(g.id, { id: g.id, name: g.name });
    }
    for (const g of viGenres) {
      if (!g || typeof g.id === 'undefined') continue;
      const existing = merged.get(g.id) || {};
      merged.set(g.id, { id: g.id, name: g.name || existing.name });
    }

    const genres = Array.from(merged.values());
    this.genreCache = genres;
    this.genreMap = Object.fromEntries(genres.map((g) => [g.id, g.name]));
    return this.genreCache;
  }

  async getGenreName(id) {
    if (!this.genreCache) await this.getGenres();
    return this.genreMap[id] || "Không xác định";
  }

  // ---------------------------------------------------------------------
  // Person API
  // ---------------------------------------------------------------------

  async searchPerson(name, opts = {}) {
    const data = await this.fetchFromTMDb(
      `/search/person?query=${encodeURIComponent(name)}&page=1`
    );
    return (data.results || []).slice(0, opts.maxResults || MOVIES_PER_REQUEST);
  }

  async findPersonByName(name) {
    if (name == null) return null;

    const qstr = Array.isArray(name)
      ? name
        .map((x) =>
          x && typeof x === "object" ? x.name || String(x) : String(x)
        )
        .join(" ")
        .trim()
      : typeof name === "object"
        ? name.name || String(name)
        : String(name);

    if (!qstr) return null;

    const raw = await this.fetchFromTMDb(
      `/search/person?query=${encodeURIComponent(
        qstr
      )}&include_adult=false&page=1`
    );
    const results = raw && Array.isArray(raw.results) ? raw.results : [];
    if (!results.length) return null;

    const normalize = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    const qnorm = normalize(qstr);

    let best = results.find(
      (p) => p && p.name && normalize(p.name) === qnorm
    );
    if (best) return best;

    best = results.find(
      (p) => p && p.name && normalize(p.name).includes(qnorm)
    );
    if (best) return best;

    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return results[0];
  }

  async getPersonMovieCredits(personId) {
    const data = await this.fetchFromTMDb(`/person/${personId}/movie_credits`);
    return {
      cast: data.cast || [],
      crew: data.crew || []
    };
  }

  // Person detail with fallback + translation
  async getPersonDetails(personId) {
    const vi = await this.fetchFromTMDb(
      `/person/${personId}?append_to_response=movie_credits,external_ids`,
      { language: "vi-VN" }
    );

    const needFallback =
      !vi.biography || vi.biography.trim().length < 10;

    if (!needFallback) return vi;

    const en = await this.fetchFromTMDb(
      `/person/${personId}?append_to_response=movie_credits,external_ids`,
      { language: "en-US" }
    );

    return {
      ...vi,
      biography: await this.translateText(vi.biography || en.biography),
      name: vi.name || en.name
    };
  }

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------

  getImageUrl(path, size = "w500") {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }
}

export const tmdbService = new TMDbService();
export default tmdbService;
