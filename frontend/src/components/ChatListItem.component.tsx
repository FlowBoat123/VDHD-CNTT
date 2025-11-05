import { MoreVertical, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Chat } from "@/types/chat.type";

interface ChatListItemProps {
  chat: Chat;
  activeChat: string | null;
  onChatSelect: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

export default function ChatListItem({
  chat,
  activeChat,
  onChatSelect,
  onDelete,
}: ChatListItemProps) {
  return (
    <div className="group relative w-full">
      <Button
        key={chat.id}
        variant={activeChat === chat.id ? "secondary" : "ghost"}
        className="w-full h-auto py-2 px-3 flex items-center gap-2 justify-start text-left rounded-lg transition-colors duration-100 hover:bg-muted/60"
        onClick={() => onChatSelect(chat.id)}
      >
        {/* Chat title */}
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-left text-foreground">
            {chat.title || "New chat"}
          </div>
        </div>
      </Button>

      {/* 3-dot menu only visible on hover (like ChatGPT) */}
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreVertical className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onClick={() => onDelete(chat.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Xóa cuộc trò chuyện
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
