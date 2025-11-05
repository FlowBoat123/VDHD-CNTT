import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
  useContext,
} from "react";
import { type User, getAuth, onIdTokenChanged } from "firebase/auth";
import { initializeApp } from "firebase/app";

// Firebase config (safe in frontend)
const firebaseConfig = {
  apiKey: "AIzaSyBVDx76tdGPEsfVevwQW4Q8mUOzBpyiu-I",
  authDomain: "btl-vdhd.firebaseapp.com",
  projectId: "btl-vdhd",
  storageBucket: "btl-vdhd.firebasestorage.app",
  messagingSenderId: "849527888421",
  appId: "1:849527888421:web:2b7f868744761a348e7dcc",
  measurementId: "G-XEKWEMNS1Q",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Define context type
interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
}

// Default context value
export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
});

// Provider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for login/logout + token refresh
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const idToken = await firebaseUser.getIdToken();
        setToken(idToken);
        console.log("User logged in:", firebaseUser.email);
        console.log("Firebase ID token:", idToken);
      } else {
        setUser(null);
        setToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Helper to always get a fresh token
export const getFreshToken = async (): Promise<string | null> => {
  if (!auth.currentUser) return null;
  return await auth.currentUser.getIdToken();
};

// Custom hook for convenience
export function useAuth() {
  return useContext(AuthContext);
}
