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

  // const createNewChat = () => {
  //   if (!user) {
  //     // Guest: clear single chat messages
  //     setChats((prev) => {
  //       if (prev.length === 0) return prev;
  //       const single = { ...prev[0], messages: [] };
  //       return [single];
  //     });
  //     return;
  //   }

  //   const newChatId = uuidv1();
  //   const newChat: Chat = {
  //     id: newChatId,
  //     title: "Cuộc trò chuyện mới",
  //     messages: [],
  //   };

  //   setChats((prev) => [newChat, ...prev]);
  //   setActiveChat(newChatId);
  //   return newChatId;
  // };

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
      return;
    }

    // Logged-in: don't actually create chat until first message
    setActiveChat(null); // open blank “model” page
  };

  // const sendMessage = async (content: string) => {
  //   let sessionId = localStorage.getItem("sessionId");
  //   if (!sessionId) {
  //     sessionId = uuidv1();
  //     localStorage.setItem("sessionId", sessionId);
  //   }

  //   let chatId = activeChat;
  //   if (!chatId) {
  //     chatId = sessionId;
  //     if (!user && chats.length === 0) {
  //       const guestChat: Chat = {
  //         id: chatId,
  //         title:
  //           content.length > 30 ? content.substring(0, 30) + "..." : content,
  //         messages: [],
  //       };
  //       setChats([guestChat]);
  //     }
  //     setActiveChat(chatId);
  //   }

  //   const userMessage = createMessage(content, "user");

  //   setChats((prev) => {
  //     const existingChat = prev.find((chat) => chat.id === chatId);
  //     if (existingChat) {
  //       return prev.map((chat) =>
  //         chat.id === chatId
  //           ? { ...chat, messages: [...chat.messages, userMessage] }
  //           : chat
  //       );
  //     } else {
  //       const newChat: Chat = {
  //         id: chatId,
  //         title:
  //           content.length > 30 ? content.substring(0, 30) + "..." : content,
  //         messages: [userMessage],
  //       };
  //       return [newChat, ...prev];
  //     }
  //   });

  //   setIsTyping(true);

  //   try {
  //     setError(null);
  //     const response = await chatService.sendMessage(
  //       content,
  //       sessionId,
  //       chatId
  //     );

  //     console.log("Chatbot response:", response.data);

  //     // Extract main text message and movie list from backend response
  //     const fulfillmentMessages = response.data.fulfillmentMessages || [];

  //     let textMessage = "";
  //     let moviesPayload: {
  //       id: number;
  //       title: string;
  //       subtitle?: string;
  //       poster?: string;
  //       url?: string;
  //     }[] = [];

  //     // Loop through Dialogflow-like messages
  //     for (const msg of fulfillmentMessages) {
  //       if (msg?.text?.text?.length) {
  //         textMessage = msg.text.text.join("\n");
  //       }

  //       if (Array.isArray(msg?.movieSuggestions)) {
  //         moviesPayload = msg.movieSuggestions;
  //       }
  //     }

  //     // Build one assistant message for UI
  //     const botMessage = createMessage(textMessage, "assistant");

  //     if (moviesPayload.length > 0) {
  //       botMessage.movieSuggestions = moviesPayload;
  //     }

  //     setChats((prev) =>
  //       prev.map((chat) =>
  //         chat.id === chatId
  //           ? { ...chat, messages: [...chat.messages, botMessage] }
  //           : chat
  //       )
  //     );
  //   } catch (err) {
  //     console.error(err);
  //     setError("Không thể gửi tin nhắn. Vui lòng thử lại.");
  //     const errorMessage = createMessage(
  //       "Đã có lỗi xảy ra. Vui lòng thử lại.",
  //       "assistant"
  //     );
  //     setChats((prev) =>
  //       prev.map((chat) =>
  //         chat.id === chatId
  //           ? { ...chat, messages: [...chat.messages, errorMessage] }
  //           : chat
  //       )
  //     );
  //   } finally {
  //     setIsTyping(false);
  //   }
  // };

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
