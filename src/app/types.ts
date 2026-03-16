export type ChatStatus = 'idle' | 'running';
export type AccessMode = 'read-only' | 'workspace-write';
export type JsonRpcId = number | string;
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type MessageRole = 'system' | 'user' | 'assistant';
export type ActivityKind = 'command' | 'file-change' | 'plan' | 'reasoning';
export type ActivityStatus = 'completed' | 'failed' | 'in-progress';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  turnId: string | null;
}

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  summary: string;
  detail: string;
  status: ActivityStatus;
  title: string;
  turnId: string;
}

export interface ChatSummary {
  cwd: string;
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  status: ChatStatus;
}

export interface ChatThread extends ChatSummary {
  activity: ActivityEntry[];
  cwd: string;
  messages: Message[];
  tokenUsageLabel: string | null;
}

export interface ChatTab {
  chatId: string;
  hasUnreadCompletion: boolean;
  status: ChatStatus;
}

export interface ChatRuntimeSettings {
  accessMode: AccessMode;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  roots: string[];
}

export interface CreateChatPayload {
  settings?: ChatRuntimeSettings;
}

export interface PendingAttachment {
  id: string;
  kind: 'image' | 'text-file';
  mimeType: string;
  name: string;
  text?: string;
  url?: string;
}

export interface SendMessagePayload {
  attachments?: PendingAttachment[];
  chatId: string;
  content: string;
  settings?: ChatRuntimeSettings;
}

export interface ModelOption {
  defaultReasoningEffort: ReasoningEffort | null;
  displayName: string;
  id: string;
  isDefault: boolean;
  supportedReasoningEfforts: ReasoningEffort[];
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline';

export interface ApprovalRequest {
  kind: 'approval';
  requestId: JsonRpcId;
  chatId: string;
  turnId: string;
  title: string;
  message: string;
  detailLines: string[];
  allowSessionDecision: boolean;
}

export interface UserInputRequestOption {
  description: string;
  label: string;
}

export interface UserInputRequestQuestion {
  header: string;
  id: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserInputRequestOption[];
  question: string;
}

export interface UserInputRequest {
  kind: 'user-input';
  requestId: JsonRpcId;
  chatId: string;
  turnId: string;
  title: string;
  questions: UserInputRequestQuestion[];
}

export type InteractionRequest = ApprovalRequest | UserInputRequest;

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
      type: 'interaction-request';
      request: InteractionRequest;
    }
  | {
      type: 'interaction-cleared';
      chatId: string;
    }
  | {
      type: 'error';
      chatId?: string;
      message: string;
    };

export interface RemoteAppClient {
  listChats(): Promise<ChatSummary[]>;
  listModels(): Promise<ModelOption[]>;
  getChat(chatId: string): Promise<ChatThread>;
  createChat(payload?: CreateChatPayload): Promise<ChatThread>;
  sendMessage(payload: SendMessagePayload): Promise<ChatThread>;
  interruptTurn(chatId: string): Promise<void>;
  respondToApproval(request: ApprovalRequest, decision: ApprovalDecision): Promise<void>;
  submitUserInput(request: UserInputRequest, answers: Record<string, string[]>): Promise<void>;
  subscribe(listener: (event: RemoteThreadEvent) => void): () => void;
}
