export interface Movie {
  id: number;
  title: string;
  poster?: string;
  rating?: number;
  genre?: string[]; // Added optional genre field to store movie genres
}
