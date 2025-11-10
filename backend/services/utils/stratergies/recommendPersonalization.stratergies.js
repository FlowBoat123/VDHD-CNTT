// Personalized recommendation handler (Node.js) - calls Flask backend
import axios from "axios";
import { tmdbService } from "../../tmdb.service.js";

/**
 * Handles personalized movie recommendations based on user's rating history
 * Calls Flask backend ALS collaborative filtering model
 */
export async function handleRecommendPersonalization(request) {
  console.log("===== handleRecommendPersonalization called =====");
  
  try {
    console.log("Full incoming request:", JSON.stringify(request, replaceCircular, 2));
  } catch (e) {
    console.log("Full incoming request (non-serializable) — logging keys:", Object.keys(request || {}));
  }

  // Helper to avoid JSON.stringify circular errors
  function replaceCircular(key, value) {
    if (key === "dfResponse" || key === "rawRequest") return "[omitted for brevity]";
    return value;
  }

  // Extract parameters from different possible locations
  const params = (request && (request.parameters || (request.dfResponse && request.dfResponse.queryResult && request.dfResponse.queryResult.parameters))) || {};
  
  // Try to get user_id/uid from multiple sources (similar to chat.service.js)
  const candidates = [
    request.uid,           // ✅ Primary source (same as chat.service.js)
    request.user_id,
    request.userId,
    request.session && request.session.uid,
    request.session && request.session.user_id,
    request.session && request.session.userId,
  ];

  const userId = (candidates.find(c => typeof c === "string" && c.trim().length > 0) || "").trim();

  // Get optional parameters
  const forceRetrain = params.force_retrain === true || params.force_retrain === "true";
  const n = parseInt(params.n || params.limit || 8, 10);

  console.log("Debug Info:");
  console.log("  Extracted userId:", userId || null);
  console.log("  Force retrain:", forceRetrain);
  console.log("  Requested n:", n);
  console.log("  Raw parameters:", params);

  if (!userId) {
    return {
      fulfillmentMessages: [
        { text: { text: ["❗ Vui lòng đăng nhập để nhận đề xuất phim cá nhân hóa."] } }
      ],
      debug: { note: "user_id not found in request. User must be authenticated." }
    };
  }

  // Call Flask backend for personalized recommendations
  try {
    console.log(`🚀 Calling Flask backend: POST /recommend_personalization with userId=${userId}`);
    
    const resp = await axios.post(
      "http://localhost:5000/recommend_personalization",
      { 
        user_id: userId,
        force_retrain: forceRetrain,
        n: n
      },
      { timeout: 90000 } // Increased timeout since resemblance model training may take time
    );

    const data = resp && resp.data ? resp.data : null;
    console.log("Personalization backend response:", data && (Array.isArray(data.results) ? `results=${data.results.length}` : data));

    if (!data || data.ok !== true) {
      const errMsg = data && data.error ? data.error : "Unknown error from personalization service";
      console.error("Personalization service error:", errMsg);
      
      // User-friendly error messages
      let userMessage = "Xin lỗi, không thể tạo đề xuất cá nhân hóa ngay bây giờ.";
      if (errMsg.includes("No ratings found")) {
        userMessage = "❗ Bạn chưa có đánh giá phim nào. Hãy xem và đánh giá một số phim trước nhé!";
      } else if (errMsg.includes("user_id is required")) {
        userMessage = "❗ Vui lòng đăng nhập để nhận đề xuất phim cá nhân hóa.";
      }
      
      return {
        fulfillmentMessages: [
          { text: { text: [userMessage] } }
        ],
        debug: { error: errMsg }
      };
    }

    const results = data.results || [];
    
    if (results.length === 0) {
      return {
        fulfillmentMessages: [
          { text: { text: ["Không tìm thấy đề xuất phù hợp. Hãy xem và đánh giá thêm một số phim nhé! 🎬"] } }
        ]
      };
    }

    const suggestionText = `🎯 Đây là ${results.length} bộ phim được đề xuất dành riêng cho bạn:\n\n`;

    // Format movie suggestions with TMDB poster URLs
    const movieSuggestions = results.map((m) => {
      // Normalize poster URL
      let posterUrl = null;
      try {
        if (m.poster) {
          const p = String(m.poster);
          posterUrl = p.startsWith("/") 
            ? (tmdbService.getImageUrl ? tmdbService.getImageUrl(p) : `https://image.tmdb.org/t/p/w500${p}`) 
            : p;
        } else if (m.poster_path) {
          const p = String(m.poster_path);
          posterUrl = tmdbService.getImageUrl ? tmdbService.getImageUrl(p) : `https://image.tmdb.org/t/p/w500${p}`;
        }
      } catch (e) {
        console.warn("Failed to build posterUrl for", m && m.title, e);
        posterUrl = null;
      }

      return {
        id: m.tmdb_id ?? null,
        title: m.title ?? null,
        poster: posterUrl,
        rating: m.rating ?? null,
        explanation: m.explanation ?? "Personalized recommendation based on your ratings",
        // tmdb_id: m.tmdb_id ?? null,
        score: m.score ?? null
      };
    });

    return {
      fulfillmentMessages: [
        { text: { text: [suggestionText] } },
        { movieSuggestions }
      ],
      debug: {
        userId: userId,
        resultsCount: results.length,
        forceRetrain: forceRetrain
      }
    };

  } catch (err) {
    console.error("Error calling personalization backend:", err && err.message ? err.message : err);
    
    // Handle specific error cases
    let errorMessage = "Xin lỗi, không thể kết nối tới dịch vụ đề xuất phim ngay bây giờ. Vui lòng thử lại sau.";
    
    if (err.code === 'ECONNREFUSED') {
      errorMessage = "⚠️ Không thể kết nối tới server đề xuất. Vui lòng kiểm tra xem Flask server có đang chạy không.";
    } else if (err.code === 'ETIMEDOUT') {
      errorMessage = "⏱️ Quá trình tạo đề xuất mất quá nhiều thời gian. Vui lòng thử lại sau.";
    }
    
    return {
      fulfillmentMessages: [
        { text: { text: [errorMessage] } }
      ],
      debug: { 
        error: err.message,
        code: err.code,
        stack: err.stack
      }
    };
  }
}
