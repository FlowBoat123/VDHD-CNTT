import { v1 as uuidv1 } from "uuid";
import { admin, db } from "../config/firebase.config.js";
import { doc, getDoc } from "firebase/firestore";

/**
 * Get user preferences from Firestore
 * @param {*} uid - Firebase user ID
 * @returns user preferences object or null
 */
export async function getUserPreferences(uid) {
  if (!uid) throw new Error("UID is required");

  const doc = await db.collection("preferences").doc(uid).get();
  return doc.exists ? doc.data() : null;
}

/**
 * Set user preferences in Firestore
 * @param {*} uid - Firebase user ID
 * @param {*} preferences - Preferences object to set
 */
export async function setUserPreferences(uid, preferences) {
  if (!uid) throw new Error("UID is required");
  if (typeof preferences !== "object")
    throw new Error("Preferences must be an object");
  await db.collection("preferences").doc(uid).set(preferences, { merge: true });
}

// export async function getUserID(token) {
//   const decodedToken = await admin.auth().verifyIdToken(token);
// }

/**
 * Save a chat message to Firestore under a specific user + chat
 * @param {*} uid - Firebase user ID
 * @param {*} chatId - Chat session ID
 * @param {*} param2 - Message data
 * @returns
 */
export async function saveChatMessage(
  uid,
  chatId,
  { sender, content, movies }
) {
  if (!uid) throw new Error("UID is required");
  if (!chatId) throw new Error("chatId is required");

  const chatDocRef = db
    .collection("users")
    .doc(uid)
    .collection("chats")
    .doc(chatId);

  // Ensure chat doc exists (or create it if missing)
  const chatSnap = await chatDocRef.get();
  if (!chatSnap.exists) {
    await chatDocRef.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    // Update lastUpdated if already exists
    await chatDocRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Create message
  const messageID = uuidv1();
  const messageRef = chatDocRef.collection("messages").doc(messageID);

  const payload = {
    sender,
    content,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (Array.isArray(movies) && movies.length > 0) {
    payload.movieSuggestions = movies;
  }

  await messageRef.set(payload);

  return messageID; // better to return messageId instead of subcollection id
}

export async function getChatMessages(uid, chatId) {
  if (!uid) throw new Error("UID is required");
  if (!chatId) throw new Error("chatId is required");
  const snapshot = await db
    .collection("users")
    .doc(uid)
    .collection("chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("timestamp", "asc")
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function getUserChatsId(uid) {
  if (!uid) throw new Error("UID is required");
  const chatsRef = db.collection("users").doc(uid).collection("chats");
  const snapshot = await chatsRef.get();
  return snapshot.docs.map((doc) => doc.id);
}

/**
 * Save a movie to the user's collection (idempotent - uses movie.id as doc id)
 * @param {string} uid - Firebase user ID
 * @param {{id:number|string, title:string, poster?:string, rating?:number}} movie - movie object to save
 */
export async function saveMovieToCollection(uid, movie) {
  if (!uid) throw new Error("UID is required");
  if (!movie || typeof movie !== "object")
    throw new Error("movie must be an object");
  if (!movie.id) throw new Error("movie.id is required");

  const movieId = String(movie.id);
  const movieRef = db
    .collection("users")
    .doc(uid)
    .collection("collections")
    .doc(movieId);

  const payload = {
    ...movie,
    id: movie.id,
    savedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  console.log(`Saved ${movie} to ${uid}`);
  await movieRef.set(payload, { merge: true });
  return movieId;
}

/**
 * Get all movies saved in user's collection
 * @param {string} uid - Firebase user ID
 * @returns {Array<Object>} list of saved movies
 */
export async function getUserCollection(uid) {
  if (!uid) throw new Error("UID is required");

  const ref = db.collection("users").doc(uid).collection("collections");
  const snapshot = await ref.orderBy("savedAt", "desc").get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Remove a movie from user's collection
 * @param {string} uid - Firebase user ID
 * @param {string|number} movieId - movie id to remove
 */
export async function removeMovieFromCollection(uid, movieId) {
  if (!uid) throw new Error("UID is required");
  if (!movieId) throw new Error("movieId is required");

  const id = String(movieId);
  const ref = db.collection("users").doc(uid).collection("collections").doc(id);
  await ref.delete();
  return id;
}
