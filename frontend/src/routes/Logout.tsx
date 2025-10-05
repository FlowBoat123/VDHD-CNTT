import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "@/services/auth.service";

export default function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        await logout();
      } catch (e) {
        // ignore
      } finally {
        navigate("/chat", { replace: true });
      }
    })();
  }, [navigate]);

  return null;
}
