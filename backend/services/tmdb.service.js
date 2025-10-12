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
    const url = `${TMDB_BASE_URL}${endpoint}${
      endpoint.includes("?") ? "&" : "?"
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
}

export const tmdbService = new TMDbService();
