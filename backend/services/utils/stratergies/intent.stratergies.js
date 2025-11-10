import { handleMovieRecommendation } from "./movieRecommend.stratergies.js";
import { handleMovieRecommendByName } from "./movieRecommendByName.stratergies.js";
import { handleRecommendPersonalization } from "./recommendPersonalization.stratergies.js";
import { handleFallbackIntent } from "./fallbackIntent.stratergies.js";

export const intentHandlers = {
  movie_recommendation_request: handleMovieRecommendation,
  recommend_movie_by_name: handleMovieRecommendByName,
  recommend_personalization: handleRecommendPersonalization,
  default_fallback: handleFallbackIntent,
};
