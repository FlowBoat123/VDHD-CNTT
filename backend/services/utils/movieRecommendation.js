import { tmdbService } from "../../services/tmdb.service.js";
import { matchGenre } from "./genre.js";
import { getUserPreferences } from "../../services/firebase.service.js";

/**
 * Handles movie recommendation based on Dialogflow response
 * @param {object} param0
 * @returns {Promise<object>}
 */
export async function handleMovieRecommendation({ dfResponse }) {
  const userGenres =
    dfResponse?.parameters?.genre?.listValue?.values?.map((v) =>
      v.stringValue.toLowerCase()
    ) || [];

  console.log("🎬 Extracted genres:", userGenres);

  // --- Step 1: Get genre list from TMDb ---
  const tmdbGenres = await tmdbService.getGenres();

  const matchedGenres = matchGenre(userGenres, tmdbGenres);
  const matchedGenre = matchedGenres[0]; // take the first matched genre
  console.log("Matched genre:", matchedGenre);
  // --- Step 2: Discover movies by that genre ---
  const genreName = userGenres[0] || "bất kỳ";
  if (!matchedGenre) {
    dfResponse.fulfillmentText = `Xin lỗi, tôi không nhận diện được thể loại "${genreName}". Bạn có thể thử thể loại khác như hành động, hài, kinh dị, lãng mạn.`;
    return dfResponse;
  }

  const movies = await tmdbService.discoverMoviesByGenre(matchedGenre.id);

  if (!movies.length) {
    dfResponse.fulfillmentText = `Không tìm thấy phim nào thuộc thể loại ${genreName}.`;
    return dfResponse;
  }

  // --- Step 3: Build suggestion text ---
  const suggestionText =
    `🎬 Dưới đây là một vài phim ${genreName} nổi bật:\n\n` +
    movies
      .slice(0, 5)
      .map(
        (m, i) =>
          `${i + 1}. ${m.title} (${m.release_date?.slice(0, 4) || "?"}) — ⭐️ ${
            m.vote_average
          }\n`
      )
      .join("\n");

  // console.log("Movie suggestions:", suggestionText);

  // Optional: attach images
  const movieSuggestions = movies.map((m) => ({
    id: m.id,
    title: m.title,
    poster: tmdbService.getImageUrl(m.poster_path),
    rating: m.vote_average,
  }));

  dfResponse.fulfillmentText = suggestionText;
  dfResponse.fulfillmentMessages = [
    {
      text: {
        text: [suggestionText],
      },
    },
    {
      movieSuggestions,
    },
  ];

  return dfResponse;
}
