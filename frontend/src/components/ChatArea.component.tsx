import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import type { Message as MessageType } from "@/types/message.type";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import InfoCard from "@/components/InfoCard.component";
import { useState, useMemo } from "react";
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

  // per-message pagination state
  const [suggestionPageMap, setSuggestionPageMap] = useState<Record<string, number>>({});
  const PAGE_SIZE = 8;

  const getPage = (messageId: string | number) => {
    const key = String(messageId);
    return suggestionPageMap[key] ?? 1;
  };

  const setPage = (messageId: string | number, page: number) => {
    const key = String(messageId);
    setSuggestionPageMap((prev) => ({ ...prev, [key]: page }));
  };

  // Precompute suggestion pools per message to avoid reshuffling on every render.
  const suggestionsByMessage = useMemo(() => {
    const map: Record<string, { displayed: any[] }> = {};
    for (const m of messages) {
      // Use the persisted suggestions from the message directly. These should already be
      // deduped and shuffled by the backend. Cap to DISPLAY_CAP to match frontend pagination.
      const raw = Array.isArray(m.movieSuggestions) ? m.movieSuggestions : [];
      const DISPLAY_CAP = 24;
      const displayed = raw.slice(0, Math.min(DISPLAY_CAP, raw.length));
      map[String(m.id)] = { displayed };
    }
    return map;
  }, [messages]);

  return (
    <Conversation className="flex-1 flex flex-col">
      <ConversationContent className="flex-1 overflow-y-auto max-w-4xl mx-auto space-y-0 pb-24">
        {isLoading ? (
          // 👉 show loader while fetching messages
          <div className="flex justify-center items-center h-full">
            <Loader size={32} />
          </div>
        ) : hasMessages ? (
          messages.map((m) => {
            // use precomputed displayed pool for this message (deduped, shuffled, capped)
            const key = String(m.id);
            const displayed = suggestionsByMessage[key]?.displayed || [];
            const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
            let currentPage = getPage(m.id);
            if (currentPage < 1) currentPage = 1;
            if (currentPage > totalPages) currentPage = totalPages;

            const start = (currentPage - 1) * PAGE_SIZE;
            const pageItems = displayed.slice(start, start + PAGE_SIZE);

            return (
              <div key={m.id}>
                <Message from={m.sender}>
                  <MessageContent variant="contained">
                    {m.sender === "user" ? (
                      m.content
                    ) : (
                      <div className="space-y-3">
                        {m.card ? (
                          <InfoCard
                            card={m.card}
                            onClick={
                              onClickMovieCard
                                ? (id?: string | number) => {
                                  try {
                                    if (m.card?.type === "movie" && id != null) {
                                      onClickMovieCard(Number(id));
                                    }
                                  } catch (e) {
                                    // ignore
                                  }
                                }
                                : undefined
                            }
                          />
                        ) : (
                          <Response>{m.content}</Response>
                        )}

                        {m.movieSuggestions && m.movieSuggestions.length > 0 && (
                          <div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                              {pageItems.map((movie) => (
                                <MovieCard
                                  onClick={onClickMovieCard ? () => onClickMovieCard(movie.id) : undefined}
                                  key={movie.id}
                                  movie={movie}
                                />
                              ))}
                            </div>

                            {/* pagination controls: right-aligned directly under the response */}
                            {displayed.length > 0 && (
                              <div className="flex justify-end mt-2">
                                <div className="flex items-center space-x-2 text-sm text-slate-500">
                                  <div className="mr-2">{`${currentPage}/${totalPages}`}</div>
                                  <button
                                    type="button"
                                    onClick={() => setPage(m.id, Math.max(1, currentPage - 1))}
                                    disabled={currentPage <= 1}
                                    className={`w-8 h-8 flex items-center justify-center rounded-md ${currentPage <= 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-100"}`}
                                  >
                                    &lt;
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPage(m.id, Math.min(totalPages, currentPage + 1))}
                                    disabled={currentPage >= totalPages}
                                    className={`w-8 h-8 flex items-center justify-center rounded-md ${currentPage >= totalPages ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-100"}`}
                                  >
                                    &gt;
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </MessageContent>
                </Message>

                {/* Actions for assistant/system messages */}
                {m.sender === "user" ? null : (
                  <div className="flex items-center justify-between">
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

                    {/* pagination intentionally empty in the actions row; controls are rendered under the response */}
                  </div>
                )}
              </div>
            )
          })
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
