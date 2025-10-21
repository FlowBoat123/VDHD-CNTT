const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const MOVIES_PER_REQUEST = 8;

export class TMDbService {
  constructor() {
    this.genreCache = null; // 🧠 Cache genre list in memory
    this.genreMap = {}; // Optional: id → name map
  }

  // 🧩 Generic fetcher with automatic API key + language
  async fetchFromTMDb(endpoint) {
    const url = `${TMDB_BASE_URL}${endpoint}${endpoint.includes("?") ? "&" : "?"
      }api_key=${TMDB_API_KEY}&language=vi-VN`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`TMDb API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("TMDb API Error:", error);
      throw error;
    }
  }

  // 🔥 Get trending movies
  async getTrendingMovies(timeWindow = "week") {
    const data = await this.fetchFromTMDb(`/trending/movie/${timeWindow}`);
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🔍 Search movies
  async searchMovies(query) {
    const data = await this.fetchFromTMDb(
      `/search/movie?query=${encodeURIComponent(query)}`
    );
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🎬 Get popular movies
  async getPopularMovies() {
    const data = await this.fetchFromTMDb("/movie/popular");
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🌟 Get top-rated movies
  async getTopRatedMovies() {
    const data = await this.fetchFromTMDb("/movie/top_rated");
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 📖 Get details
  async getMovieDetails(movieId) {
    return await this.fetchFromTMDb(`/movie/${movieId}`);
  }

  // 🎭 Discover movies by genre
  async discoverMoviesByGenre(genreId) {
    const data = await this.fetchFromTMDb(
      `/discover/movie?with_genres=${genreId}&sort_by=popularity.desc`
    );
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🔎 Discover movies by release year or year range (standalone helper)
  // releaseYear: number (exact year)
  // releaseYearRange: [startYear, endYear]
  // options: { personId, genreId, page, maxResults }
  async discoverMoviesByYear(releaseYear, releaseYearRange, options = {}) {
    if (!releaseYear && !(Array.isArray(releaseYearRange) && releaseYearRange.length >= 2)) return [];
    const { personId, genreId, page = 1, maxResults = MOVIES_PER_REQUEST } = options;
    const parts = [];
    if (personId) parts.push(`with_people=${personId}`);
    if (genreId) parts.push(`with_genres=${genreId}`);
    if (releaseYear) {
      parts.push(`primary_release_year=${encodeURIComponent(releaseYear)}`);
    } else if (Array.isArray(releaseYearRange) && releaseYearRange.length >= 2) {
      parts.push(`primary_release_date.gte=${encodeURIComponent(`${releaseYearRange[0]}-01-01`)}`);
      parts.push(`primary_release_date.lte=${encodeURIComponent(`${releaseYearRange[1]}-12-31`)}`);
    }
    parts.push('sort_by=popularity.desc');
    parts.push(`page=${page}`);
    const data = await this.fetchFromTMDb(`/discover/movie?${parts.join('&')}`);
    const results = data && data.results ? data.results : [];
    return results.slice(0, maxResults);
  }

  // � Discover by rating (supports comparator and optional genre/person)
  // comparator: 'gte' | 'gt' | 'lte' | 'lt' | 'eq'
  async discoverMoviesByRating(value, comparator = 'gte', options = {}) {
    if (value == null) return [];
    const { genreId, personId, page = 1, maxResults = MOVIES_PER_REQUEST, releaseYear, releaseYearRange } = options;

    // Map comparator to TMDb query params. For 'gt'/'lt' use a tiny epsilon shift.
    let gte = null;
    let lte = null;
    const eps = 0.01;
    const comp = (comparator || 'gte').toString().toLowerCase();
    if (comp === 'gte') gte = value;
    else if (comp === 'gt') gte = Number((value + eps).toFixed(2));
    else if (comp === 'lte') lte = value;
    else if (comp === 'lt') lte = Number((value - eps).toFixed(2));
    else if (comp === 'eq') {
      gte = Number((value - eps).toFixed(2));
      lte = Number((value + eps).toFixed(2));
    } else gte = value;

    const parts = [];
    if (genreId) parts.push(`with_genres=${genreId}`);
    if (personId) parts.push(`with_people=${personId}`);
    if (gte != null) parts.push(`vote_average.gte=${encodeURIComponent(gte)}`);
    if (lte != null) parts.push(`vote_average.lte=${encodeURIComponent(lte)}`);
    // support release year (single year) or releaseYearRange [start, end]
    if (releaseYear) {
      // TMDb supports primary_release_year for exact year
      parts.push(`primary_release_year=${encodeURIComponent(releaseYear)}`);
    } else if (Array.isArray(releaseYearRange) && releaseYearRange.length >= 2) {
      const start = releaseYearRange[0];
      const end = releaseYearRange[1];
      // Use primary_release_date range
      parts.push(`primary_release_date.gte=${encodeURIComponent(`${start}-01-01`)}`);
      parts.push(`primary_release_date.lte=${encodeURIComponent(`${end}-12-31`)}`);
    }
    parts.push('sort_by=popularity.desc');
    parts.push(`page=${page}`);

    // console.log('Discover Movies by Rating - Endpoint Parts:', parts);

    const endpoint = `/discover/movie?${parts.join('&')}`;
    try {
      const data = await this.fetchFromTMDb(endpoint);
      const results = data && data.results ? data.results : [];
      return results.slice(0, maxResults);
    } catch (err) {
      console.warn('discoverMoviesByRating failed', err);
      return [];
    }
  }

  // �🔎 Discover movies by person (actor/crew) and genre
  // Uses the discover endpoint with with_people and with_genres
  async discoverMoviesByPersonAndGenre(personId, genreId, maxResults = MOVIES_PER_REQUEST) {
    if (!personId) return [];
    const data = await this.fetchFromTMDb(
      `/discover/movie?with_people=${personId}&with_genres=${genreId}&sort_by=popularity.desc`
    );
    const results = data && data.results ? data.results : [];
    return results.slice(0, maxResults);
  }

  // 🏷️ Dynamically fetch & cache genres
  async getGenres() {
    // If cached, reuse it
    if (this.genreCache) return this.genreCache;

    const data = await this.fetchFromTMDb("/genre/movie/list");
    this.genreCache = data.genres; // save full array
    this.genreMap = Object.fromEntries(data.genres.map((g) => [g.id, g.name])); // map id → name

    return this.genreCache;
  }

  // 🔢 Get genre name by ID (auto fetch if needed)
  async getGenreName(genreId) {
    if (!this.genreCache) await this.getGenres();
    return this.genreMap[genreId] || "Không xác định";
  }

  // 🎞️ Get similar movies
  async getSimilarMovies(movieId) {
    const data = await this.fetchFromTMDb(`/movie/${movieId}/similar`);
    return data.results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🖼️ Build full image URL
  getImageUrl(path, size = "w500") {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }

  // 🔎 Search person by name
  async searchPerson(query) {
    if (!query) return [];
    const data = await this.fetchFromTMDb(`/search/person?query=${encodeURIComponent(query)}`);
    const results = data.results || [];
    return results.slice(0, MOVIES_PER_REQUEST);
  }

  // 🎞️ Get movie credits for a person by ID
  async getPersonMovieCredits(personId) {
    if (!personId) return { cast: [], crew: [] };
    const data = await this.fetchFromTMDb(`/person/${personId}/movie_credits`);
    return { cast: data.cast || [], crew: data.crew || [] };
  }
}

export const tmdbService = new TMDbService();

// Also provide a default export for consumers that import the module as default
export default tmdbService;
