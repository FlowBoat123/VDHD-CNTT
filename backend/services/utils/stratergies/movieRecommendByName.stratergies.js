// frontend handler (Node.js) - robust extraction & debugging
import axios from "axios";
import { tmdbService } from "../../tmdb.service.js";

/**
 * Handles movie recommendation by name (calls Flask backend)
 * Robust: tries multiple places to extract movie name; logs full request for debugging.
 */
export async function handleMovieRecommendByName(request) {
  // Full debug dump (remove or tone down in production)
  console.log("===== handleMovieRecommendByName called =====");
  try {
    console.log("Full incoming request (truncated):", JSON.stringify(request, replaceCircular, 2));
  } catch (e) {
    console.log("Full incoming request (non-serializable) — logging keys:", Object.keys(request || {}));
  }

  // helper to avoid JSON.stringify circular errors
  function replaceCircular(key, value) {
    if (key === "dfResponse" || key === "rawRequest") return "[omitted for brevity]";
    return value;
  }

  const params = (request && (request.parameters || (request.dfResponse && request.dfResponse.queryResult && request.dfResponse.queryResult.parameters))) || {};
  // Try a bunch of possible places for the movie title
  const candidates = [
    params.movie_name,
    params.title,
    params.movie,         // alternative name
    params.query,
    (request.dfResponse && request.dfResponse.queryResult && request.dfResponse.queryResult.queryText),
    (request.dfResponse && request.dfResponse.queryResult && request.dfResponse.queryResult.intent && request.dfResponse.queryResult.intent.displayName),
    request.queryText,
    request.text,
  ];

  // Normalize first non-empty candidate
  const title = (candidates.find(c => typeof c === "string" && c.trim().length > 0) || "").trim();

  // n: desired number of recs (safety limits)
  let n = 8;
  if (!Number.isFinite(n) || n <= 0) n = 5;
  const MAX_N = 10; // safety cap to avoid huge payloads — change as needed
  if (n > MAX_N) {
    console.warn(`Requested n=${n} exceeds cap ${MAX_N}. Will return ${MAX_N} and you may implement pagination.`);
    n = MAX_N;
  }

  console.log("Debug Info:");
  console.log("  Extracted title:", title || null);
  console.log("  Raw parameters:", params);
  console.log("  Requested n:", n);

  if (!title) {
    // helpful response to user / dialogflow
    return {
      fulfillmentMessages: [
        { text: { text: ["❗ Vui lòng cung cấp tên phim bạn muốn tìm đề xuất. Ví dụ: 'Toy Story'"] } }
      ],
      // include debug for dev mode
      debug: { note: "movie_name not found in request. Check parameter name in Intent or contexts." }
    };
  }

  // proceed to call backend
  try {
    const resp = await axios.post(
      "http://localhost:5000/recommend_by_name",
      { movie_name: String(title), n },
      { timeout: 15000 }
    );

    const data = resp && resp.data ? resp.data : null;
    console.log("Recommendation backend response:", data && (Array.isArray(data.results) ? `results=${data.results.length}` : data));

    if (!data || data.ok !== true) {
      const errMsg = data && data.error ? data.error : "Unknown error from recommendation service";
      console.error("Recommendation service error:", errMsg);
      return {
        fulfillmentMessages: [
          { text: { text: [`Xin lỗi, server đề xuất trả về lỗi: ${errMsg}`] } }
        ]
      };
    }

    const matched = data.matched_title || title;
    const suggestionText = `🎬 Phim bạn nhập: "${matched}". Dưới đây là một vài phim tương tự:\n\n`;

    const movieSuggestions = (data.results || []).map((m) => {
      // normalize poster
      let posterUrl = null;
      try {
        if (m.poster) {
          const p = String(m.poster);
          posterUrl = p.startsWith("/") ? (tmdbService.getImageUrl ? tmdbService.getImageUrl(p) : `https://image.tmdb.org/t/p/w500${p}`) : p;
        } else if (m.poster_path) {
          const p = String(m.poster_path);
          posterUrl = tmdbService.getImageUrl ? tmdbService.getImageUrl(p) : `https://image.tmdb.org/t/p/w500${p}`;
        }
      } catch (e) {
        console.warn("Failed to build posterUrl for", m && m.title, e);
        posterUrl = null;
      }

      return {
        id: m.id ?? null,
        title: m.title ?? null,
        poster: posterUrl,
        rating: (m.rating != null && !Number.isNaN(Number(m.rating))) ? Number(m.rating) : null,
        explanation: m.explanation ?? "",
        tmdb_id: m.tmdb_id ?? null,
        score: typeof m.score === "number" ? m.score : null
      };
    });

    return {
      fulfillmentMessages: [{ text: { text: [suggestionText] } }, { movieSuggestions }]
    };

  } catch (err) {
    console.error("Error calling recommendation backend:", err && err.message ? err.message : err);
    return {
      fulfillmentMessages: [
        { text: { text: ["Xin lỗi, không thể kết nối tới dịch vụ đề xuất phim ngay bây giờ. Vui lòng thử lại sau."] } }
      ]
    };
  }
}
