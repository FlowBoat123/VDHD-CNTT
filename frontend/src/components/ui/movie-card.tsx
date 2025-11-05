import { cn } from "@/lib/utils";

export interface MovieCardProps {
  id: number;
  title: string;
  subtitle?: string;
  poster?: string;
  url?: string;
  className?: string;
}

export function MovieCard({ title, subtitle, poster, url, className }: MovieCardProps) {
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group block rounded-md overflow-hidden border bg-background hover:shadow",
        className
      )}
    >
      {poster ? (
        <img src={poster} alt={title} className="w-full aspect-[2/3] object-cover" />
      ) : null}
      <div className="p-2">
        <div className="font-medium line-clamp-2">{title}</div>
        {subtitle ? (
          <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
        ) : null}
      </div>
    </a>
  );
}


