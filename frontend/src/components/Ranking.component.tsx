import React, { useState, useEffect } from "react";
import { MovieCard } from "@/components/MovieCard.component";
import { getCollection } from "@/services/collection.service";
import { getMovieRating } from "@/services/collection.service";
import type { Movie } from "@/types/movie.type";

interface Section {
  title: string;
  movies: { id: number; title: string; poster: string; rating: number }[];
}

const sections: Section[] = [];

const Ranking: React.FC = () => {
  const [dynamicSections, setDynamicSections] = useState<Section[]>([]);

  useEffect(() => {
    const fetchMoviesByGenre = async () => {
      const movies = await getCollection();
      const genreMap: Record<string, Movie[]> = {};

      // Group movies by genre
      movies.forEach((movie: Movie) => {
        if (movie.genre) {
          movie.genre.forEach((genre: string) => {
            if (!genreMap[genre]) {
              genreMap[genre] = [];
            }
            genreMap[genre].push(movie);
          });
        }
      });

      const sections: Section[] = await Promise.all(
        Object.entries(genreMap).map(async ([genre, movies]) => {
          // Fetch ratings for each movie
          const moviesWithRatings = await Promise.all(
            movies.map(async (movie) => {
              const rating = await getMovieRating(movie.id);
              return {
                id: movie.id,
                title: movie.title,
                poster: movie.poster || "", // Ensure poster is a string
                rating: rating?.rating || 0,
              };
            })
          );

          // Sort movies by rating and take the top 10
          const topMovies = moviesWithRatings
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 10);

          return {
            title: genre,
            movies: topMovies,
          };
        })
      );

      setDynamicSections(sections);
    };

    fetchMoviesByGenre();
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="max-w-7xl mx-auto p-8 w-full">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">Bảng xếp hạng</h2>
        {sections.concat(dynamicSections).map((section, index) => (
          <div key={index} className="mb-8">
            <h3 className="text-xl font-semibold mb-4">{section.title}</h3>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {section.movies.map((movie) => (
                <MovieCard key={movie.id} movie={movie} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Ranking;