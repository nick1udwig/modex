import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { buildSidecarWebSocketUrl } from '../services/sidecarClient';
import { encodeAudioChunk, mergeRecognizedText } from '../services/transcriptionAudio';

type AudioContextLike = AudioContext;
type AudioContextCtor = typeof AudioContext;

export type TranscriptionTarget = 'draft' | 'search';

interface StartTranscriptionOptions {
  baseText: string;
  chatId?: string | null;
  target: TranscriptionTarget;
}

interface ActiveTranscriptionSession extends StartTranscriptionOptions {
  status: 'connecting' | 'recording';
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

const browserWindow = typeof window === 'undefined' ? null : (window as Window & { webkitAudioContext?: AudioContextCtor });

const audioContextConstructor: AudioContextCtor | undefined =
  typeof AudioContext !== 'undefined' ? AudioContext : browserWindow?.webkitAudioContext;

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

export const useRealtimeTranscription = () => {
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ActiveTranscriptionSession | null>(null);
  const audioContextRef = useRef<AudioContextLike | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const itemOrderRef = useRef<string[]>([]);
  const itemsRef = useRef(new Map<string, string>());
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const stoppingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(
    () => () => {
      stoppingRef.current = true;
      teardownRefs({
        audioContextRef,
        gainNodeRef,
        processorRef,
        sourceNodeRef,
        streamRef,
        wsRef,
      });
    },
    [],
  );

  const stop = () => {
    const finalText = session ? mergeRecognizedText(session.baseText, session.transcript) : '';
    stoppingRef.current = true;
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
    setSession(null);
    return finalText;
  };

  const start = async ({ baseText, chatId, target }: StartTranscriptionOptions) => {
    if (!navigator.mediaDevices?.getUserMedia || !audioContextConstructor) {
      setError('Voice transcription is not available in this browser.');
      return false;
    }

    if (session) {
      stop();
    }

    stoppingRef.current = false;
    itemOrderRef.current = [];
    itemsRef.current.clear();
    setError(null);
    setSession({
      baseText,
      chatId,
      status: 'connecting',
      target,
      transcript: '',
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ws = await openTranscriptionSocket();
      wsRef.current = ws;

      ws.addEventListener('message', (event) => {
        let payload: RawTranscriptionEvent;
        try {
          payload = JSON.parse(String(event.data)) as RawTranscriptionEvent;
        } catch {
          return;
        }

        if (payload.type === 'error') {
          setError(payload.error?.message ?? 'Voice transcription failed.');
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
        setSession((current) => (current ? { ...current, status: 'recording', transcript } : current));
      });

      ws.addEventListener('close', () => {
        if (stoppingRef.current) {
          return;
        }

        setError('Voice transcription disconnected.');
        teardownRefs({
          audioContextRef,
          gainNodeRef,
          processorRef,
          sourceNodeRef,
          streamRef,
          wsRef,
        });
        setSession(null);
      });

      const audioContext = new audioContextConstructor({
        sampleRate: 24_000,
      });
      audioContextRef.current = audioContext;
      await audioContext.resume();

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
        if (ws.readyState !== WebSocket.OPEN) {
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
      stoppingRef.current = true;
      teardownRefs({
        audioContextRef,
        gainNodeRef,
        processorRef,
        sourceNodeRef,
        streamRef,
        wsRef,
      });
      setSession(null);
      setError(nextError instanceof Error ? nextError.message : 'Voice transcription failed to start.');
      return false;
    }
  };

  return {
    active: Boolean(session),
    canRecord: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia !== undefined && audioContextConstructor),
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
  processorRef.current?.disconnect();
  processorRef.current = null;

  sourceNodeRef.current?.disconnect();
  sourceNodeRef.current = null;

  gainNodeRef.current?.disconnect();
  gainNodeRef.current = null;

  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;

  if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
    wsRef.current.close(1000, 'done');
  }
  wsRef.current = null;

  void audioContextRef.current?.close();
  audioContextRef.current = null;
};
