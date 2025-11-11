import React, { useState, useEffect } from "react";
import { MovieCard } from "@/components/MovieCard.component";
import { chatService } from "@/services/chat.service";
import { getCollection } from "@/services/collection.service";
import type { Movie } from "@/types/movie.type";

interface Section {
  title: string;
  movies: { id: number; title: string; poster: string; rating: number }[];
}

const sections: Section[] = [];

const Ranking: React.FC = () => {
  const [dynamicSections, setDynamicSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchMoviesForRanking = async () => {
      setLoading(true);
      console.log("Fetching movies for ranking...");

      try {
        const collection = await getCollection();
        const genreCount: Record<string, number> = {};

        // Count occurrences of each genre in the user's collection
        collection.forEach((movie: Movie) => {
          if (movie.genre) {
            movie.genre.forEach((genre: string) => {
              genreCount[genre] = (genreCount[genre] || 0) + 1;
            });
          }
        });

        // Get the top 3 most frequent genres
        const topGenres = Object.entries(genreCount)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([genre]) => genre);

        console.log("Top genres:", topGenres);

        const sections: Section[] = await Promise.all(
          topGenres.map(async (genre) => {
            console.log(`Fetching movies for genre: ${genre}`);
            const movies = await chatService.fetchMoviesByGenre(genre);

            // Sort movies by rating and take the top 10
            const topMovies = movies
              .filter((movie) => typeof movie.rating === "number") // Ensure rating is a number
              .sort((a, b) => b.rating! - a.rating!)
              .slice(0, 10)
              .map((movie) => ({
                id: movie.id,
                title: movie.title,
                poster: movie.poster || "", // Ensure poster is a string
                rating: movie.rating!,
              }));

            console.log(`Fetched ${topMovies.length} movies for genre: ${genre}`);
            return {
              title: genre,
              movies: topMovies,
            };
          })
        );

        setDynamicSections(sections);
      } catch (error) {
        console.error("Failed to fetch movies for ranking:", error);
      } finally {
        setLoading(false);
        console.log("Finished fetching movies for ranking.");
      }
    };

    fetchMoviesForRanking();
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="max-w-7xl mx-auto p-8 w-full">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">Bảng xếp hạng</h2>

        {loading ? (
          <div className="text-center py-12">Đang tải...</div>
        ) : (
          sections.concat(dynamicSections).map((section, index) => (
            <div key={index} className="mb-8">
              <h3 className="text-xl font-semibold mb-4">{section.title}</h3>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {section.movies.map((movie) => (
                  <MovieCard key={movie.id} movie={movie} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Ranking;