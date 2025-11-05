import { handleMovieRecommendation } from "./movieRecommend.stratergies.js";
import { handleMovieRecommendByName } from "./movieRecommendByName.stratergies.js";
import { handleRecommendPersonalization } from "./recommendPersonalization.stratergies.js";
import { handleInformationRequest } from "./informationRequest.statergies.js";

export const intentHandlers = {
  movie_recommendation_request: handleMovieRecommendation,
  recommend_movie_by_name: handleMovieRecommendByName,
  recommend_personalization: handleRecommendPersonalization,
  information_request: handleInformationRequest,
};
