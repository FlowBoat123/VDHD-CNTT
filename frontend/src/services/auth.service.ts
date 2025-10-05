// src/services/auth.service.ts
import { signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/services/firebase.service";

// Ensure user exists in Firestore
async function ensureUserInFirestore(user: User) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  const userData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    provider: "google.com",
    lastLogin: new Date(),
  };

  if (!userSnap.exists()) {
    (userData as any).createdAt = new Date();
  }

  await setDoc(userRef, userData, { merge: true });
}

// Google login
export async function loginWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  console.log("Google login successful:", user);

  await ensureUserInFirestore(user);

  const token = await user.getIdToken();
  console.log("Firebase ID token:", token);

  return user;
}

// Logout
export async function logout(): Promise<void> {
  await signOut(auth);
}

// Get currently logged-in user
export function getCurrentUser(): User | null {
  return auth.currentUser;
}
