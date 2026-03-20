import type { ActivityEntry } from './types';

const compactText = (text: string) => text.replace(/\s+/g, ' ').trim();

const truncate = (text: string, maxLength: number) => {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const commandTokens = (command: string) => compactText(command).split(' ').filter((token) => token.length > 0);

export const isToolActivity = (entry: ActivityEntry) => entry.kind === 'command' || entry.kind === 'file-change';

export const liveActivityHeadline = (entry: ActivityEntry) => {
  switch (entry.kind) {
    case 'command': {
      const [commandName] = commandTokens(entry.title);
      return `Tool call: ${commandName ?? 'shell'}`;
    }
    case 'file-change':
      return 'Tool call: apply_patch';
    case 'plan':
      return 'Plan update';
    case 'reasoning':
      return 'Reasoning';
    default:
      return entry.title;
  }
};

export const liveActivityPreview = (entry: ActivityEntry, maxLength = 28) => {
  if (entry.kind === 'command') {
    const [, ...args] = commandTokens(entry.title);
    return truncate(compactText(args.join(' ') || entry.summary || entry.detail), maxLength);
  }

  return truncate(compactText(entry.summary || entry.detail), maxLength);
};
