import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Star } from "lucide-react";
import type { Movie } from "@/types/movie.type";

interface MovieCardProps {
  movie: Movie;
  onClick?: (id: number | string) => void; // allow click handler
}

export function MovieCard({ movie, onClick }: MovieCardProps) {
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
            className="w-full h-64 object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <div className="w-full h-64 bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-sm">
              Không có poster
            </span>
          </div>
        )}

        {movie.rating !== undefined && (
          <div className="absolute top-2 right-2">
            <Badge
              variant="secondary"
              className="bg-black/70 text-white border-0"
            >
              <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
              {movie.rating.toFixed(1)}
            </Badge>
          </div>
        )}
      </div>
      <CardContent className="p-2 pb-4">
        <h3 className="font-medium line-clamp-2 leading-tight text-center">
          {movie.title}
        </h3>
      </CardContent>
    </Card>
  );
}
