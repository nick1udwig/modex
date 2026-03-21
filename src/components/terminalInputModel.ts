export interface TerminalModifierState {
  alt: boolean;
  ctrl: boolean;
}

export type TerminalShortcutKey = '.' | '-' | '/' | 'alt' | 'ctrl' | 'esc' | 'tab' | 'tilde' | 'pipe';

export const TERMINAL_SHORTCUT_BUTTONS: Array<{
  key: TerminalShortcutKey;
  label: string;
  modifier?: boolean;
}> = [
  { key: 'esc', label: 'esc' },
  { key: 'tab', label: 'tab' },
  { key: 'ctrl', label: 'ctrl', modifier: true },
  { key: 'alt', label: 'alt', modifier: true },
  { key: '/', label: '/' },
  { key: 'pipe', label: '|' },
  { key: 'tilde', label: '~' },
  { key: '-', label: '-' },
  { key: '.', label: '.' },
];

const baseShortcutSequence = (key: Exclude<TerminalShortcutKey, 'alt' | 'ctrl'>) => {
  switch (key) {
    case 'esc':
      return '\u001b';
    case 'tab':
      return '\t';
    case 'pipe':
      return '|';
    case 'tilde':
      return '~';
    case '/':
    case '-':
    case '.':
      return key;
  }
};

const applyAltModifier = (sequence: string, alt: boolean) => (alt ? `\u001b${sequence}` : sequence);

const toCtrlSequence = (value: string) => {
  if (value.length !== 1) {
    return value;
  }

  const code = value.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(code - 64);
  }

  return value;
};

export const getTerminalShortcutSequence = (
  key: Exclude<TerminalShortcutKey, 'alt' | 'ctrl'>,
  modifiers: TerminalModifierState,
) => {
  const sequence = baseShortcutSequence(key);
  if (modifiers.ctrl) {
    return applyAltModifier(sequence, modifiers.alt);
  }

  return applyAltModifier(sequence, modifiers.alt);
};

export const getTerminalTextSequence = (value: string, modifiers: TerminalModifierState) => {
  if (!value) {
    return '';
  }

  let sequence = value;
  if (modifiers.ctrl) {
    sequence = toCtrlSequence(value);
  }

  return applyAltModifier(sequence, modifiers.alt);
};
