import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface SearchWindowProps {
  open: boolean;
  onClose: () => void;
}

export const SearchWindow: React.FC<SearchWindowProps> = ({ open, onClose }) => {
  const [query, setQuery] = useState("");

  if (!open) return null;

  const handleSearch = () => {
    console.log("Searching for:", query);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 border-b pb-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập từ khóa..."
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch}>Tìm</Button>
        </div>

        {/* Content area */}
        <div className="mt-4 max-h-[60vh] overflow-auto">
          <p className="text-sm text-muted-foreground">
            Ai, Ai ngồi treo thở than,
            Ai rồi cũng một lần tim biết yêu,
            Một lần nghe dưới lầu toàn mùi khét
          </p>
        </div>

        {/* Footer */}
        <div className="mt-4 text-right">
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
