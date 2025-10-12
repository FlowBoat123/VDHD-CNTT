// src/services/seed.service.ts
import { admin, db } from "../config/firebase.config.js";

export async function seedMovieSuggestions() {
  const seedRef = db.collection("seed").doc("movieSuggestions");

  const movieSuggestions = {
    movieSuggestions: [
      {
        title: "Inception",
        year: 2010,
        genre: ["Action", "Sci-Fi", "Thriller"],
        director: "Christopher Nolan",
        rating: 8.8,
      },
      {
        title: "Interstellar",
        year: 2014,
        genre: ["Adventure", "Drama", "Sci-Fi"],
        director: "Christopher Nolan",
        rating: 8.6,
      },
      {
        title: "The Matrix",
        year: 1999,
        genre: ["Action", "Sci-Fi"],
        director: "Lana Wachowski, Lilly Wachowski",
        rating: 8.7,
      },
      {
        title: "Parasite",
        year: 2019,
        genre: ["Drama", "Thriller"],
        director: "Bong Joon Ho",
        rating: 8.6,
      },
      {
        title: "The Dark Knight",
        year: 2008,
        genre: ["Action", "Crime", "Drama"],
        director: "Christopher Nolan",
        rating: 9.0,
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await seedRef.set(movieSuggestions);

  console.log("✅ Movie suggestions saved in 'seed' collection successfully");
}

export async function readMovieSuggestions() {
  const docRef = db.collection("seed").doc("movieSuggestions");
  const doc = await docRef.get();

  if (!doc.exists) {
    console.log("❌ No movie suggestions found in 'seed' collection.");
    return;
  }

  console.log("🎬 Movie Suggestions JSON from 'seed':");
  console.log(JSON.stringify(doc.data(), null, 2));
  return doc.data();
}
