import { Send } from "lucide-react";
import { useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
} from "./ai-elements/prompt-input";

interface MessageInputProps {
  // callback when user sends a message
  onSend: (message: string) => void;
  // disable if bot is thinking/responding
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const [message, setMessage] = useState("");

  const handleSubmit = (_: any, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(undefined, e as unknown as React.FormEvent<HTMLFormElement>);
    }
  };

  return (
    <div className="p-4 border-border bg-background">
      <PromptInput
        onSubmit={handleSubmit}
        className="flex gap-2 max-w-4xl mx-auto"
      >
        <div className="flex-1 relative">
          <PromptInputBody>
            <PromptInputTextarea
              placeholder="Hỏi tôi về bất kỳ bộ phim nào..."
              className="resize-none min-h-[44px] max-h-32 pr-12 pt-2.5"
              rows={1}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled} // 🔒 lock textarea when disabled
            />
            <PromptInputSubmit
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
              disabled={!message.trim() || disabled} // 🔒 lock button too
              status={disabled ? "streaming" : "ready"} // show spinner state if needed
            >
              <Send className="h-4 w-4" />
            </PromptInputSubmit>
          </PromptInputBody>
        </div>
      </PromptInput>

      <p className="text-xs text-muted-foreground text-center mt-2 max-w-4xl mx-auto">
        FilmAI có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.
      </p>
    </div>
  );
}
