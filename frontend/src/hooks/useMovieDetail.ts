import { useEffect, useState } from "react";
import type { Movie as MovieType } from "@/types/movie.type";
import type { Movie as DetailMovie } from "@/components/Window.MovieDetail";
import { saveMovie, removeMovie, getCollection, rateMovie } from "@/services/collection.service";
import { getMovieRating } from "@/services/collection.service";
import { getRatedMovieAggregate, getMovieAverage } from "@/services/collection.service";

const CHATBOT_API_BASE_URL = "http://localhost:3000/api";

export function usemovieDetail() {
    const [movieDetail_id, movieDetail_setId] = useState<string | null>(null);
    const [movieDetail_isOpen, movieDetail_setIsOpen] = useState(false);
    const [movieDetail_isSaved, movieDetail_setIsSaved] = useState(false);
    const [movieDetail_movie, setMovie] = useState<DetailMovie | null>(null);
    const [movieDetail_loading, setLoading] = useState(false);
    const [movieDetail_error, setError] = useState<string | null>(null);
    const [movieDetail_rating, setMovieDetailRating] = useState<number | null>(null);
    const [movieDetail_aggregate, setMovieDetailAggregate] = useState<{ avgRating: number | null; ratingCount: number } | null>(null);
    const [movieDetail_average, setMovieDetailAverage] = useState<number | null>(null);

    useEffect(() => {
        if (!movieDetail_id) return;

        setLoading(true);
        setError(null);

        fetch(`${CHATBOT_API_BASE_URL}/fetch/movie/${encodeURIComponent(movieDetail_id)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
            .then((d) => {
                console.log(`Fetch movie: ${d.id}`);
                // extract director from credits if available
                const director = Array.isArray(d?.credits?.crew)
                    ? d.credits.crew.find((c: any) => c.job === 'Director')?.name
                    : undefined;

                setMovie({
                    id: String(d.id),
                    title: d.title,
                    year: d.release_date?.slice(0, 4),
                    release_date: d.release_date,
                    production: d.production_companies.map((obj: { name: any; }) => obj.name).join(" | "),
                    description: d.overview,
                    posterUrl: d.poster_path
                        ? `https://image.tmdb.org/t/p/w500${d.poster_path}`
                        : undefined,
                    genres: Array.isArray(d.genres) ? d.genres.map((g: any) => g.name) : undefined,
                    // include TMDB vote_average as the movie's rating (for display/save)
                    rating: typeof d.vote_average === 'number' ? String(d.vote_average) : undefined,
                    director,
                });
            })
            .catch((e) => { console.error(`Failed to fetch movie ${e.id}`); setError(String(e)); })
            .finally(() => setLoading(false));
    }, [movieDetail_id]);

    // fetch rating for this movie for current user
    useEffect(() => {
        if (!movieDetail_movie?.id) {
            setMovieDetailRating(null);
            setMovieDetailAggregate(null);
            return;
        }

        let mounted = true;
        (async () => {
            try {
                const r = await getMovieRating(String(movieDetail_movie.id));
                if (!mounted) return;
                if (r && typeof r.rating === 'number') setMovieDetailRating(r.rating);
                else setMovieDetailRating(null);
            } catch (e) {
                console.error('Failed to fetch movie rating:', e);
                setMovieDetailRating(null);
            }
        })();

        // fetch global aggregate
        (async () => {
            try {
                const agg = await getRatedMovieAggregate(String(movieDetail_movie.id));
                setMovieDetailAggregate(agg ? { avgRating: agg.avgRating, ratingCount: agg.ratingCount } : null);
            } catch (e) {
                console.error('Failed to fetch rated-movie aggregate:', e);
                setMovieDetailAggregate(null);
            }
        })();

        // fetch combined TMDB + user average
        (async () => {
            try {
                const avg = await getMovieAverage(String(movieDetail_movie.id));
                setMovieDetailAverage(avg ? (typeof avg.combinedAverage === 'number' ? avg.combinedAverage : null) : null);
            } catch (e) {
                console.error('Failed to fetch movie combined average:', e);
                setMovieDetailAverage(null);
            }
        })();

        return () => { mounted = false; };
    }, [movieDetail_movie]);

    // check if current movie is saved when movie changes
    useEffect(() => {
        if (!movieDetail_movie?.id) {
            movieDetail_setIsSaved(false);
            return;
        }

        let mounted = true;
        (async () => {
            try {
                const list = await getCollection();
                if (!mounted) return;
                const found = (list as Array<MovieType>).some((m) => String(m.id) === String(movieDetail_movie.id));
                movieDetail_setIsSaved(found);
            } catch (e) {
                // ignore — treat as not saved
                movieDetail_setIsSaved(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [movieDetail_movie]);

    const movieDetail_open = (newId?: string) => {
        if (newId) movieDetail_setId(newId);
        movieDetail_setIsOpen(true);
    };
    const movieDetail_close = () => movieDetail_setIsOpen(false);
    const movieDetail_toggle = () => movieDetail_setIsOpen((v) => !v);

    const movieDetail_toggleSave = async (movieId?: string) => {
        if (!movieDetail_movie) return;
        const id = movieId ?? String(movieDetail_movie.id);
        try {
            if (movieDetail_isSaved) {
                await removeMovie(id);
                movieDetail_setIsSaved(false);
            } else {
                // save the movie object
                await saveMovie({
                    id: Number(movieDetail_movie.id),
                    title: movieDetail_movie.title,
                    poster: movieDetail_movie.posterUrl,
                    rating: movieDetail_movie.rating,
                    genre: movieDetail_movie.genres, // Save genres as "genre" field
                } as unknown as MovieType);
                movieDetail_setIsSaved(true);
            }
        } catch (e) {
            console.error("Error toggling save:", e);
        }
    };

    const movieDetail_rate = async (movieId?: string, rating?: number) => {
        if (!movieId || typeof rating !== 'number') {
            console.log('movieDetail_rate: missing movieId or rating', { movieId, rating });
            return;
        }
        try {
            console.log(`Sending rating ${rating} for movie ${movieId}`);
            const res = await rateMovie(movieId, rating);
            console.log('Rating response:', res);
            // Optimistic update so UI reflects the change immediately
            setMovieDetailRating(rating);

            // Then fetch authoritative user rating from DB and use that value
            try {
                const r = await getMovieRating(String(movieId));
                if (r && typeof r.rating === 'number') setMovieDetailRating(r.rating);
            } catch (e) {
                console.error('Failed to refresh user rating after posting:', e);
            }

            // Re-fetch aggregates and combined average so the UI updates
            try {
                const agg = await getRatedMovieAggregate(String(movieId));
                setMovieDetailAggregate(agg ? { avgRating: agg.avgRating, ratingCount: agg.ratingCount } : null);
            } catch (e) {
                console.error('Failed to refresh rated-movie aggregate after rating:', e);
            }

            try {
                const avg = await getMovieAverage(String(movieId));
                setMovieDetailAverage(avg ? (typeof avg.combinedAverage === 'number' ? avg.combinedAverage : null) : null);
            } catch (e) {
                console.error('Failed to refresh combined average after rating:', e);
            }
        } catch (e) {
            console.error('Failed to send rating:', e);
        }
    };

    return {
        movieDetail_id,
        movieDetail_setId,
        movieDetail_isOpen,
        movieDetail_isSaved,
        movieDetail_setIsSaved,
        movieDetail_open,
        movieDetail_close,
        movieDetail_toggle,
        movieDetail_movie,
        movieDetail_loading,
        movieDetail_error,
        movieDetail_toggleSave,
        movieDetail_rate,
        movieDetail_rating,
        movieDetail_aggregate,
        movieDetail_average,
    };
}
