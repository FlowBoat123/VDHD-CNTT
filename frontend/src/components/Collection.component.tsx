import { MovieCard } from "@/components/MovieCard.component";
import type { Movie } from "@/types/movie.type";

interface CollectionProps {
  movies?: Movie[];
  onOpenMovie?: (id: number) => void;
}

export function Collection({ movies = [], onOpenMovie }: CollectionProps) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="max-w-5xl mx-auto p-4 w-full">
        <h2 className="text-xl font-semibold mb-4">Bộ sưu tập</h2>

        {movies.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="mb-2">Bạn chưa lưu phim nào.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
