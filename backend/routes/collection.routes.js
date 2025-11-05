import express from "express";
import {
  saveMovieToCollection,
  getUserCollection,
  removeMovieFromCollection,
} from "../services/firebase.service.js";
import { setMovieRating } from "../services/firebase.service.js";
import { getMovieRating } from "../services/firebase.service.js";
import { upsertRatedMovieUserRating, getRatedMovieDoc } from "../services/firebase.service.js";
import { getRatedMovieDoc as getRatedMovieAggregate } from "../services/firebase.service.js";
import tmdbService from "../services/tmdb.service.js";
import { authenticateOptional } from "../middleware/authenticate.js";

const router = express.Router();

// Save a movie to user's collection (requires auth)
router.post("/collection", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const movie = req.body;
    const id = await saveMovieToCollection(uid, movie);
    res.json({ id });
  } catch (err) {
    console.error("Error saving movie to collection:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get user's collection
router.get("/collection", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const list = await getUserCollection(uid);
    res.json({ data: list });
  } catch (err) {
    console.error("Error fetching collection:", err);
    res.status(500).json({ error: err.message });
  }
});

// Remove movie from collection
router.delete("/collection/:id", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const removedId = await removeMovieFromCollection(uid, id);
    res.json({ id: removedId });
  } catch (err) {
    console.error("Error removing movie from collection:", err);
    res.status(500).json({ error: err.message });
  }
});

// Set rating for a movie (requires auth)
router.post("/collection/:id/rating", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { rating, movie } = req.body || {};
    if (typeof rating !== 'number') return res.status(400).json({ error: 'rating must be a number' });

    // If rated-movie doc doesn't exist, we may want to seed baseline from TMDB
    await setMovieRating(uid, id, rating, movie);

    const existing = await getRatedMovieDoc(id);
    let tmdbRating;
    if (!existing) {
      // try to get TMDB rating via tmdbService
      try {
        const tmdb = await tmdbService.getMovieDetails(id);
        if (tmdb && typeof tmdb.vote_average === 'number') tmdbRating = Number(tmdb.vote_average);
      } catch (e) {
        // ignore TMDB failures, proceed without baseline
        console.warn('Failed to fetch TMDB baseline rating', e);
      }
    }

    const result = await upsertRatedMovieUserRating(uid, id, rating, tmdbRating);
    res.json({ data: result });
  } catch (err) {
    console.error('Error setting movie rating:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get rating for a specific movie for the current user
router.get("/collection/:id/rating", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const rating = await getMovieRating(uid, id);
    res.json({ data: rating });
  } catch (err) {
    console.error('Error getting movie rating:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

// Provide aggregate endpoint for rated-movie (avg/count)
// Accessible at GET /api/rated-movie/:id
router.get("/rated-movie/:id", authenticateOptional, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await getRatedMovieAggregate(id);
    if (!doc) return res.json({ data: null });
    // return only aggregates
    const { avgRating, ratingCount } = doc;
    res.json({ data: { avgRating: avgRating ?? null, ratingCount: ratingCount ?? 0 } });
  } catch (err) {
    console.error('Error fetching rated-movie aggregate:', err);
    res.status(500).json({ error: err.message });
  }
});

// New: Provide combined average endpoint
// GET /api/movie/:id/average -> { data: { tmdbRating, userAvg, combinedAverage } }
router.get("/movie/:id/average", authenticateOptional, async (req, res) => {
  try {
    const { id } = req.params;

    // get tmdb rating (vote_average) if available
    let tmdbRating = null;
    try {
      const tmdb = await tmdbService.getMovieDetails(id);
      if (tmdb && typeof tmdb.vote_average === 'number') tmdbRating = Number(tmdb.vote_average);
    } catch (e) {
      // ignore failures
    }

    // get user aggregate from rated-movie parent doc
    const ratedDoc = await getRatedMovieAggregate(id);
    const userAvg = ratedDoc && typeof ratedDoc.avgRating === 'number' ? ratedDoc.avgRating : null;

    // compute combined average: if both present then (tmdb + userAvg) / 2, else prefer whichever exists
    let combined = null;
    if (tmdbRating !== null && userAvg !== null) combined = (tmdbRating + userAvg) / 2;
    else if (tmdbRating !== null) combined = tmdbRating;
    else if (userAvg !== null) combined = userAvg;

    res.json({ data: { tmdbRating, userAvg, combinedAverage: combined } });
  } catch (err) {
    console.error('Error fetching movie average:', err);
    res.status(500).json({ error: err.message });
  }
});
