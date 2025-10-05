export interface Message {
  id: string;
  content: string;
  sender: "user" | "assistant";
  timestamp: string;
  //   isLoading?: boolean;
  movies?: Movie[];
}

export interface Movie {
  id: number;
  title: string;
  subtitle?: string;
  poster?: string;
  url?: string;
}
