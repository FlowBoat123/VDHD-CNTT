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
    const res = await api.get<{ chatIds: string[] }>(
      `${CHATBOT_API_BASE_URL}/chats`
    );
    console.log("Fetched chats:", res.data);
    return res.data.chatIds.map((id) => ({ id, title: "Chat", messages: [] })); // don’t preload messages in the sidebar
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
}

export const chatService = new ChatService();
