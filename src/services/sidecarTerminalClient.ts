import type { CreateTerminalSessionPayload, RemoteTerminalClient, TerminalSessionSummary } from '../app/types';
import { buildSidecarWebSocketUrl } from './sidecarClient';

interface TerminalRequest {
  cwd?: string;
  id: string;
  target?: string;
  type: 'terminal.session.create' | 'terminal.session.inspect' | 'terminal.sessions.list';
}

interface TerminalErrorPayload {
  code?: string;
  message?: string;
}

interface TerminalResponse {
  error?: TerminalErrorPayload;
  id?: string;
  session?: TerminalSessionSummary;
  sessions?: TerminalSessionSummary[];
  type?: string;
}

const toError = (message: string, details?: TerminalErrorPayload) => {
  const code = details?.code ? `${details.code}: ` : '';
  return new Error(`${code}${details?.message ?? message}`);
};

class SidecarTerminalClient implements RemoteTerminalClient {
  private connectPromise: Promise<WebSocket> | null = null;
  private pending = new Map<string, { reject: (reason?: unknown) => void; resolve: (value: TerminalResponse) => void }>();
  private requestId = 0;
  private socket: WebSocket | null = null;

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, 'closing');
    }

    this.rejectPending(new Error('Terminal connection closed'));
    this.connectPromise = null;
    this.socket = null;
  }

  async createSession(payload: CreateTerminalSessionPayload) {
    const response = await this.request({
      cwd: payload.cwd,
      type: 'terminal.session.create',
    });

    if (!response.session) {
      throw new Error('Terminal response did not include a session');
    }

    return response.session;
  }

  async getSession(sessionId: string) {
    const response = await this.request({
      target: sessionId,
      type: 'terminal.session.inspect',
    });

    if (!response.session) {
      throw new Error('Terminal response did not include a session');
    }

    return response.session;
  }

  async listSessions() {
    const response = await this.request({
      type: 'terminal.sessions.list',
    });

    return response.sessions ?? [];
  }

  private async request(input: Omit<TerminalRequest, 'id'>) {
    const socket = await this.connect();
    const id = `terminal-${++this.requestId}`;
    const payload = {
      ...input,
      id,
    } satisfies TerminalRequest;

    return new Promise<TerminalResponse>((resolve, reject) => {
      this.pending.set(id, { reject, resolve });

      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(buildSidecarWebSocketUrl('/ws/terminal'));
      let settled = false;

      socket.addEventListener('open', () => {
        settled = true;
        this.socket = socket;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        let payload: TerminalResponse;
        try {
          payload = JSON.parse(String(event.data)) as TerminalResponse;
        } catch {
          return;
        }

        if (!payload.id) {
          return;
        }

        const pending = this.pending.get(payload.id);
        if (!pending) {
          return;
        }

        this.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(toError('Terminal request failed', payload.error));
          return;
        }

        pending.resolve(payload);
      });

      socket.addEventListener('close', () => {
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending(new Error('Terminal connection closed'));

        if (!settled) {
          reject(
            new Error(
              'Unable to connect to the Modex sidecar terminal service. Check the sidecar URL, allowed origins, token, and tmuy binary.',
            ),
          );
        }
      });

      socket.addEventListener('error', () => {
        if (!settled) {
          reject(
            new Error(
              'Unable to connect to the Modex sidecar terminal service. Check the sidecar URL, allowed origins, token, and tmuy binary.',
            ),
          );
        }
      });
    });

    try {
      return await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private rejectPending(error: Error) {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

export const buildTerminalAttachUrl = (target: string, rows: number, cols: number) => {
  const url = new URL(buildSidecarWebSocketUrl('/ws/terminal/attach'));
  url.searchParams.set('target', target);
  url.searchParams.set('rows', `${rows}`);
  url.searchParams.set('cols', `${cols}`);
  return url.toString();
};

export const createSidecarTerminalClient = (): RemoteTerminalClient & { close(): void } => new SidecarTerminalClient();
