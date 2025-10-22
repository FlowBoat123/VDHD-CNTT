// frontend/src/components/TypingIndicator.component.tsx
import React from "react";
import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  className?: string;
}

export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center space-x-1.5 p-2", // Use p-2 to give it some padding
        className
      )}
    >
      <style>
        {`
          @keyframes bounce {
            0%, 100% {
              transform: translateY(0);
              opacity: 0.7;
            }
            50% {
              transform: translateY(-50%);
              opacity: 1;
            }
          }
          .dot {
            animation: bounce 1.2s infinite;
          }
          .dot-1 {
            animation-delay: 0s;
          }
          .dot-2 {
            animation-delay: 0.2s;
          }
          .dot-3 {
            animation-delay: 0.4s;
          }
        `}
      </style>
      <div className="dot dot-1 size-2 rounded-full bg-current" />
      <div className="dot dot-2 size-2 rounded-full bg-current" />
      <div className="dot dot-3 size-2 rounded-full bg-current" />
    </div>
  );
}
