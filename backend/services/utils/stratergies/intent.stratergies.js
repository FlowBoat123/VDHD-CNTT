import { handleMovieRecommendation } from "./movieRecommend.stratergies.js";
import { handleMovieRecommendByName } from "./movieRecommendByName.stratergies.js";


export const intentHandlers = {
  movie_recommendation_request: handleMovieRecommendation,
  recommend_movie_by_name: handleMovieRecommendByName,
};
