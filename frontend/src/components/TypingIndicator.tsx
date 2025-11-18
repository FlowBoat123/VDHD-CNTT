export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1">
      {/* We can remove the 'bg-muted' bubble for a cleaner, 
        more minimalist look, letting the dots float in the message bubble.
        We'll also use 'animate-pulse' for a fading effect.
      */}
      <div className="flex gap-1.5 p-2">
        <div
          className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"
          style={{ animationDelay: "0ms", animationDuration: "1s" }}
        />
        <div
          className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"
          style={{ animationDelay: "200ms", animationDuration: "1s" }}
        />
        <div
          className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"
          style={{ animationDelay: "400ms", animationDuration: "1s" }}
        />
      </div>
    </div>
  );
}
