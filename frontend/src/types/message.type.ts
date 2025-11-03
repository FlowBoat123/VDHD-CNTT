import type { Movie } from "@/types/movie.type";

export interface CardPayload {
  layout?: "image-left" | "image-top" | string;
  id?: number;
  title?: string;
  subtitle?: string;
  poster?: string;
  url?: string;
  text?: string; // human-readable fallback
  [key: string]: any;
}

export interface Message {
  id: string;
  content: string;
  sender: "user" | "assistant";
  timestamp: string;
  movieSuggestions?: Movie[];
  card?: CardPayload;
}
