import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  describeRealtimeTranscriptionStartError,
  getRecordingAudioContextConstructor,
  getRealtimeTranscriptionSupport,
} from '../services/realtimeTranscriptionSupport';
import { buildSidecarWebSocketUrl } from '../services/sidecarClient';
import { encodeAudioChunk, mergeRecognizedText } from '../services/transcriptionAudio';

type AudioContextLike = AudioContext;

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
};

export type TranscriptionTarget = 'draft' | 'search';

interface StartTranscriptionOptions {
  baseText: string;
  chatId?: string | null;
  target: TranscriptionTarget;
}

export interface CompletedTranscriptionResult extends StartTranscriptionOptions {
  text: string;
}

interface ActiveTranscriptionSession extends StartTranscriptionOptions {
  status: 'connecting' | 'recording' | 'processing';
  transcript: string;
}

interface RawTranscriptionEvent {
  delta?: string;
  error?: {
    message?: string;
  };
  item_id?: string;
  previous_item_id?: string | null;
  transcript?: string;
  type?: string;
}

const PREFERRED_AUDIO_CONTEXT_SAMPLE_RATE = 24_000;
const MIN_AUDIO_COMMIT_MS = 100;
const TRANSCRIPTION_DRAIN_IDLE_MS = 2_000;
const TRANSCRIPTION_DRAIN_MAX_MS = 12_000;

const composeTranscript = (order: string[], items: Map<string, string>) => {
  const seen = new Set<string>();
  const ordered = order
    .map((itemId) => {
      seen.add(itemId);
      return items.get(itemId)?.trim() ?? '';
    })
    .filter((item) => item.length > 0);
  const overflow = [...items.entries()]
    .filter(([itemId]) => !seen.has(itemId))
    .map(([, text]) => text.trim())
    .filter((item) => item.length > 0);

  return [...ordered, ...overflow].join(' ').replace(/\s+/g, ' ').trim();
};

const insertCommittedItem = (order: string[], itemId: string, previousItemId?: string | null) => {
  if (order.includes(itemId)) {
    return;
  }

  if (previousItemId) {
    const previousIndex = order.indexOf(previousItemId);
    if (previousIndex >= 0) {
      order.splice(previousIndex + 1, 0, itemId);
      return;
    }
  }

  order.push(itemId);
};

const createRecordingAudioContext = () => {
  const audioContextConstructor = getRecordingAudioContextConstructor();
  if (!audioContextConstructor) {
    throw new Error('Voice transcription is not available in this browser.');
  }

  try {
    return new audioContextConstructor({
      sampleRate: PREFERRED_AUDIO_CONTEXT_SAMPLE_RATE,
    });
  } catch {
    return new audioContextConstructor();
  }
};

export const useRealtimeTranscription = () => {
  const [completedResult, setCompletedResult] = useState<CompletedTranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ActiveTranscriptionSession | null>(null);
  const audioContextRef = useRef<AudioContextLike | null>(null);
  const drainIdleTimeoutRef = useRef<number | null>(null);
  const drainMaxTimeoutRef = useRef<number | null>(null);
  const drainingRef = useRef(false);
  const gainNodeRef = useRef<GainNode | null>(null);
  const itemOrderRef = useRef<string[]>([]);
  const itemsRef = useRef(new Map<string, string>());
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const publishCompletedResultRef = useRef(true);
  const sentAudioMsRef = useRef(0);
  const sessionMetaRef = useRef<StartTranscriptionOptions | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const startSequenceRef = useRef(0);
  const stoppingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const clearDrainTimers = () => {
    if (drainIdleTimeoutRef.current !== null) {
      window.clearTimeout(drainIdleTimeoutRef.current);
      drainIdleTimeoutRef.current = null;
    }

    if (drainMaxTimeoutRef.current !== null) {
      window.clearTimeout(drainMaxTimeoutRef.current);
      drainMaxTimeoutRef.current = null;
    }
  };

  const currentTranscriptText = () =>
    mergeRecognizedText(sessionMetaRef.current?.baseText ?? '', composeTranscript(itemOrderRef.current, itemsRef.current));

  const releaseWakeLock = () => {
    const activeWakeLock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!activeWakeLock) {
      return;
    }

    void activeWakeLock.release().catch(() => undefined);
  };

  const requestWakeLock = async () => {
    const wakeLockNavigator = globalThis.navigator as NavigatorWithWakeLock | undefined;
    if (!wakeLockNavigator?.wakeLock || typeof document === 'undefined' || document.visibilityState !== 'visible') {
      return;
    }

    releaseWakeLock();

    try {
      wakeLockRef.current = await wakeLockNavigator.wakeLock.request('screen');
    } catch {
      wakeLockRef.current = null;
    }
  };

  const finishSession = (publishResult: boolean) => {
    const sessionMeta = sessionMetaRef.current;
    const finalText = currentTranscriptText();

    startSequenceRef.current += 1;
    stoppingRef.current = true;
    drainingRef.current = false;
    clearDrainTimers();
    releaseWakeLock();
    teardownRefs({
      audioContextRef,
      gainNodeRef,
      processorRef,
      sourceNodeRef,
      streamRef,
      wsRef,
    });
    itemsRef.current.clear();
    itemOrderRef.current = [];
    sentAudioMsRef.current = 0;
    sessionMetaRef.current = null;
    setSession(null);

    if (publishResult && publishCompletedResultRef.current && sessionMeta) {
      setCompletedResult({
        ...sessionMeta,
        text: finalText,
      });
    }

    return finalText;
  };

  const scheduleDrainFinalization = () => {
    if (!drainingRef.current) {
      return;
    }

    if (drainIdleTimeoutRef.current !== null) {
      window.clearTimeout(drainIdleTimeoutRef.current);
    }

    drainIdleTimeoutRef.current = window.setTimeout(() => {
      finishSession(publishCompletedResultRef.current);
    }, TRANSCRIPTION_DRAIN_IDLE_MS);

    if (drainMaxTimeoutRef.current === null) {
      drainMaxTimeoutRef.current = window.setTimeout(() => {
        finishSession(publishCompletedResultRef.current);
      }, TRANSCRIPTION_DRAIN_MAX_MS);
    }
  };

  useEffect(
    () => () => {
      finishSession(false);
    },
    [],
  );

  useEffect(() => {
    if (session?.status !== 'connecting' && session?.status !== 'recording') {
      releaseWakeLock();
      return;
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
        return;
      }

      releaseWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [session?.status]);

  const stop = (publishResult = true) => {
    const finalText = currentTranscriptText();
    if (!session) {
      return finalText;
    }

    if (session.status === 'processing') {
      if (!publishResult) {
        publishCompletedResultRef.current = false;
      }
      return finalText;
    }

    drainingRef.current = true;
    publishCompletedResultRef.current = publishResult;
    releaseWakeLock();
    teardownAudioRefs({
      audioContextRef,
      gainNodeRef,
      processorRef,
      sourceNodeRef,
      streamRef,
    });
    setSession((current) => (current ? { ...current, status: 'processing' } : current));

    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      finishSession(publishCompletedResultRef.current);
      return finalText;
    }

    if (sentAudioMsRef.current < MIN_AUDIO_COMMIT_MS) {
      finishSession(publishCompletedResultRef.current);
      return finalText;
    }

    scheduleDrainFinalization();

    try {
      socket.send(
        JSON.stringify({
          type: 'input_audio_buffer.commit',
        }),
      );
    } catch {
      finishSession(publishCompletedResultRef.current);
    }

    return finalText;
  };

  const start = async ({ baseText, chatId, target }: StartTranscriptionOptions) => {
    const support = getRealtimeTranscriptionSupport();
    if (!support.canRecord) {
      setError(support.reason);
      return false;
    }

    if (sessionMetaRef.current) {
      finishSession(false);
    }

    const startSequence = startSequenceRef.current + 1;
    startSequenceRef.current = startSequence;
    stoppingRef.current = false;
    drainingRef.current = false;
    clearDrainTimers();
    itemOrderRef.current = [];
    itemsRef.current.clear();
    publishCompletedResultRef.current = true;
    sentAudioMsRef.current = 0;
    setCompletedResult(null);
    setError(null);

    const nextSession = {
      baseText,
      chatId,
      status: 'connecting',
      target,
      transcript: '',
    } satisfies ActiveTranscriptionSession;
    sessionMetaRef.current = {
      baseText,
      chatId,
      target,
    };
    setSession(nextSession);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (startSequence !== startSequenceRef.current || !sessionMetaRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;

      const ws = await openTranscriptionSocket();
      if (startSequence !== startSequenceRef.current || !sessionMetaRef.current) {
        if (ws.readyState < WebSocket.CLOSING) {
          ws.close(1000, 'done');
        }
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      wsRef.current = ws;

      ws.addEventListener('message', (event) => {
        if (startSequence !== startSequenceRef.current) {
          return;
        }

        let payload: RawTranscriptionEvent;
        try {
          payload = JSON.parse(String(event.data)) as RawTranscriptionEvent;
        } catch {
          return;
        }

        if (payload.type === 'error') {
          setError(payload.error?.message ?? 'Voice transcription failed.');
          finishSession(publishCompletedResultRef.current);
          return;
        }

        if (payload.type === 'input_audio_buffer.committed' && payload.item_id) {
          insertCommittedItem(itemOrderRef.current, payload.item_id, payload.previous_item_id);
        }

        if (payload.item_id && typeof payload.delta === 'string' && payload.type?.includes('transcription')) {
          insertCommittedItem(itemOrderRef.current, payload.item_id);
          const currentText = itemsRef.current.get(payload.item_id) ?? '';
          itemsRef.current.set(payload.item_id, `${currentText}${payload.delta}`);
        }

        if (payload.item_id && typeof payload.transcript === 'string' && payload.type?.includes('transcription')) {
          insertCommittedItem(itemOrderRef.current, payload.item_id, payload.previous_item_id);
          itemsRef.current.set(payload.item_id, payload.transcript);
        }

        const transcript = composeTranscript(itemOrderRef.current, itemsRef.current);
        setSession((current) =>
          current
            ? {
                ...current,
                status: current.status === 'processing' ? 'processing' : 'recording',
                transcript,
              }
            : current,
        );

        if (drainingRef.current) {
          scheduleDrainFinalization();
        }
      });

      ws.addEventListener('close', () => {
        if (startSequence !== startSequenceRef.current || stoppingRef.current) {
          return;
        }

        if (drainingRef.current) {
          finishSession(publishCompletedResultRef.current);
          return;
        }

        setError('Voice transcription disconnected.');
        finishSession(false);
      });

      const audioContext = createRecordingAudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();

      if (startSequence !== startSequenceRef.current || !sessionMetaRef.current) {
        void audioContext.close().catch(() => undefined);
        return false;
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;

      sourceNode.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      sourceNodeRef.current = sourceNode;
      processorRef.current = processor;
      gainNodeRef.current = gainNode;

      processor.onaudioprocess = (event) => {
        if (startSequence !== startSequenceRef.current || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const channels = Array.from(
          {
            length: event.inputBuffer.numberOfChannels,
          },
          (_, channelIndex) => event.inputBuffer.getChannelData(channelIndex),
        );
        const audio = encodeAudioChunk(channels, audioContext.sampleRate);
        if (!audio) {
          return;
        }

        sentAudioMsRef.current += ((channels[0]?.length ?? 0) / audioContext.sampleRate) * 1_000;

        ws.send(
          JSON.stringify({
            audio,
            type: 'input_audio_buffer.append',
          }),
        );
      };

      setSession((current) => (current ? { ...current, status: 'recording' } : current));
      return true;
    } catch (nextError) {
      if (startSequence !== startSequenceRef.current || !sessionMetaRef.current) {
        return false;
      }

      finishSession(false);
      setError(describeRealtimeTranscriptionStartError(nextError));
      return false;
    }
  };

  const support = getRealtimeTranscriptionSupport();

  return {
    active: Boolean(session),
    canRecord: support.canRecord,
    clearCompletedResult: () => setCompletedResult(null),
    completedResult,
    composedText: session ? mergeRecognizedText(session.baseText, session.transcript) : '',
    error,
    session,
    start,
    stop,
  };
};

const openTranscriptionSocket = async () =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(buildSidecarWebSocketUrl('/ws/transcription'));
    let settled = false;

    ws.addEventListener('open', () => {
      settled = true;
      resolve(ws);
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        reject(
          new Error(
            'Unable to connect to the Modex sidecar transcription service. Check the sidecar URL, allowed origins, and token.',
          ),
        );
      }
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        reject(
          new Error(
            'Unable to connect to the Modex sidecar transcription service. Check the sidecar URL, allowed origins, and token.',
          ),
        );
      }
    });
  });

const teardownAudioRefs = ({
  audioContextRef,
  gainNodeRef,
  processorRef,
  sourceNodeRef,
  streamRef,
}: {
  audioContextRef: MutableRefObject<AudioContextLike | null>;
  gainNodeRef: MutableRefObject<GainNode | null>;
  processorRef: MutableRefObject<ScriptProcessorNode | null>;
  sourceNodeRef: MutableRefObject<MediaStreamAudioSourceNode | null>;
  streamRef: MutableRefObject<MediaStream | null>;
}) => {
  processorRef.current?.disconnect();
  processorRef.current = null;

  sourceNodeRef.current?.disconnect();
  sourceNodeRef.current = null;

  gainNodeRef.current?.disconnect();
  gainNodeRef.current = null;

  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;

  void audioContextRef.current?.close().catch(() => undefined);
  audioContextRef.current = null;
};

const teardownRefs = ({
  audioContextRef,
  gainNodeRef,
  processorRef,
  sourceNodeRef,
  streamRef,
  wsRef,
}: {
  audioContextRef: MutableRefObject<AudioContextLike | null>;
  gainNodeRef: MutableRefObject<GainNode | null>;
  processorRef: MutableRefObject<ScriptProcessorNode | null>;
  sourceNodeRef: MutableRefObject<MediaStreamAudioSourceNode | null>;
  streamRef: MutableRefObject<MediaStream | null>;
  wsRef: MutableRefObject<WebSocket | null>;
}) => {
  teardownAudioRefs({
    audioContextRef,
    gainNodeRef,
    processorRef,
    sourceNodeRef,
    streamRef,
  });

  if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
    wsRef.current.close(1000, 'done');
  }
  wsRef.current = null;
};
