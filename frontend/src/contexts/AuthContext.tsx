import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../firebase";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  role: string | null;
}

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, role: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const tokenResult = await u.getIdTokenResult();
          const claimRole = (tokenResult.claims as any)?.role ?? null;
          // Dev fallback: if no role claim is set, default to product_ops so ops features are testable.
          setRole(claimRole || "product_ops");
        } catch {
          setRole("product_ops");
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, role }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
