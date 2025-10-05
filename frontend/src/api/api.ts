// api.ts
import axios from "axios";
import { getFreshToken } from "@/contexts/AuthContext";

const api = axios.create();

// Request interceptor → attach token if available
api.interceptors.request.use(async (config) => {
  const token = await getFreshToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    console.log("Guest request (no token attached)");
  }
  return config;
});

// Response interceptor → handle errors globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn(
        "Unauthorized — maybe user is not logged in or token invalid"
      );
      // Optionally: redirect to login or trigger logout
    }
    return Promise.reject(error);
  }
);

export default api;
