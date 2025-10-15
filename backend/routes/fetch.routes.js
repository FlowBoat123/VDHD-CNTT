import express from "express";
import { tmdbService } from "../services/tmdb.service.js";

const router = express.Router();

router.get("/fetch/movie/:id", async (req, res) => {
    try {
        const movie = await tmdbService.getMovieDetails(req.params.id);
        console.log("Fetch movie of ID = " + req.params.id);
        res.json(movie);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch movie details" });
    }
});

export default router;
