export type ChatStatus = 'idle' | 'running';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
}

export interface ChatThread extends ChatSummary {
  messages: Message[];
}

export interface ChatTab {
  chatId: string;
  status: ChatStatus;
}

export interface SendMessagePayload {
  chatId: string;
  content: string;
}

export interface RemoteAppClient {
  listChats(): Promise<ChatSummary[]>;
  getChat(chatId: string): Promise<ChatThread>;
  createChat(): Promise<ChatThread>;
  sendMessage(payload: SendMessagePayload): Promise<ChatThread>;
}
