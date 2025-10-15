import { useState } from "react";

import { Sidebar } from "@/components/Sidebar.component";
import { ChatArea } from "@/components/ChatArea.component";
import { MessageInput } from "@/components/MessageInput.component";
import { SearchWindow } from "@/components/Window.SearchWindow";
import { MovieDetailWindow } from "@/components/Window.MovieDetail";
import Collection from "@/components/Collection.component";

import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useSearch } from "@/hooks/useSearch";
import { usemovieDetail } from "@/hooks/useMovieDetail";

type View = "chat" | "collection";

export default function App() {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState<View>("chat");
  const navigate = useNavigate();
  const isGuest = !user;

  const {
    chats,
    activeChat,
    isTyping,
    isLoading,
    setActiveChat,
    getCurrentMessages,
    sendMessage,
    createNewChat,
  } = useChat(user);

  const {
    isSearchOpen,
    openSearchWindow,
    closeSearchWindow,
  } = useSearch();

  const {
    movieDetail_isOpen,
    movieDetail_isSaved,
    movieDetail_setIsSaved,
    movieDetail_open,
    movieDetail_close,
    movieDetail_movie,
  } = usemovieDetail();

  return (
    <div className="flex w-full h-full">
      {!isGuest && (
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          chats={chats}
          activeChat={activeChat}
          onChatSelect={(chatId) => {
            setActiveChat(chatId);
            setSidebarOpen(false);
            setCurrentView("chat");
            navigate(`/chat/${chatId}`);
          }}
          onNewChat={() => {
            setCurrentView("chat");
            createNewChat();
            navigate(`/chat/model`);
          }}
          onSearchUse={() => {
            openSearchWindow();
          }}
          onOpenCollection={() => {
            setCurrentView("collection");
          }}
        />
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col h-full">
            {currentView === "chat" ? (
              <>
                <ChatArea messages={getCurrentMessages()} isLoading={isLoading} onClickMovieCard={(id) => {movieDetail_open(id.toString())}}/>
                <MessageInput
                  onSend={sendMessage}
                  disabled={isTyping || isLoading}
                />
              </>
            ) : (
              <Collection
                movies={[]}
                onOpenMovie={(id) => movieDetail_open(id.toString())}
              />
            )}
          </div>
        </div>
      </div>

      {/* <button
        onClick={() => movieDetail_open("338969")}
        className="rounded-xl border border-black/10 px-4 py-2 hover:bg-neutral-50"
      >
        Show Film Detail
      </button> */}

      <SearchWindow open={isSearchOpen} onClose={closeSearchWindow} />

      <MovieDetailWindow
        open={movieDetail_isOpen}
        onOpenChange={(v) => (v ? movieDetail_open() : movieDetail_close())}
        movie={movieDetail_movie}
        isSaved={movieDetail_isSaved}
        onToggleSave={() => movieDetail_setIsSaved((v) => !v)}
      />
    </div>
  );
}