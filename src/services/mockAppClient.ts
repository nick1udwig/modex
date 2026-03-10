import type { ChatThread, Message, RemoteAppClient, SendMessagePayload } from '../app/types';

const STORAGE_KEY = 'modex.mock.state.v1';

interface PersistedState {
  chats: ChatThread[];
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

const seedState = (): PersistedState => {
  const now = new Date();

  const starter = (offsetMinutes: number) =>
    new Date(now.getTime() - offsetMinutes * 60_000).toISOString();

  return {
    chats: [
      {
        id: 'chat-deploy',
        title: 'Deploy checks',
        updatedAt: starter(12),
        preview: 'Add a preflight checklist for the VPS deploy.',
        messages: [
          {
            id: createId('msg'),
            role: 'system',
            content: 'You are connected to the remote Modex app-server prototype.',
            createdAt: starter(18),
          },
          {
            id: createId('msg'),
            role: 'user',
            content: 'Draft a quick checklist before I push the next deploy.',
            createdAt: starter(14),
          },
          {
            id: createId('msg'),
            role: 'assistant',
            content:
              'Before deploy: verify env vars, restart policy, healthcheck endpoint, and rolling log tail access on the VPS.',
            createdAt: starter(12),
          },
        ],
      },
      {
        id: 'chat-api',
        title: 'API contract notes',
        updatedAt: starter(56),
        preview: 'Sketch a boundary between the SPA and the VPS app-server.',
        messages: [
          {
            id: createId('msg'),
            role: 'system',
            content: 'Remote backend schema is not final yet.',
            createdAt: starter(70),
          },
          {
            id: createId('msg'),
            role: 'user',
            content: 'How should the frontend isolate the app-server API for now?',
            createdAt: starter(58),
          },
          {
            id: createId('msg'),
            role: 'assistant',
            content:
              'Keep a RemoteAppClient interface with list/get/create/send methods so a mock transport and the real VPS transport can share the same UI state code.',
            createdAt: starter(56),
          },
        ],
      },
      {
        id: 'chat-ui',
        title: 'Mobile shell ideas',
        updatedAt: starter(108),
        preview: 'Tabs stay separate from the persistent sidebar list.',
        messages: [
          {
            id: createId('msg'),
            role: 'user',
            content: 'Summarize the UX model for chats versus open tabs.',
            createdAt: starter(110),
          },
          {
            id: createId('msg'),
            role: 'assistant',
            content:
              'Chats live in the sidebar as durable history. Opening one creates a working tab. Tabs can be closed independently without deleting the underlying chat thread.',
            createdAt: starter(108),
          },
        ],
      },
    ],
  };
};

const loadState = (): PersistedState => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    const seeded = seedState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

const saveState = (state: PersistedState) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const summarize = (messages: Message[]) => {
  const lastUserFacing = [...messages].reverse().find((message) => message.role !== 'system');
  return lastUserFacing?.content ?? 'New chat';
};

const generateAssistantReply = (content: string) =>
  [
    `Remote app-server stub received: "${content}".`,
    'Next contract step: replace this mock client with a VPS-backed transport.',
  ].join(' ');

const cloneThread = (thread: ChatThread): ChatThread => ({
  ...thread,
  messages: thread.messages.map((message) => ({ ...message })),
});

export class MockAppClient implements RemoteAppClient {
  async listChats() {
    await wait(180);
    const state = loadState();
    return [...state.chats]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, updatedAt, preview }) => ({ id, title, updatedAt, preview }));
  }

  async getChat(chatId: string) {
    await wait(120);
    const state = loadState();
    const chat = state.chats.find((item) => item.id === chatId);

    if (!chat) {
      throw new Error(`Chat ${chatId} not found`);
    }

    return cloneThread(chat);
  }

  async createChat() {
    await wait(140);
    const state = loadState();
    const createdAt = new Date().toISOString();
    const chat: ChatThread = {
      id: createId('chat'),
      title: 'New session',
      updatedAt: createdAt,
      preview: 'Start a new request',
      messages: [
        {
          id: createId('msg'),
          role: 'system',
          content: 'New remote workspace session created. Ask for the next task.',
          createdAt,
        },
      ],
    };

    state.chats = [chat, ...state.chats];
    saveState(state);
    return cloneThread(chat);
  }

  async sendMessage({ chatId, content }: SendMessagePayload) {
    const state = loadState();
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat) {
      throw new Error(`Chat ${chatId} not found`);
    }

    const submittedAt = new Date().toISOString();
    chat.messages.push({
      id: createId('msg'),
      role: 'user',
      content,
      createdAt: submittedAt,
    });
    chat.updatedAt = submittedAt;
    chat.preview = content;
    if (chat.title === 'New session') {
      chat.title = content.slice(0, 32) || 'Untitled chat';
    }
    saveState(state);

    await wait(1100);

    const completedAt = new Date().toISOString();
    chat.messages.push({
      id: createId('msg'),
      role: 'assistant',
      content: generateAssistantReply(content),
      createdAt: completedAt,
    });
    chat.updatedAt = completedAt;
    chat.preview = summarize(chat.messages);
    saveState(state);

    return cloneThread(chat);
  }
}

export const createMockAppClient = () => new MockAppClient();
