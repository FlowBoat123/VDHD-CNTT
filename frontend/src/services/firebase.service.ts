// src/services/firebase.service.ts
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBVDx76tdGPEsfVevwQW4Q8mUOzBpyiu-I",
  authDomain: "btl-vdhd.firebaseapp.com",
  projectId: "btl-vdhd",
  storageBucket: "btl-vdhd.firebasestorage.app",
  messagingSenderId: "849527888421",
  appId: "1:849527888421:web:2b7f868744761a348e7dcc",
  measurementId: "G-XEKWEMNS1Q",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
