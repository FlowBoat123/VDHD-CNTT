import { useState } from "react";
import type { CardPayload } from "@/types/message.type";
import { Response } from "@/components/ai-elements/response";
import { ExternalLink } from "lucide-react";

export interface InfoCardProps {
    card: CardPayload;
    onClick?: (id?: number | string) => void;
    className?: string;
}

export function InfoCard({ card, onClick, className }: InfoCardProps) {
    if (!card) return null;

    const [expanded, setExpanded] = useState(false);

    const handleClick = () => {
        try {
            if (card.id != null) onClick?.(card.id);
        } catch (e) {
            // swallow
        }
    };

    // Normalize text and split into paragraphs
    const fullText = String(card.text || "").trim();
    const paragraphs = fullText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    const PREVIEW_COUNT = 4;
    const previewParagraphs = paragraphs.slice(0, PREVIEW_COUNT);
    const hasMore = paragraphs.length > PREVIEW_COUNT;

    // Build IMDb "more" anchor when possible
    let imdbMoreUrl: string | null = null;
    if (card.imdbUrl) {
        try {
            const u = new URL(card.imdbUrl);
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
                const kind = parts[0];
                const id = parts[1];
                if (kind === "name") imdbMoreUrl = `https://www.imdb.com/name/${id}/bio/#mini_bio`;
                else if (kind === "title") imdbMoreUrl = `https://www.imdb.com/title/${id}/plotsummary`;
            }
        } catch (e) {
            imdbMoreUrl = card.imdbUrl || null;
        }
    }

    const previewText = previewParagraphs.join("\n\n");
    const previewBlock = <Response>{previewText}</Response>;
    const fullTextBlock = <Response>{fullText}</Response>;

    // image-left layout
    if (card.layout === "image-left") {
        return (
            <div className={className}>
                <div className="flex items-start gap-6">
                    {card.poster ? (
                        <div className="relative">
                            {card.id && onClick ? (
                                <button onClick={handleClick} className="p-0 m-0">
                                    <img
                                        src={card.poster}
                                        alt={card.title || "poster"}
                                        className="w-36 md:w-44 aspect-[2/3] object-cover rounded-md transition-transform duration-300 hover:scale-105 cursor-pointer"
                                    />
                                </button>
                            ) : (
                                <img
                                    src={card.poster}
                                    alt={card.title || "poster"}
                                    className="w-36 md:w-44 aspect-[2/3] object-cover rounded-md transition-transform duration-300 hover:scale-105 cursor-pointer"
                                />
                            )}

                            {card.imdbUrl ? (
                                <a
                                    href={card.imdbUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-white"
                                    aria-label="Open on IMDb"
                                >
                                    <ExternalLink className="size-4" />
                                </a>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="flex-1">
                        {card.title ? <div className="font-medium mb-1">{card.title}</div> : null}
                        {card.subtitle ? <div className="text-sm text-muted-foreground mb-2">{card.subtitle}</div> : null}

                        {card.text ? (
                            <div>
                                {!expanded ? (
                                    <div>
                                        {previewBlock}
                                        {hasMore ? (
                                            imdbMoreUrl ? (
                                                <a href={imdbMoreUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline mt-1 inline-block">
                                                    Xem thêm trên IMDb
                                                </a>
                                            ) : (
                                                <button onClick={() => setExpanded(true)} className="text-sm text-blue-600 hover:underline mt-1">
                                                    Xem thêm
                                                </button>
                                            )
                                        ) : null}
                                    </div>
                                ) : (
                                    <div>
                                        {fullTextBlock}
                                        {hasMore ? (
                                            imdbMoreUrl ? (
                                                <a href={imdbMoreUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline mt-1 inline-block">
                                                    Xem thêm trên IMDb
                                                </a>
                                            ) : (
                                                <button onClick={() => setExpanded(false)} className="text-sm text-blue-600 hover:underline mt-1">
                                                    Thu gọn
                                                </button>
                                            )
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Response>{""}</Response>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // image-top / default layout
    return (
        <div className={className}>
            <div className="block rounded-md overflow-hidden border bg-background hover:shadow max-w-md">
                {card.poster ? (
                    <div className="relative">
                        {card.id && onClick ? (
                            <button onClick={handleClick} className="w-full p-0 m-0">
                                <img src={card.poster} alt={card.title || "poster"} className="w-full aspect-[2/3] object-cover transition-transform duration-300 hover:scale-105 cursor-pointer" />
                            </button>
                        ) : (
                            <img src={card.poster} alt={card.title || "poster"} className="w-full aspect-[2/3] object-cover transition-transform duration-300 hover:scale-105 cursor-pointer" />
                        )}

                        {card.imdbUrl ? (
                            <a
                                href={card.imdbUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-white"
                                aria-label="Open on IMDb"
                            >
                                <ExternalLink className="size-4" />
                            </a>
                        ) : null}
                    </div>
                ) : null}

                <div className="p-2">
                    {card.title ? <div className="font-medium line-clamp-2">{card.title}</div> : null}
                    {card.subtitle ? <div className="text-xs text-muted-foreground mt-1">{card.subtitle}</div> : null}

                    <div className="mt-2">
                        {card.text ? (
                            !expanded ? (
                                <div>
                                    {previewBlock}
                                    {hasMore ? (
                                        imdbMoreUrl ? (
                                            <a href={imdbMoreUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline mt-1 inline-block">
                                                Xem thêm trên IMDb
                                            </a>
                                        ) : (
                                            <button onClick={() => setExpanded(true)} className="text-sm text-blue-600 hover:underline mt-1">
                                                Xem thêm
                                            </button>
                                        )
                                    ) : null}
                                </div>
                            ) : (
                                <div>
                                    {fullTextBlock}
                                    {hasMore ? (
                                        imdbMoreUrl ? (
                                            <a href={imdbMoreUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline mt-1 inline-block">
                                                Xem thêm trên IMDb
                                            </a>
                                        ) : (
                                            <button onClick={() => setExpanded(false)} className="text-sm text-blue-600 hover:underline mt-1">
                                                Thu gọn
                                            </button>
                                        )
                                    ) : null}
                                </div>
                            )
                        ) : (
                            <Response>{""}</Response>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default InfoCard;
