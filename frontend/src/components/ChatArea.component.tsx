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
import { useState } from "react";
import { Loader } from "./ai-elements/loader";
import { MovieCard } from "@/components/MovieCard.component";

export interface ChatAreaProps {
  messages: MessageType[];
  isLoading?: boolean;

  onClickMovieCard?: (id: number) => void;
}

export function ChatArea({ messages, isLoading, onClickMovieCard }: ChatAreaProps) {
  const hasMessages = messages.length > 0;

  // per-message pagination state
  const [suggestionPageMap, setSuggestionPageMap] = useState<Record<string, number>>({});
  const PAGE_SIZE = 8;
  const MAX_PAGES = 3;
  const MAX_SUGGESTIONS = 40;

  const getPage = (messageId: string | number) => {
    const key = String(messageId);
    return suggestionPageMap[key] ?? 1;
  };

  const setPage = (messageId: string | number, page: number) => {
    const key = String(messageId);
    setSuggestionPageMap((prev) => ({ ...prev, [key]: page }));
  };

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
            <Message key={m.id} from={m.sender}>
              <MessageContent variant="contained">
                {m.sender === "user" ? (
                  m.content
                ) : (
                  <div className="space-y-3">
                    {m.card ? (
                      <InfoCard
                        card={m.card}
                        onClick={onClickMovieCard ? ((id?: string | number) => {
                          try {
                            if (m.card?.type === "movie") onClickMovieCard(Number(id));
                          } catch (e) {
                            // ignore
                          }
                        }) : undefined}
                      />
                    ) : (
                      <Response>{m.content}</Response>
                    )}

                    {m.movieSuggestions && m.movieSuggestions.length > 0 && (() => {
                      const all = m.movieSuggestions || [];
                      const limited = all.slice(0, Math.min(all.length, MAX_SUGGESTIONS));
                      const totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(limited.length / PAGE_SIZE)));
                      let currentPage = getPage(m.id);
                      if (currentPage > totalPages) currentPage = totalPages;
                      const start = (currentPage - 1) * PAGE_SIZE;
                      const pageItems = limited.slice(start, start + PAGE_SIZE);

                      return (
                        <div>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {pageItems.map((movie) => (
                              <MovieCard onClick={onClickMovieCard ? () => onClickMovieCard(movie.id) : undefined} key={movie.id} movie={movie} />
                            ))}
                          </div>

                          {totalPages > 1 && (
                            <div className="flex justify-end mt-2">
                              <div className="flex items-center space-x-2">
                                <div className="text-sm text-slate-500">{`${currentPage}/${totalPages}`}</div>
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
                      );
                    })()}
                  </div>
                )}
              </MessageContent>
            </Message>
          ))
        ) : (
          <ConversationEmptyState className="pb-24" />
        )}
      </ConversationContent>

      {/* stick-to-bottom button */}
      <ConversationScrollButton />
    </Conversation>
  );
}
