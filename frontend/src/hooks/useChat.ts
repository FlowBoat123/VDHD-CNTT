import { useEffect, useState } from "react";
import { v1 as uuidv1 } from "uuid";
import { chatService } from "@/services/chat.service";
import type { Chat } from "@/types/chat.type";
import type { Message } from "@/types/message.type";
import { useParams } from "react-router-dom";
import type { User } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export function useChat(user: User | null) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGuest = !user;
  const params = useParams();
  const navigate = useNavigate();

  // Helper to create a message object
  const createMessage = (
    content: string,
    sender: "user" | "assistant"
  ): Message => {
    return {
      id: Date.now().toString(),
      content,
      sender,
      timestamp: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  };

  // Set active chat from route param for logged-in users
  useEffect(() => {
    const routeChatId = params.id || null;
    if (isGuest) return; // guests are on /chat only
    setActiveChat(routeChatId);
  }, [params.id, isGuest]);

  useEffect(() => {
    const initializeChats = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (!user) {
          // Guest user: use local session
          let sessionId = localStorage.getItem("sessionId");
          if (!sessionId) {
            sessionId = uuidv1();
            localStorage.setItem("sessionId", sessionId);
          }

          const guestChat: Chat = {
            id: sessionId,
            title: "Cuộc trò chuyện mới",
            messages: [],
          };

          setChats([guestChat]);
          setActiveChat(sessionId);
        } else {
          // Authenticated user: fetch chats from backend
          const response = await chatService.fetchChats();
          if (Array.isArray(response)) {
            setChats(response);
          } else if (Array.isArray((response as any).chats)) {
            // Handle different response structure
            setChats((response as any).chats);
          } else if (Array.isArray((response as any).chatIds)) {
            const ids: string[] = (response as any).chatIds;
            const mapped: Chat[] = ids.map((id) => ({
              id,
              title: "Cuộc trò chuyện",
              messages: [],
            }));
            setChats(mapped);
          } else {
            setChats([]);
          }
        }
      } catch (err) {
        console.error("Failed to initialize chats:", err);
        setError("Không thể tải danh sách cuộc trò chuyện");
        setChats([]);
      } finally {
        setIsLoading(false);
      }
    };

    initializeChats();
  }, [user]);

  // Load messages for active chat (authenticated users only)
  useEffect(() => {
    if (!activeChat || !user) return;

    const loadMessages = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const messages = await chatService.fetchMessages(activeChat);
        setChats((prev) => {
          const existingChat = prev.find((chat) => chat.id === activeChat);
          if (existingChat) {
            // Nếu đã có messages cục bộ (ví dụ: tin nhắn người dùng mới gửi), giữ nguyên để không bị ghi đè
            if (existingChat.messages && existingChat.messages.length > 0) {
              return prev;
            }
            // Nếu không có messages cục bộ, cập nhật bằng messages từ server
            return prev.map((chat) =>
              chat.id === activeChat ? { ...chat, messages } : chat
            );
          } else {
            const newChat: Chat = {
              id: activeChat,
              title: "Cuộc trò chuyện mới",
              messages,
            };
            return [newChat, ...prev];
          }
        });
      } catch (err) {
        console.error("Failed to fetch messages:", err);
        setError("Không thể tải tin nhắn");
        setChats((prev) => {
          const existingChat = prev.find((chat) => chat.id === activeChat);
          // Nếu đã có chat cục bộ (với messages), giữ nguyên để không mất tin nhắn người dùng
          if (existingChat) {
            return prev;
          }
          const newChat: Chat = {
            id: activeChat,
            title: "Cuộc trò chuyện mới",
            messages: [],
          };
          return [newChat, ...prev];
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [activeChat, user]);

  const createNewChat = () => {
    if (!user) {
      // Guest mode — keep only one chat
      setChats((prev) => {
        if (prev.length === 0) {
          const guestChat: Chat = {
            id: "guest-chat",
            title: "Cuộc trò chuyện khách",
            messages: [],
          };
          return [guestChat];
        }
        // clear messages for guest chat
        const single = { ...prev[0], messages: [] };
        return [single];
      });
      setActiveChat(null); // “model” state
      navigate("/chat/?model=auto");
      return;
    }

    // Logged-in: don't actually create chat until first message
    setActiveChat(null); // open blank “model” page
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    // --- Ensure sessionId for backend ---
    let sessionId = localStorage.getItem("sessionId");
    if (!sessionId) {
      sessionId = uuidv1();
      localStorage.setItem("sessionId", sessionId);
    }

    let chatId = activeChat;
    const userMessage = createMessage(content, "user");


    // --- If user hasn't created a chat yet (ChatGPT-style first message logic) ---
    if (!chatId) {
      chatId = uuidv1(); // separate from sessionId (session is for context)
      const title =
        content.length > 30 ? content.substring(0, 30) + "..." : content;

      if (!user) {
        // Guest: only one chat at a time
        setChats(() => [
          {
            id: chatId as string,
            title,
            messages: [userMessage],
          },
        ]);
      } else {
        // Logged-in: create new chat
        setChats((prev) => [
          {
            id: chatId!,
            title,
            messages: [userMessage],
          },
          ...prev,
        ]);
      }

      setActiveChat(chatId);
    } else {
      // --- Existing chat: append user message ---
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, userMessage] }
            : chat
        )
      );
    }

    // --- Show typing indicator ---
    setIsTyping(true);
    setError(null);

    try {
      const response = await chatService.sendMessage(
        content,
        sessionId,
        chatId
      );
      console.log("Chatbot response:", response.data);

      const fulfillmentMessages = response.data.fulfillmentMessages || [];

      let textMessage = "";
      let moviesPayload: {
        id: number;
        title: string;
        subtitle?: string;
        poster?: string;
        url?: string;
      }[] = [];

      // Parse backend messages
      for (const msg of fulfillmentMessages) {
        if (msg?.text?.text?.length) {
          textMessage += msg.text.text.join("\n");
        }

        if (Array.isArray(msg?.movieSuggestions)) {
          moviesPayload = msg.movieSuggestions;
        }
      }

      // Build assistant message
      const botMessage = createMessage(
        textMessage || "Không có phản hồi.",
        "assistant"
      );
      if (moviesPayload.length > 0) botMessage.movieSuggestions = moviesPayload;

      // Update chat with assistant response
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, botMessage] }
            : chat
        )
      );
    } catch (err) {
      console.error(err);
      setError("Không thể gửi tin nhắn. Vui lòng thử lại.");
      const errorMessage = createMessage(
        "Đã có lỗi xảy ra. Vui lòng thử lại.",
        "assistant"
      );
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, errorMessage] }
            : chat
        )
      );
    } finally {
      setIsTyping(false);
    }
  };

  const getCurrentMessages = (): Message[] => {
    if (!activeChat) return [];
    const chat = chats.find((c) => c.id === activeChat);
    return chat?.messages || [];
  };

  return {
    chats,
    activeChat,
    isTyping,
    isLoading,
    error,
    isGuest,
    setActiveChat,
    createNewChat,
    sendMessage,
    getCurrentMessages,
  };
}
