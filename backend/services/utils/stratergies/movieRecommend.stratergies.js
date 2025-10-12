import { tmdbService } from "../../tmdb.service.js";
import { matchGenre } from "../genre.js";

/**
 * Handles movie recommendation by genre
 * @param {object} request - Unified request { dfResponse, sessionId }
 * @returns {Promise<object>}
 */
export async function handleMovieRecommendation(request) {
  const params = request.parameters || {};

  const genreName = params.genre || "bất kỳ";

  console.log("🎬 User requested genre:", genreName);

  // --- Step 1: Get TMDB genres ---
  const tmdbGenres = await tmdbService.getGenres();
  const matchedGenres = matchGenre([genreName], tmdbGenres);
  const matchedGenre = matchedGenres[0];

  if (!matchedGenre) {
    return {
      fulfillmentMessages: [
        {
          text: {
            text: [
              `Xin lỗi, tôi không nhận diện được thể loại "${genreName}". Bạn có thể thử thể loại khác như hành động, hài, kinh dị, lãng mạn.`,
            ],
          },
        },
      ],
    };
  }

  // --- Step 2: Get movies by genre ---
  const movies = await tmdbService.discoverMoviesByGenre(matchedGenre.id);

  if (!movies.length) {
    return {
      sessionId,
      fulfillmentMessages: [
        {
          text: {
            text: [`Không tìm thấy phim nào thuộc thể loại ${genreName}.`],
          },
        },
      ],
    };
  }

  // --- Step 3: Build response ---
  const suggestionText = `🎬 Dưới đây là một vài phim ${genreName} nổi bật:\n\n`;

  const movieSuggestions = movies.map((m) => ({
    id: m.id,
    title: m.title,
    poster: tmdbService.getImageUrl(m.poster_path),
    rating: m.vote_average,
  }));

  return {
    fulfillmentMessages: [
      { text: { text: [suggestionText] } },
      { movieSuggestions },
    ],
  };
}
