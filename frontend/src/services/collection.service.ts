import api from "@/api/api";
import type { Movie } from "@/types/movie.type";

const CHATBOT_API_BASE_URL = "http://localhost:3000/api";

export async function saveMovie(movie: Movie) {
  // expects Authorization Bearer token to be set in api client
  const res = await api.post(`${CHATBOT_API_BASE_URL}/collection`, movie);
  return res.data;
}

export async function getCollection() {
  const res = await api.get(`${CHATBOT_API_BASE_URL}/collection`);
  return res.data?.data || [];
}

export async function removeMovie(id: string | number) {
  const res = await api.delete(`${CHATBOT_API_BASE_URL}/collection/${id}`);
  return res.data;
}

export async function rateMovie(id: string | number, rating: number) {
  // send rating for a movie to backend
  const res = await api.post(`${CHATBOT_API_BASE_URL}/collection/${id}/rating`, { rating });
  return res.data;
}

export async function getMovieRating(id: string | number) {
  const res = await api.get(`${CHATBOT_API_BASE_URL}/collection/${id}/rating`);
  return res.data?.data || null;
}

export async function getRatedMovieAggregate(id: string | number) {
  const res = await api.get(`${CHATBOT_API_BASE_URL}/rated-movie/${id}`);
  return res.data?.data || null;
}

export async function getMovieAverage(id: string | number) {
  const res = await api.get(`${CHATBOT_API_BASE_URL}/movie/${id}/average`);
  return res.data?.data || null;
}
