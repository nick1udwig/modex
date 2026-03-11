export type ChatStatus = 'idle' | 'running';
export type AccessMode = 'read-only' | 'workspace-write';

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
  status: ChatStatus;
}

export interface ChatThread extends ChatSummary {
  cwd: string;
  messages: Message[];
  tokenUsageLabel: string | null;
}

export interface ChatTab {
  chatId: string;
  status: ChatStatus;
}

export interface ChatRuntimeSettings {
  accessMode: AccessMode;
  roots: string[];
}

export interface CreateChatPayload {
  settings?: ChatRuntimeSettings;
}

export interface SendMessagePayload {
  chatId: string;
  content: string;
  settings?: ChatRuntimeSettings;
}

export type RemoteThreadEvent =
  | {
      type: 'summary';
      summary: ChatSummary;
    }
  | {
      type: 'thread';
      thread: ChatThread;
    }
  | {
      type: 'status';
      chatId: string;
      status: ChatStatus;
    }
  | {
      type: 'message-started';
      chatId: string;
      message: Message;
    }
  | {
      type: 'message-delta';
      chatId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: 'message-completed';
      chatId: string;
      message: Message;
    }
  | {
      type: 'token-usage';
      chatId: string;
      label: string | null;
    }
  | {
      type: 'error';
      chatId?: string;
      message: string;
    };

export interface RemoteAppClient {
  listChats(): Promise<ChatSummary[]>;
  getChat(chatId: string): Promise<ChatThread>;
  createChat(payload?: CreateChatPayload): Promise<ChatThread>;
  sendMessage(payload: SendMessagePayload): Promise<ChatThread>;
  subscribe(listener: (event: RemoteThreadEvent) => void): () => void;
}
