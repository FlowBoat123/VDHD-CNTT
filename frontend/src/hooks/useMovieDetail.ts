import { useEffect, useState } from "react";
import type { Movie as MovieType } from "@/types/movie.type";
import type { Movie as DetailMovie } from "@/components/Window.MovieDetail";
import { saveMovie, removeMovie, getCollection } from "@/services/collection.service";

const CHATBOT_API_BASE_URL = "http://localhost:3000/api";

export function usemovieDetail() {
    const [movieDetail_id, movieDetail_setId] = useState<string | null>(null);
    const [movieDetail_isOpen, movieDetail_setIsOpen] = useState(false);
    const [movieDetail_isSaved, movieDetail_setIsSaved] = useState(false);
    const [movieDetail_movie, setMovie] = useState<DetailMovie | null>(null);
    const [movieDetail_loading, setLoading] = useState(false);
    const [movieDetail_error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!movieDetail_id) return;

        setLoading(true);
        setError(null);

        fetch(`${CHATBOT_API_BASE_URL}/fetch/movie/${encodeURIComponent(movieDetail_id)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
            .then((d) => {
                console.log(`Fetch movie: ${d.id}`);
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
                });
            })
            .catch((e) => { console.error(`Failed to fetch movie ${e.id}`); setError(String(e)); })
            .finally(() => setLoading(false));
    }, [movieDetail_id]);

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
                    rating: undefined,
                } as unknown as MovieType);
                movieDetail_setIsSaved(true);
            }
        } catch (e) {
            console.error("Error toggling save:", e);
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
    };
}
