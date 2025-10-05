import express from "express";
import cors from "cors";
import messageRoutes from "./routes/message.routes.js";
import dotenv from "dotenv";
import { tmdbService } from "./services/tmdb.service.js";

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", messageRoutes);

// const genres = await tmdbService.getGenres();
// console.log(genres); // → full genre list

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
