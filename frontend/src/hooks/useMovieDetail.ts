import { useEffect, useState } from "react";
import type { Movie } from "@/components/Window.MovieDetail";

const CHATBOT_API_BASE_URL = "http://localhost:3000/api";

export function usemovieDetail() {
    const [movieDetail_id, movieDetail_setId] = useState<string | null>(null);
    const [movieDetail_isOpen, movieDetail_setIsOpen] = useState(false);
    const [movieDetail_isSaved, movieDetail_setIsSaved] = useState(false);
    const [movieDetail_movie, setMovie] = useState<Movie | null>(null);
    const [movieDetail_loading, setLoading] = useState(false);
    const [movieDetail_error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!movieDetail_id) return;

        setLoading(true);
        setError(null);

        fetch(`${CHATBOT_API_BASE_URL}/fetch/movie/${encodeURIComponent(movieDetail_id)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
            .then((d) =>
                setMovie({
                    id: String(d.id),
                    title: d.title,
                    year: d.release_date?.slice(0, 4),
                    description: d.overview,
                    posterUrl: d.poster_path
                        ? `https://image.tmdb.org/t/p/w500${d.poster_path}`
                        : undefined,
                })
            )
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    }, [movieDetail_id]);

    const movieDetail_open = (newId?: string) => {
        if (newId) movieDetail_setId(newId);
        movieDetail_setIsOpen(true);
    };
    const movieDetail_close = () => movieDetail_setIsOpen(false);
    const movieDetail_toggle = () => movieDetail_setIsOpen((v) => !v);

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
    };
}
