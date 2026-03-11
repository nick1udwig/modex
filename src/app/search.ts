import type { ChatSummary, ChatThread } from './types';

export interface MatchRange {
  end: number;
  start: number;
}

export interface ChatSearchHit {
  anchorId: string;
  messageId: string;
}

export interface ChatSearchResult {
  hitOrder: ChatSearchHit[];
  matchesByMessageId: Record<string, MatchRange[]>;
  totalHits: number;
}

export interface SummarySearchResult {
  chatId: string;
  hitCount: number;
}

const normalizeQuery = (query: string) => query.trim().toLocaleLowerCase();

export const findMatchRanges = (text: string, query: string): MatchRange[] => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const haystack = text.toLocaleLowerCase();
  const ranges: MatchRange[] = [];
  let cursor = 0;

  while (cursor < haystack.length) {
    const index = haystack.indexOf(normalizedQuery, cursor);
    if (index === -1) {
      break;
    }

    ranges.push({
      end: index + normalizedQuery.length,
      start: index,
    });
    cursor = index + normalizedQuery.length;
  }

  return ranges;
};

export const searchThreadMessages = (thread: ChatThread | null, query: string): ChatSearchResult => {
  if (!thread) {
    return {
      hitOrder: [],
      matchesByMessageId: {},
      totalHits: 0,
    };
  }

  const matchesByMessageId: Record<string, MatchRange[]> = {};
  const hitOrder: ChatSearchHit[] = [];

  thread.messages
    .filter((message) => message.role !== 'system')
    .forEach((message) => {
      const ranges = findMatchRanges(message.content, query);
      if (ranges.length === 0) {
        return;
      }

      matchesByMessageId[message.id] = ranges;
      ranges.forEach((_, index) => {
        hitOrder.push({
          anchorId: `search-hit-${message.id}-${index}`,
          messageId: message.id,
        });
      });
    });

  return {
    hitOrder,
    matchesByMessageId,
    totalHits: hitOrder.length,
  };
};

export const searchSummaries = (chats: ChatSummary[], query: string): SummarySearchResult[] =>
  chats.flatMap((chat) => {
    const titleMatches = findMatchRanges(chat.title, query).length;
    const previewMatches = findMatchRanges(chat.preview, query).length;
    const hitCount = titleMatches + previewMatches;

    if (hitCount === 0) {
      return [];
    }

    return [
      {
        chatId: chat.id,
        hitCount,
      },
    ];
  });
