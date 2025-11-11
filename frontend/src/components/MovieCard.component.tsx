import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Star } from "lucide-react";
import type { Movie } from "@/types/movie.type";
import { useEffect, useState } from "react";
import { getMovieAverage } from "@/services/collection.service";

interface MovieCardProps {
  movie: Movie;
  onClick?: (id: number | string) => void; // allow click handler
}

export function MovieCard({ movie, onClick }: MovieCardProps) {
  const [avg, setAvg] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getMovieAverage(movie.id as string | number);
        if (!mounted) return;
        if (res && typeof res.combinedAverage === 'number') setAvg(res.combinedAverage);
        else setAvg(null);
      } catch (e) {
        setAvg(null);
      }
    })();
    return () => { mounted = false; };
  }, [movie.id]);
  return (
    <Card
      onClick={() => onClick?.(movie.id)}
      className="overflow-hidden hover:shadow-lg transition-shadow duration-200 p-0 gap-3 cursor-pointer"
    >
      <div className="relative overflow-hidden">
        {movie.poster ? (
            <img
              src={movie.poster}
              alt={movie.title}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src =
                  "/placeholder-image.jpg";
              }}
              className="w-full h-80 object-cover transition-transform duration-300 hover:scale-105"
            />
        ) : (
          <div className="w-full h-80 bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-sm">
              Không có poster
            </span>
          </div>
        )}

        {(avg !== null || movie.rating !== undefined) && (
          <div className="absolute top-2 right-2">
            <Badge
              variant="secondary"
              className="bg-black/70 text-white border-0"
            >
              <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
              {avg !== null ? avg.toFixed(1) : (typeof movie.rating === "number" ? movie.rating.toFixed(1) : "N/A")}
            </Badge>
          </div>
        )}
      </div>
      <CardContent className="p-3 pb-4">
        <h3 className="font-medium line-clamp-2 leading-tight text-center">
          {movie.title}
        </h3>
      </CardContent>
    </Card>
  );
}
