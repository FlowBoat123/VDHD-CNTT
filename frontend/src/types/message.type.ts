import type { Movie } from "@/types/movie.type";

export interface Message {
  id: string;
  content: string;
  sender: "user" | "assistant";
  timestamp: string;
  movieSuggestions?: Movie[];
}
