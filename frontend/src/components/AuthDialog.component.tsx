"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  loginWithGoogle,
  logout,
  getCurrentUser,
} from "@/services/auth.service";
import { FcGoogle } from "react-icons/fc";

interface AuthDialogProps {
  onLogin?: (user: any) => void;
}

export function AuthDialog({ onLogin }: AuthDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(getCurrentUser());

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError("");
    try {
      const loggedUser = await loginWithGoogle();
      if (loggedUser) {
        setUser(loggedUser);
        onLogin?.(loggedUser);
      }
    } catch (err: any) {
      setError(err.message || "Đăng nhập thất bại");
    }
    setIsLoading(false);
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  return (
    <Dialog>
      {/* Trigger button */}
      <DialogTrigger asChild>
        <Button variant="outline">{user ? "Tài khoản" : "Đăng nhập"}</Button>
      </DialogTrigger>

      {/* Modal content */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {user ? "Thông tin tài khoản" : "Đăng nhập"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {user ? (
            <div className="space-y-2 text-center">
              <p className="text-sm font-medium">
                Xin chào, {user.displayName || user.email}
              </p>
              <Button
                variant="outline"
                onClick={handleLogout}
                className="w-full"
              >
                Đăng xuất
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full flex items-center justify-center gap-2"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              <FcGoogle size={20} />
              {isLoading ? "Đang đăng nhập..." : "Đăng nhập với Google"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
