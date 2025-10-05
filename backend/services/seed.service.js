// src/services/seed.service.ts
import { admin, db } from "../config/firebase.config.js";

export async function seedCities() {
  const chats = db
    .collection("users")
    .doc("HMslCzCj1kUwqwENtKQKz3CU8pl1")
    .collection("chats");
  await chats.doc("SF").set({
    name: "San Francisco",
    state: "CA",
    country: "USA",
    capital: false,
    population: 860000,
  });
  await chats.doc("LA").set({
    name: "Los Angeles",
    state: "CA",
    country: "USA",
    capital: false,
    population: 3900000,
  });
  await chats.doc("DC").set({
    name: "Washington, D.C.",
    state: null,
    country: "USA",
    capital: true,
    population: 680000,
  });
  await chats.doc("TOK").set({
    name: "Tokyo",
    state: null,
    country: "Japan",
    capital: true,
    population: 9000000,
  });
  await chats.doc("BJ").set({
    name: "Beijing",
    state: null,
    country: "China",
    capital: true,
    population: 21500000,
  });

  console.log("✅ Chats seeded successfully (v8)");
}

export async function readCities() {
  const cityRef = db
    .collection("users")
    .doc("HMslCzCj1kUwqwENtKQKz3CU8pl1")
    .collection("chats");
  const snapshot = await cityRef.get();
  console.log("snapshot:", snapshot.size);
  snapshot.forEach((doc) => {
    console.log("Document ID:", doc.id);
  });
}
