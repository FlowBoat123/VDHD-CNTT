import { useState } from "react";

export function useSearch() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const openSearchWindow = () => setIsSearchOpen(true);
  const closeSearchWindow = () => setIsSearchOpen(false);
  const toggleSearchWindow = () => setIsSearchOpen((prev) => !prev);

  return {
    isSearchOpen,
    openSearchWindow,
    closeSearchWindow,
    toggleSearchWindow,
  };
}
