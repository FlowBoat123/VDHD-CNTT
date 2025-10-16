import React, { useEffect, useRef } from "react";
import { X, Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";

function cn(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export type Movie = {
  id?: string;
  title: string;
  year?: number | string;
  release_date?: string;
  production?: string;
  description?: string;
  posterUrl?: string;
  genres?: string[];
  runtimeMins?: number;
  rating?: string;
  homepageUrl?: string;
};

export type MovieDetailProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movie: Movie | null;
  isSaved?: boolean;
  onToggleSave?: (movieId?: string) => void;
  actions?: React.ReactNode;
  loading?: boolean;
  className?: string;
};

export function MovieDetailWindow({
  open,
  onOpenChange,
  movie,
  isSaved,
  onToggleSave,
  actions,
  loading,
  className,
}: MovieDetailProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open && panelRef.current) panelRef.current.focus();
  }, [open]);

  if (!open) return null;

  const safeMovie: Movie = movie ?? {
    id: undefined,
    title: "null",
    year: "null",
    description: "null",
    posterUrl: undefined,
    genres: undefined,
    runtimeMins: undefined,
    rating: undefined,
    homepageUrl: undefined,
  };

  const metaBits: string[] = [];
  if (safeMovie.rating) metaBits.push(String(safeMovie.rating));
  if (safeMovie.runtimeMins) metaBits.push(`${safeMovie.runtimeMins} min`);
  if (safeMovie.genres?.length) metaBits.push(safeMovie.genres.join(" • "));

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-6"
      aria-modal
      role="dialog"
      aria-label={`Details for ${safeMovie.title}`}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative w-[min(96vw,1200px)] max-w-7xl bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden",
          className
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <Loader size={48} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-8 p-8">
        {loading ? null : (
          <>
          <div className="flex flex-col items-stretch">
            <div className="aspect-[2/3] w-full overflow-hidden rounded-xl shadow-sm border border-black/10 dark:border-white/10 bg-neutral-100 dark:bg-neutral-800">
              {safeMovie.posterUrl ? (
                <img
                  src={safeMovie.posterUrl}
                  alt={`${safeMovie.title} poster`}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="h-full w-full grid place-items-center text-neutral-500">No poster</div>
              )}
            </div>

            <button
              onClick={() => onToggleSave?.(safeMovie.id)}
              className={cn(
                "mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.98]",
                isSaved
                  ? "border-emerald-600/20 bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              )}
              aria-pressed={isSaved}
            >
              {isSaved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
              {isSaved ? "Saved" : "Save"}
            </button>
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight break-words">
                  {safeMovie.title}
                  {safeMovie.year ? (
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400 font-normal text-2xl">({safeMovie.year})</span>
                  ) : null}
                </h2>
                {safeMovie.production && (
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">{safeMovie.production ? safeMovie.production : ""}</span>
                  </p>
                )}

                {metaBits.length > 0 && (
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
                    {metaBits.join(" • ")}
                  </p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">{actions}</div>
            </div>

            {safeMovie.homepageUrl && (
              <a
                href={safeMovie.homepageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
              >
                Official site <ExternalLink className="size-4" />
              </a>
            )}

            <div className="mt-5 text-base leading-7 text-neutral-800 dark:text-neutral-200 whitespace-pre-line">
              {safeMovie.description ?? "No description provided."}
            </div>
          </div>
          </>
        )}

        </div>

        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 p-2 rounded-xl bg-white/70 dark:bg-neutral-900/70 border border-black/10 dark:border-white/10 hover:bg-white dark:hover:bg-neutral-800 shadow"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
