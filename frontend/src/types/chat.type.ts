import type { Message } from "@/types/message.type";

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
}
