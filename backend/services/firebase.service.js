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
  { sender, content, movies, card, text }
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
    await chatDocRef.set(
      {
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
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
    content: content || text || "",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (Array.isArray(movies) && movies.length > 0) {
    payload.movieSuggestions = movies;
  }

  if (card) {
    payload.card = card;
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

export async function getUserChats(uid) {
  if (!uid) throw new Error("UID is required");
  const chatsRef = db.collection("users").doc(uid).collection("chats");
  const snapshot = await chatsRef.orderBy("lastUpdated", "desc").get();
  // snapshot.forEach((doc) => {
  //   const data = doc.data();
  //   console.log(data);
  // });
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title || "Cuộc trò chuyện", // Fallback title
    };
  });
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
 * Cập nhật tiêu đề của một cuộc trò chuyện cụ thể
 * @param {string} uid - ID user Firebase
 * @param {string} chatId - ID of chat needed changing title
 * @param {string} title - New title
 */
export async function updateChatTitle(uid, chatId, title) {
  // Kiểm tra các tham số đầu vào
  if (!uid) throw new Error("UID is required");
  if (!chatId) throw new Error("chatId is required");
  if (!title) throw new Error("title is required");

  // Tạo một tham chiếu đến document của cuộc trò chuyện trong Firestore
  const chatDocRef = db
    .collection("users")
    .doc(uid)
    .collection("chats")
    .doc(chatId);

  // Thực hiện cập nhật trường 'title' và 'lastUpdated'
  await chatDocRef.set({
    title: title,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Ghi log để xác nhận
  console.log(`Updated title for chat ${chatId} to: "${title}"`);
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

/**
 * Set rating for a movie by a user. This will store rating info under
 * users/{uid}/ratings/{movieId} and also merge rating into the collections doc
 * if the movie exists there.
 * @param {string} uid
 * @param {string|number} movieId
 * @param {number} rating
 * @param {object} movie (optional) - movie metadata to store alongside rating
 */
export async function setMovieRating(uid, movieId, rating, movie = {}) {
  if (!uid) throw new Error("UID is required");
  if (!movieId) throw new Error("movieId is required");
  if (typeof rating !== 'number') throw new Error("rating must be a number");

  const id = String(movieId);

  // store in a dedicated ratings subcollection for easy querying
  const ratingsRef = db.collection('users').doc(uid).collection('ratings').doc(id);
  const payload = {
    movieId: id,
    rating,
    ratedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...movie,
  };

  await ratingsRef.set(payload, { merge: true });

  // also merge rating into collections/{movieId} if present
  const collectionRef = db.collection('users').doc(uid).collection('collections').doc(id);
  const collSnap = await collectionRef.get();
  if (collSnap.exists) {
    await collectionRef.set({ rating }, { merge: true });
  }

  return { movieId: id, rating };
}

/**
 * Get rating for a movie by a user. Checks ratings subcollection first,
 * then falls back to collections/{movieId}.rating if present.
 * @param {string} uid
 * @param {string|number} movieId
 */
export async function getMovieRating(uid, movieId) {
  if (!uid) throw new Error("UID is required");
  if (!movieId) throw new Error("movieId is required");

  const id = String(movieId);

  const ratingsRef = db.collection('users').doc(uid).collection('ratings').doc(id);
  const snap = await ratingsRef.get();
  if (snap.exists) {
    return { id: snap.id, ...snap.data() };
  }

  // fallback to collections doc
  const collRef = db.collection('users').doc(uid).collection('collections').doc(id);
  const collSnap = await collRef.get();
  if (collSnap.exists) {
    const data = collSnap.data();
    if (data && typeof data.rating !== 'undefined') {
      return { movieId: id, rating: data.rating };
    }
  }

  return null;
}

async function deleteCollection(collectionRef) {
  const snapshot = await collectionRef.limit(50).get(); // Xóa theo batch 50
  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Gọi đệ quy nếu collection còn tài liệu
  await deleteCollection(collectionRef);
}

/**
 * Xóa một cuộc trò chuyện, bao gồm tất cả tin nhắn
 * @param {string} uid - ID user Firebase
 * @param {string} chatId - ID của chat cần xóa
 */
export async function deleteChat(uid, chatId) {
  if (!uid) throw new Error("UID is required");
  if (!chatId) throw new Error("chatId is required");

  const chatDocRef = db
    .collection("users")
    .doc(uid)
    .collection("chats")
    .doc(chatId);
  const messagesRef = chatDocRef.collection("messages");

  // 1. Xóa subcollection 'messages'
  await deleteCollection(messagesRef);

  // 2. Xóa document 'chat'
  await chatDocRef.delete();

  console.log(`Deleted chat ${chatId} and all its messages for user ${uid}`);
  return chatId;
}

/**
 * Get rated-movie document metadata (if exists)
 * @param {string|number} movieId
 */
export async function getRatedMovieDoc(movieId) {
  if (!movieId) throw new Error('movieId is required');
  const id = String(movieId);
  const ref = db.collection('rated-movie').doc(id);
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Upsert a user's rating into the rated-movie collection and recompute aggregates.
 * If the rated-movie doc does not exist and tmdbRating is provided, it will add a baseline rating record with id '_tmdb'.
 * @param {string} uid
 * @param {string|number} movieId
 * @param {number} rating
 * @param {number?} tmdbRating
 */
export async function upsertRatedMovieUserRating(uid, movieId, rating, tmdbRating) {
  if (!uid) throw new Error('UID is required');
  if (!movieId) throw new Error('movieId is required');
  if (typeof rating !== 'number') throw new Error('rating must be a number');

  const id = String(movieId);
  const movieRef = db.collection('rated-movie').doc(id);
  const movieSnap = await movieRef.get();

  // If doc not exist, create and optionally add tmdb baseline
  if (!movieSnap.exists) {
    await movieRef.set({ movieId: id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    if (typeof tmdbRating === 'number') {
      // add baseline rating entry with special id
    }
  }

  // upsert user's rating
  const userRatingRef = movieRef.collection('ratings').doc(uid);
  await userRatingRef.set({ uid, rating, ratedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  // recompute aggregates (include baseline if present)
  const ratingsSnap = await movieRef.collection('ratings').get();
  let sum = 0;
  let count = 0;
  ratingsSnap.forEach((d) => {
    const data = d.data();
    if (data && typeof data.rating === 'number') {
      sum += Number(data.rating);
      count += 1;
    }
  });
  const avg = count > 0 ? sum / count : null;

  await movieRef.set({ avgRating: avg, ratingCount: count, lastUpdated: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  return { movieId: id, avgRating: avg, ratingCount: count };
}