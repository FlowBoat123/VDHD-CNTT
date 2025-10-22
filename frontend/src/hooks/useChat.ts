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
        console.log("this is chat response: ", response);
        setChats(response);
      }
    } catch (err) {
      console.error("Failed to initialize chats:", err);
      setError("Không thể tải danh sách cuộc trò chuyện");
      setChats([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (activeChat: string) => {
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
        // Logged-in: create new chat and add to sidebar
        setChats((prev) => [
          {
            id: chatId!,
            title,
            messages: [userMessage],
          },
          ...prev,
        ]);
        chatService.createChatWithTitle(chatId, title).catch((err) => {
          console.error("Lỗi khi tạo chat ở backend:", err);
          // Tùy chọn: Bạn có thể thêm logic để hiển thị lỗi cho người dùng ở đây
        });
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
      if (user) {
        navigate(`/chat/${chatId}`);
      }

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
    const chat = (chats || []).find((c) => c.id === activeChat);
    return chat?.messages || [];
  };

  // Set active chat from route param for logged-in users and id changes
  useEffect(() => {
    if (user) {
      setActiveChat(params.id || null);
      console.log("active chat: ", activeChat);
    }
  }, [params.id, user]);

  // something
  useEffect(() => {
    initializeChats();
    console.log(chats);
  }, [user]);

  // Load messages for active chat (authenticated users only)
  useEffect(() => {
    if (!activeChat || !user) return;
    console.log("active chat: ", activeChat);
    loadMessages(activeChat);
  }, [activeChat, user]);

  const createNewChat = () => {
    // Chỉ cần điều hướng đến route gốc, useEffect sẽ xử lý việc đặt activeChat thành null
    navigate("/chat");
  };

  const deleteChat = async (chatId: string) => {
    if (!chatId) return;

    // 1. Lưu lại state gốc để rollback nếu thất bại
    const originalChats = chats;

    // 2. Cập nhật giao diện ngay lập tức (Optimistic Update)
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));

    // 3. Nếu chat đang hoạt động bị xóa, điều hướng về trang chủ
    if (activeChat === chatId) {
      navigate("/chat");
      setActiveChat(null);
    }

    try {
      // 4. Gọi API ở backend
      await chatService.deleteChat(chatId);
      // Xóa thành công, không cần làm gì thêm
    } catch (err) {
      console.error("Failed to delete chat:", err);
      setError("Không thể xóa cuộc trò chuyện. Đang hoàn tác...");

      // 5. Rollback: Nếu API thất bại, khôi phục lại state gốc
      setChats(originalChats);

      // Nếu người dùng đã bị điều hướng đi, điều hướng họ trở lại
      if (activeChat === chatId) {
        navigate(`/chat/${chatId}`);
      }
    }
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
    deleteChat,
    sendMessage,
    getCurrentMessages,
  };
}
