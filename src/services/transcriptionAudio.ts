const TARGET_SAMPLE_RATE = 24_000;

const globalWithBinary = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array): {
      toString(encoding: string): string;
    };
  };
  btoa?: (value: string) => string;
};

const clampSample = (value: number) => Math.max(-1, Math.min(1, value));

export const mergeRecognizedText = (baseText: string, transcript: string) => {
  const cleanTranscript = transcript.trim();
  if (cleanTranscript.length === 0) {
    return baseText;
  }

  if (baseText.trim().length === 0) {
    return cleanTranscript;
  }

  return /[\s\n]$/.test(baseText) ? `${baseText}${cleanTranscript}` : `${baseText} ${cleanTranscript}`;
};

export const downmixToMono = (channels: Float32Array[]) => {
  if (channels.length === 0) {
    return new Float32Array(0);
  }

  if (channels.length === 1) {
    return channels[0];
  }

  const mono = new Float32Array(channels[0].length);
  for (let index = 0; index < channels[0].length; index += 1) {
    let sum = 0;
    for (const channel of channels) {
      sum += channel[index] ?? 0;
    }
    mono[index] = sum / channels.length;
  }

  return mono;
};

export const resampleFloat32 = (input: Float32Array, fromSampleRate: number, toSampleRate = TARGET_SAMPLE_RATE) => {
  if (input.length === 0 || fromSampleRate === toSampleRate) {
    return input;
  }

  const ratio = fromSampleRate / toSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = position - leftIndex;
    output[index] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
  }

  return output;
};

export const float32ToPCM16 = (input: Float32Array) => {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < input.length; index += 1) {
    const sample = clampSample(input[index]);
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return bytes;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  if (globalWithBinary.Buffer) {
    return globalWithBinary.Buffer.from(bytes).toString('base64');
  }

  if (!globalWithBinary.btoa) {
    throw new Error('Base64 encoding is not available in this environment');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return globalWithBinary.btoa(binary);
};

export const encodeAudioChunk = (channels: Float32Array[], sourceSampleRate: number) => {
  const mono = downmixToMono(channels);
  if (mono.length === 0) {
    return '';
  }

  const resampled = resampleFloat32(mono, sourceSampleRate);
  if (resampled.length === 0) {
    return '';
  }

  return bytesToBase64(float32ToPCM16(resampled));
};
