export type MessageRole = "user" | "assistant" | "system";

export interface Citation {
  paperId: string;
  paperTitle: string;
  author: string;
  year: number;
  section?: string;
  pageNumber?: number;
  snippet?: string;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  citations?: Citation[];
  createdAt: string;
}

export interface AIConversation {
  id: string;
  userId: string;
  title: string;
  messages: AIMessage[];
  createdAt: string;
  updatedAt: string;
}
