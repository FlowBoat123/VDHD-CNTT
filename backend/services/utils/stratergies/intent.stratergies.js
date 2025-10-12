import { handleMovieRecommendation } from "./movieRecommend.stratergies.js";

export const intentHandlers = {
  movie_recommendation_request: handleMovieRecommendation,
};
