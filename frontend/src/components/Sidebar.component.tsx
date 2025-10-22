import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plus, Search, MessageSquare } from "lucide-react";
import type { Chat } from "@/types/chat.type";
import ChatListItem from "./ChatListItem.component";
import { TypingIndicator } from "@/components/TypingIndicator.component";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  chats: Chat[];
  activeChat: string | null;
  onChatSelect: (chatId: string) => void;
  onNewChat: () => void;
  onChatDelete: (chatId: string) => void;
  onSearchUse: () => void;
  onOpenCollection?: () => void;
}

export function Sidebar({
  isOpen,
  onToggle,
  chats,
  activeChat,
  onChatSelect,
  onNewChat,
  onSearchUse,
  onOpenCollection,
  onChatDelete,
}: SidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex w-64 border-r bg-muted/10 flex-col">
        <div className="p-4 border-b">
          <Button onClick={onNewChat} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Cuộc trò chuyện mới
          </Button>
        </div>

        <div className="p-4 border-b space-y-2">
          <Button onClick={onSearchUse} className="w-full">
            <Search className="h-4 w-4 mr-2" />
            Tìm kiếm
          </Button>

          <Button onClick={() => onOpenCollection?.()} className="w-full">
            <MessageSquare className="h-4 w-4 mr-2" />
            Bộ sưu tập
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {chats.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">Chưa có cuộc trò chuyện</p>
              </div>
            ) : (
              chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  activeChat={activeChat}
                  onChatSelect={onChatSelect}
                  onDelete={onChatDelete}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Mobile Sheet */}
      <Sheet open={isOpen} onOpenChange={onToggle}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Cuộc trò chuyện</SheetTitle>
          </SheetHeader>

          <div className="p-4 border-b">
            <Button onClick={onNewChat} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Cuộc trò chuyện mới
            </Button>
          </div>

          <div className="p-4 border-b space-y-2">
            <Button onClick={onSearchUse} className="w-full">
              <Search className="h-4 w-4 mr-2" />
              Tìm kiếm
            </Button>

            <Button onClick={() => onOpenCollection?.()} className="w-full">
              <MessageSquare className="h-4 w-4 mr-2" />
              Bộ sưu tập
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {chats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">Chưa có cuộc trò chuyện</p>
                </div>
              ) : (
                chats.map((chat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    activeChat={activeChat}
                    onChatSelect={onChatSelect}
                    onDelete={onChatDelete}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
