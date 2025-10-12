import { useState } from "react";
import { Sidebar } from "@/components/Sidebar.component";
import { ChatArea } from "@/components/ChatArea.component";
import { MessageInput } from "@/components/MessageInput.component";
import { SearchWindow } from "@/components/Window.SearchWindow"; 
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useSearch } from "@/hooks/useSearch";

type View = "chat";

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
    error,
    setActiveChat,
    getCurrentMessages,
    sendMessage,
    createNewChat,
  } = useChat(user);

  const {
    isSearchOpen, 
    openSearchWindow, 
    closeSearchWindow,
    toggleSearchWindow,
  } = useSearch();

  return (
    <div className="flex w-full h-full">
      {!isGuest && currentView === "chat" && (
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
            createNewChat();
            navigate(`/chat/model`);
          }}
          onSearchUse={() => {
            openSearchWindow();
          }}
        />
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col h-full">
            <ChatArea messages={getCurrentMessages()} isLoading={isLoading} />
            <MessageInput
              onSend={sendMessage}
              disabled={isTyping || isLoading}
            />
          </div>
        </div>
      </div>

      <SearchWindow open={isSearchOpen} onClose={closeSearchWindow} />
    </div>
  );
}
