import { useEffect, useState } from "react";
import { v1 as uuidv1 } from "uuid";
import { chatService } from "@/services/chat.service";
import type { Chat } from "@/types/chat.type";
import type { Message } from "@/types/message.type";
import { useParams } from "react-router-dom";
import type { User } from "firebase/auth";

export function useChat(user: User | null) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGuest = !user;
  const params = useParams();

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

  // Initialize guest chat (ephemeral)
  useEffect(() => {
    if (!user) {
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
    }
  }, [user]);

  // Load chats for authenticated users
  useEffect(() => {
    if (!user) return;

    const loadChats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await chatService.fetchChats();
        setChats(response || []);
      } catch (err) {
        console.error("Failed to fetch chats:", err);
        setError("Không thể tải danh sách cuộc trò chuyện");
        setChats([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadChats();
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
          if (!existingChat) {
            const newChat: Chat = {
              id: activeChat,
              title: "Cuộc trò chuyện mới",
              messages: [],
            };
            return [newChat, ...prev];
          }
          return prev;
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [activeChat, user]);

  const createNewChat = () => {
    if (!user) {
      // Guest: clear single chat messages
      setChats((prev) => {
        if (prev.length === 0) return prev;
        const single = { ...prev[0], messages: [] };
        return [single];
      });
      return;
    }

    const newChatId = uuidv1();
    const newChat: Chat = {
      id: newChatId,
      title: "Cuộc trò chuyện mới",
      messages: [],
    };

    setChats((prev) => [newChat, ...prev]);
    setActiveChat(newChatId);
    return newChatId;
  };

  const sendMessage = async (content: string) => {
    let sessionId = localStorage.getItem("sessionId");
    if (!sessionId) {
      sessionId = uuidv1();
      localStorage.setItem("sessionId", sessionId);
    }

    let chatId = activeChat;
    if (!chatId) {
      chatId = sessionId;
      if (!user && chats.length === 0) {
        const guestChat: Chat = {
          id: chatId,
          title:
            content.length > 30 ? content.substring(0, 30) + "..." : content,
          messages: [],
        };
        setChats([guestChat]);
      }
      setActiveChat(chatId);
    }

    const userMessage = createMessage(content, "user");

    setChats((prev) => {
      const existingChat = prev.find((chat) => chat.id === chatId);
      if (existingChat) {
        return prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, userMessage] }
            : chat
        );
      } else {
        const newChat: Chat = {
          id: chatId,
          title:
            content.length > 30 ? content.substring(0, 30) + "..." : content,
          messages: [userMessage],
        };
        return [newChat, ...prev];
      }
    });

    setIsTyping(true);

    try {
      setError(null);
      const response = await chatService.sendMessage(
        content,
        sessionId,
        chatId
      );

      // Build assistant content from Dialogflow fulfillmentMessages
      const fulfillmentMessages = response.data.fulfillmentMessages || [];
      const parts: string[] = [];
      let moviesPayload: {
        id: number;
        title: string;
        subtitle?: string;
        poster?: string;
        url?: string;
      }[] | undefined;

      for (const msg of fulfillmentMessages) {
        // Text message
        const textArr = msg?.text?.text as unknown as string[] | undefined;
        if (Array.isArray(textArr) && textArr.length > 0) {
          parts.push(textArr.join("\n"));
        }

        // Movies message (custom payload)
        const movies = msg?.movies as
          | Array<{
              id: number;
              title: string;
              subtitle?: string;
              poster?: string;
              url?: string;
            }>
          | undefined;
        if (Array.isArray(movies) && movies.length > 0) {
          // keep full movies payload to render cards and to store
          moviesPayload = movies;
          const lines: string[] = [];
          lines.push("\n**Gợi ý phim:**");
          movies.forEach((m, idx) => {
            const titleWithLink = m.url ? `[${m.title}](${m.url})` : m.title;
            const subtitle = m.subtitle ? ` — ${m.subtitle}` : "";
            lines.push(`${idx + 1}. ${titleWithLink}${subtitle}`);
          });
          parts.push(lines.join("\n"));
        }
      }

      const assistantContent = parts.length > 0 ? parts.join("\n\n") : "";
      const botMessage = createMessage(assistantContent || "", "assistant");
      if (moviesPayload && moviesPayload.length > 0) {
        // attach movies to the same assistant message so UI can render cards
        (botMessage as any).movies = moviesPayload;
      }

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
