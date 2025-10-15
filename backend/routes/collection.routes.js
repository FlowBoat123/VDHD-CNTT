import express from "express";
import {
  saveMovieToCollection,
  getUserCollection,
  removeMovieFromCollection,
} from "../services/firebase.service.js";
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

export default router;
