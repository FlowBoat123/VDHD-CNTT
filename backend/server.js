import express from "express";
import cors from "cors";
import messageRoutes from "./routes/message.routes.js";
import fetchRoutes from "./routes/fetch.routes.js";
import collectionRoutes from "./routes/collection.routes.js";
import dotenv from "dotenv";
import { tmdbService } from "./services/tmdb.service.js";
import {
  seedMovieSuggestions,
  readMovieSuggestions,
} from "./services/seed.service.js";

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", messageRoutes);
app.use("/api", fetchRoutes);
app.use("/api", collectionRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
