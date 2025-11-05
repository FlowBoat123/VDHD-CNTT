import type { Chat } from "@/types/chat.type";
import api from "@/api/api";
import type { Message } from "@/types/message.type";
interface ChatbotResponse {
  fulfillmentMessages: any[];
  sessionId: string;
}

const CHATBOT_API_BASE_URL = "http://localhost:3000/api";

class ChatService {
  // Send message to backend with optional sessionId and auth token
  async sendMessage(content: string, sessionId?: string, chatId?: string) {
    return api.post<ChatbotResponse>(`${CHATBOT_API_BASE_URL}/message`, {
      content,
      sessionId,
      chatId,
    });
  }

  // Fetch chat directly from firebase
  async fetchChats(): Promise<Chat[]> {
    const res = await api.get<Chat[]>(`${CHATBOT_API_BASE_URL}/chats`);
    console.log("Fetched chats:", res.data);
    return res.data;
  }

  // Fetch messages for a specific chat
  async fetchMessages(chatId: string): Promise<Message[]> {
    console.log("Fetching messages for chatId:", chatId);
    const res = await api.get<{ messages: Message[] }>(
      `${CHATBOT_API_BASE_URL}/chats/${chatId}/messages`
    );
    console.log("Fetched messages:", res.data);
    return res.data.messages || [];
  }

  async createChatWithTitle(chatId: string, title: string): Promise<Chat> {
    // Gửi yêu cầu POST đến endpoint `/api/chats/:chatId/title`
    // với `title` mới trong phần body của request.
    const res = await api.post(
      `${CHATBOT_API_BASE_URL}/chats/${chatId}/title`,
      { title }
    );
    return res.data;
  }

  async deleteChat(chatId: string) {
    // Gọi endpoint DELETE mới
    return api.delete(`${CHATBOT_API_BASE_URL}/chats/${chatId}`);
  }
}

export const chatService = new ChatService();
