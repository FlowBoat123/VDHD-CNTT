import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import type { Message as MessageType } from "@/types/message.type";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { Loader } from "./ai-elements/loader";
import { MovieCard } from "@/components/MovieCard.component";
import { TypingIndicator } from "./TypingIndicator";
import { Actions, Action } from "@/components/ai-elements/actions";
import {
  CopyIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";

export interface ChatAreaProps {
  messages: MessageType[];
  isLoading?: boolean;
  isTyping?: boolean;

  onClickMovieCard?: (id: number) => void;
}

export function ChatArea({
  messages,
  isLoading,
  isTyping,
  onClickMovieCard,
}: ChatAreaProps) {
  const hasMessages = messages.length > 0;

  return (
    <Conversation className="flex-1 flex flex-col">
      <ConversationContent className="flex-1 overflow-y-auto max-w-4xl mx-auto space-y-0 pb-24">
        {isLoading ? (
          // 👉 show loader while fetching messages
          <div className="flex justify-center items-center h-full">
            <Loader size={32} />
          </div>
        ) : hasMessages ? (
          messages.map((m) => (
            <div>
              <Message key={m.id} from={m.sender}>
                <MessageContent variant="contained">
                  {m.sender === "user" ? (
                    m.content
                  ) : (
                    <div className="space-y-3">
                      <Response>{m.content}</Response>
                      {m.movieSuggestions && m.movieSuggestions.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                          {m.movieSuggestions.map((movie) => (
                            <MovieCard
                              onClick={
                                onClickMovieCard
                                  ? () => onClickMovieCard(movie.id)
                                  : undefined
                              }
                              key={movie.id}
                              movie={movie}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </MessageContent>
              </Message>
              <Actions>
                {m.sender === "user" ? null : (
                  <Actions>
                    <Action label="Like">
                      <ThumbsUpIcon className="size-3" />
                    </Action>
                    <Action label="Dislike">
                      <ThumbsDownIcon className="size-3" />
                    </Action>
                    <Action label="Retry">
                      <RefreshCcwIcon className="size-3" />
                    </Action>
                    <Action label="Copy">
                      <CopyIcon className="size-3" />
                    </Action>
                  </Actions>
                )}
              </Actions>
            </div>
          ))
        ) : (
          <ConversationEmptyState className="pb-24" />
        )}

        {isTyping && <TypingIndicator />}
      </ConversationContent>

      {/* stick-to-bottom button */}
      <ConversationScrollButton />
    </Conversation>
  );
}
