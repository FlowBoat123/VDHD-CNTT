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

    const handleClick = () => {
        try {
            if (card.id != null) onClick?.(card.id);
        } catch (e) {
            // swallow
        }
    };

    // image-left layout: poster left, content right
    if (card.layout === "image-left") {
        return (
            <div className={className}>
                <div className="flex items-start gap-6">
                    {card.poster ? (
                        <div className="relative">
                            {card.id && onClick ? (
                                <button onClick={handleClick} className="p-0 m-0">
                                    <img src={card.poster} alt={card.title || "poster"} className="w-36 md:w-44 aspect-[2/3] object-cover rounded-md" />
                                </button>
                            ) : (
                                <img src={card.poster} alt={card.title || "poster"} className="w-36 md:w-44 aspect-[2/3] object-cover rounded-md" />
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
                        {/* Visible link/button for IMDB or test (YouTube) so user can click easily */}
                        {card.text ? <Response>{card.text}</Response> : <Response>{/* fallback to empty */}</Response>}
                        <div className="mb-2">
                            {card.imdbUrl ? (
                                <a href={card.imdbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                    Mở trên IMDb
                                </a>
                            ) : (
                                <a href="https://www.youtube.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                    (Test) Mở YouTube
                                </a>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        );
    }

    // default/image-top layout: poster above title + text
    return (
        <div className={className}>
            <div className="block rounded-md overflow-hidden border bg-background hover:shadow max-w-md">
                {card.poster ? (
                    <div className="relative">
                        {card.id && onClick ? (
                            <button onClick={handleClick} className="w-full p-0 m-0">
                                <img src={card.poster} alt={card.title || "poster"} className="w-full aspect-[2/3] object-cover" />
                            </button>
                        ) : (
                            <img src={card.poster} alt={card.title || "poster"} className="w-full aspect-[2/3] object-cover" />
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
                        {card.imdbUrl ? (
                            <a href={card.imdbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                Mở trên IMDb
                            </a>
                        ) : (
                            <a href="https://www.youtube.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                (Test) Mở YouTube
                            </a>
                        )}
                        <div className="mt-2">{card.text ? <Response>{card.text}</Response> : <Response>{/* fallback */}</Response>}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default InfoCard;
