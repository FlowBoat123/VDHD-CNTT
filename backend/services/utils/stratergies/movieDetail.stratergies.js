import { tmdbService } from "../../tmdb.service.js";

export async function getMovieDetail(id) {
    const movie = await tmdbService.getMovieDetails(id);

    return movie;
}