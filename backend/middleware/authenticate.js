import { admin } from "../config/firebase.config.js";

export async function authenticateOptional(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1];
    try {
      req.user = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.warn("Invalid token, continuing as guest:", err.message);
    }
  }

  next();
}
