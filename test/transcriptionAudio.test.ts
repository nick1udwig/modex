import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downmixToMono,
  encodeAudioChunk,
  mergeRecognizedText,
  resampleFloat32,
} from '../src/services/transcriptionAudio.ts';

test('mergeRecognizedText preserves the base text and inserts spacing once', () => {
  assert.equal(mergeRecognizedText('', 'hello world'), 'hello world');
  assert.equal(mergeRecognizedText('Existing', 'words'), 'Existing words');
  assert.equal(mergeRecognizedText('Existing ', 'words'), 'Existing words');
});

test('downmixToMono averages all channels', () => {
  const mono = downmixToMono([
    new Float32Array([0, 0.5, 1]),
    new Float32Array([0, -0.5, 0]),
  ]);

  assert.deepEqual([...mono], [0, 0, 0.5]);
});

test('resampleFloat32 shrinks audio to the target sample rate', () => {
  const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
  const output = resampleFloat32(input, 48_000, 24_000);

  assert.equal(output.length, 4);
});

test('encodeAudioChunk returns little-endian pcm16 base64 audio', () => {
  const encoded = encodeAudioChunk([new Float32Array([0, 0.5, -0.5])], 24_000);
  const bytes = Buffer.from(encoded, 'base64');

  assert.equal(bytes.length, 6);
  assert.equal(bytes.readInt16LE(0), 0);
  assert.equal(bytes.readInt16LE(2), 16383);
  assert.equal(bytes.readInt16LE(4), -16384);
});
