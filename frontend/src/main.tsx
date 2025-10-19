import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Header } from "@/components/Header.component";
import Logout from "@/routes/Logout";
import ChatLayout from "./components/ChatLayout.component.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <div className="h-screen flex flex-col bg-background">
          <Header />
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-hidden">
                <Routes>
                  <Route path="/" element={<Navigate to="/chat" replace />} />
                  <Route path="/chat" element={<ChatLayout />} />
                  <Route path="/chat/:id" element={<ChatLayout />} />
                  <Route path="/collection" element={<ChatLayout />} />
                  <Route path="/logout" element={<Logout />} />
                  <Route path="*" element={<Navigate to="/chat" replace />} />
                </Routes>
              </div>
            </div>
          </div>
        </div>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
