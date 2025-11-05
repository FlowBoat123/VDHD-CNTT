import { useEffect, useState } from "react";
import { MovieCard } from "@/components/MovieCard.component";
import type { Movie } from "@/types/movie.type";
import { getCollection } from "@/services/collection.service";

interface CollectionProps {
  onOpenMovie?: (id: number) => void;
}

export function Collection({ onOpenMovie }: CollectionProps) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getCollection()
      .then((list) => {
        if (!mounted) return;
        // map firestore items to Movie shape
        const mapped: Movie[] = (list || []).map((m: any) => ({
          id: Number(m.id),
          title: m.title || m.name || "Untitled",
          poster: m.poster || m.posterUrl || undefined,
          rating: m.rating !== undefined ? Number(m.rating) : undefined,
        }));
        setMovies(mapped);
      })
      .catch((e) => {
        console.error("Failed to load collection:", e);
      })
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  return (
    // make this fill available height and scroll internally
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="max-w-7xl mx-auto p-8 w-full">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">Bộ sưu tập</h2>

        {loading ? (
          <div className="text-center py-12">Đang tải...</div>
        ) : movies.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="mb-2">Bạn chưa lưu phim nào.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {movies.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                onClick={typeof onOpenMovie === "function" ? (id) => onOpenMovie(Number(id)) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Collection;
