import { Fragment, createElement } from 'react';
import type { ReactNode } from 'react';

interface MatchRange {
  end: number;
  start: number;
}

type MarkdownInlineNode =
  | {
      text: string;
      type: 'text';
    }
  | {
      text: string;
      type: 'code';
    }
  | {
      children: MarkdownInlineNode[];
      type: 'emphasis';
    }
  | {
      children: MarkdownInlineNode[];
      type: 'strong';
    }
  | {
      children: MarkdownInlineNode[];
      type: 'link';
      url: string;
    };

type MarkdownBlock =
  | {
      children: MarkdownInlineNode[];
      type: 'heading';
      depth: number;
    }
  | {
      children: MarkdownInlineNode[];
      type: 'paragraph';
    }
  | {
      code: string;
      language: string | null;
      type: 'code-block';
    }
  | {
      children: MarkdownBlock[];
      type: 'blockquote';
    }
  | {
      items: MarkdownInlineNode[][];
      ordered: boolean;
      type: 'list';
    }
  | {
      type: 'rule';
    };

interface MarkdownRenderOptions {
  activeHitId?: string | null;
  hitIdPrefix?: string;
  query?: string;
}

interface MarkdownRenderState {
  anchoredMatchIndexes: Set<number>;
  matchIndex: number;
  offset: number;
}

const CODE_FENCE_PATTERN = /^\s{0,3}```([^`]*)\s*$/;
const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const ORDERED_LIST_PATTERN = /^\s{0,3}\d+\.\s+(.*)$/;
const UNORDERED_LIST_PATTERN = /^\s{0,3}[-+*]\s+(.*)$/;
const RULE_PATTERN = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

const normalizeMarkdown = (markdown: string) => markdown.replace(/\r\n?/g, '\n');
const normalizeQuery = (query: string) => query.trim().toLocaleLowerCase();

const findMatchRanges = (text: string, query: string): MatchRange[] => {
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

const isEscaped = (text: string, index: number) => {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
};

const findUnescaped = (text: string, marker: string, fromIndex: number) => {
  for (let index = fromIndex; index <= text.length - marker.length; index += 1) {
    if (text.startsWith(marker, index) && !isEscaped(text, index)) {
      return index;
    }
  }
  return -1;
};

const unescapeMarkdownText = (text: string) => text.replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, '$1');

const sanitizeMarkdownUrl = (value: string) => {
  const normalized = value.trim().replace(/^<|>$/g, '');
  if (!normalized) {
    return null;
  }

  if (/^(https?:|mailto:|tel:)/i.test(normalized)) {
    return normalized;
  }

  return null;
};

const mergeInlineTextNodes = (nodes: MarkdownInlineNode[]) => {
  const merged: MarkdownInlineNode[] = [];

  nodes.forEach((node) => {
    const previous = merged[merged.length - 1];
    if (node.type === 'text' && previous?.type === 'text') {
      previous.text += node.text;
      return;
    }

    merged.push(node);
  });

  return merged;
};

const parseInlineMarkdown = (markdown: string): MarkdownInlineNode[] => {
  const nodes: MarkdownInlineNode[] = [];
  let cursor = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end <= textStart) {
      return;
    }

    nodes.push({
      text: unescapeMarkdownText(markdown.slice(textStart, end)),
      type: 'text',
    });
  };

  while (cursor < markdown.length) {
    if (markdown[cursor] === '\\' && cursor + 1 < markdown.length) {
      cursor += 2;
      continue;
    }

    if (markdown[cursor] === '[') {
      const labelEnd = findUnescaped(markdown, ']', cursor + 1);
      if (labelEnd !== -1 && markdown[labelEnd + 1] === '(') {
        const urlEnd = findUnescaped(markdown, ')', labelEnd + 2);
        if (urlEnd !== -1) {
          flushText(cursor);
          const label = markdown.slice(cursor + 1, labelEnd);
          const url = sanitizeMarkdownUrl(markdown.slice(labelEnd + 2, urlEnd));
          if (url) {
            nodes.push({
              children: parseInlineMarkdown(label),
              type: 'link',
              url,
            });
          } else {
            nodes.push(...parseInlineMarkdown(label));
          }
          cursor = urlEnd + 1;
          textStart = cursor;
          continue;
        }
      }
    }

    if (markdown[cursor] === '`') {
      const codeEnd = findUnescaped(markdown, '`', cursor + 1);
      if (codeEnd !== -1) {
        flushText(cursor);
        nodes.push({
          text: markdown.slice(cursor + 1, codeEnd),
          type: 'code',
        });
        cursor = codeEnd + 1;
        textStart = cursor;
        continue;
      }
    }

    if (markdown.startsWith('**', cursor) || markdown.startsWith('__', cursor)) {
      const marker = markdown.slice(cursor, cursor + 2);
      const strongEnd = findUnescaped(markdown, marker, cursor + 2);
      if (strongEnd !== -1) {
        const content = markdown.slice(cursor + 2, strongEnd);
        if (content.trim().length > 0) {
          flushText(cursor);
          nodes.push({
            children: parseInlineMarkdown(content),
            type: 'strong',
          });
          cursor = strongEnd + 2;
          textStart = cursor;
          continue;
        }
      }
    }

    if (markdown[cursor] === '*' || markdown[cursor] === '_') {
      const marker = markdown[cursor];
      const emphasisEnd = findUnescaped(markdown, marker, cursor + 1);
      if (emphasisEnd !== -1) {
        const content = markdown.slice(cursor + 1, emphasisEnd);
        if (content.trim().length > 0) {
          flushText(cursor);
          nodes.push({
            children: parseInlineMarkdown(content),
            type: 'emphasis',
          });
          cursor = emphasisEnd + 1;
          textStart = cursor;
          continue;
        }
      }
    }

    cursor += 1;
  }

  flushText(markdown.length);
  return mergeInlineTextNodes(nodes);
};

const startsSpecialBlock = (line: string) =>
  CODE_FENCE_PATTERN.test(line) ||
  HEADING_PATTERN.test(line) ||
  BLOCKQUOTE_PATTERN.test(line) ||
  ORDERED_LIST_PATTERN.test(line) ||
  UNORDERED_LIST_PATTERN.test(line) ||
  RULE_PATTERN.test(line);

const parseMarkdownBlocks = (markdown: string): MarkdownBlock[] => {
  const lines = normalizeMarkdown(markdown).split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const codeFenceMatch = line.match(CODE_FENCE_PATTERN);
    if (codeFenceMatch) {
      const codeLines: string[] = [];
      const language = codeFenceMatch[1].trim() || null;
      index += 1;

      while (index < lines.length && !CODE_FENCE_PATTERN.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && CODE_FENCE_PATTERN.test(lines[index])) {
        index += 1;
      }

      blocks.push({
        code: codeLines.join('\n'),
        language,
        type: 'code-block',
      });
      continue;
    }

    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      blocks.push({
        children: parseInlineMarkdown(headingMatch[2].trim()),
        depth: headingMatch[1].length,
        type: 'heading',
      });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (BLOCKQUOTE_PATTERN.test(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const quoteMatch = lines[index].match(BLOCKQUOTE_PATTERN);
        if (!quoteMatch) {
          break;
        }

        quoteLines.push(quoteMatch[1]);
        index += 1;
      }

      blocks.push({
        children: parseMarkdownBlocks(quoteLines.join('\n')),
        type: 'blockquote',
      });
      continue;
    }

    const orderedListMatch = line.match(ORDERED_LIST_PATTERN);
    const unorderedListMatch = line.match(UNORDERED_LIST_PATTERN);
    if (orderedListMatch || unorderedListMatch) {
      const ordered = Boolean(orderedListMatch);
      const itemPattern = ordered ? ORDERED_LIST_PATTERN : UNORDERED_LIST_PATTERN;
      const items: MarkdownInlineNode[][] = [];

      while (index < lines.length) {
        const itemMatch = lines[index].match(itemPattern);
        if (!itemMatch) {
          break;
        }

        const itemLines = [itemMatch[1].trim()];
        index += 1;

        while (
          index < lines.length &&
          lines[index].trim().length > 0 &&
          !startsSpecialBlock(lines[index]) &&
          /^\s{2,}/.test(lines[index])
        ) {
          itemLines.push(lines[index].trim());
          index += 1;
        }

        items.push(parseInlineMarkdown(itemLines.join(' ')));

        if (index < lines.length && lines[index].trim().length === 0) {
          break;
        }
      }

      blocks.push({
        items,
        ordered,
        type: 'list',
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim().length > 0 && !startsSpecialBlock(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({
      children: parseInlineMarkdown(paragraphLines.join(' ')),
      type: 'paragraph',
    });
  }

  return blocks;
};

const inlineNodesToPlainText = (nodes: MarkdownInlineNode[]): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text;
        case 'emphasis':
        case 'strong':
        case 'link':
          return inlineNodesToPlainText(node.children);
        default:
          return '';
      }
    })
    .join('');

const blockToPlainText = (block: MarkdownBlock): string => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlineNodesToPlainText(block.children);
    case 'code-block':
      return block.code;
    case 'blockquote':
      return blocksToPlainText(block.children);
    case 'list':
      return block.items.map((item) => inlineNodesToPlainText(item)).join('\n');
    case 'rule':
      return '';
    default:
      return '';
  }
};

const blocksToPlainText = (blocks: MarkdownBlock[]) =>
  blocks.reduce(
    (accumulator, block) => {
      const text = blockToPlainText(block);
      if (text.length === 0) {
        return accumulator;
      }

      if (accumulator.length === 0) {
        return text;
      }

      return `${accumulator}\n\n${text}`;
    },
    '',
  );

const renderTextSegment = (
  text: string,
  state: MarkdownRenderState,
  matches: MatchRange[],
  options: MarkdownRenderOptions,
  keyPrefix: string,
) => {
  const segmentStart = state.offset;
  const segmentEnd = segmentStart + text.length;
  state.offset = segmentEnd;

  if (text.length === 0) {
    return '';
  }

  while (state.matchIndex < matches.length && matches[state.matchIndex].end <= segmentStart) {
    state.matchIndex += 1;
  }

  if (state.matchIndex >= matches.length || matches[state.matchIndex].start >= segmentEnd) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = state.matchIndex;

  while (matchIndex < matches.length && matches[matchIndex].start < segmentEnd) {
    const match = matches[matchIndex];
    const localStart = Math.max(0, match.start - segmentStart);
    const localEnd = Math.min(text.length, match.end - segmentStart);

    if (localStart > cursor) {
      parts.push(text.slice(cursor, localStart));
    }

    if (localEnd > localStart) {
      const hitId =
        options.hitIdPrefix && !state.anchoredMatchIndexes.has(matchIndex)
          ? `${options.hitIdPrefix}-${matchIndex}`
          : undefined;
      state.anchoredMatchIndexes.add(matchIndex);
      parts.push(
        createElement(
          'mark',
          {
            className: `search-hit ${hitId && hitId === options.activeHitId ? 'search-hit--active' : ''}`,
            id: hitId,
            key: `${keyPrefix}-match-${matchIndex}-${localStart}`,
          },
          text.slice(localStart, localEnd),
        ),
      );
      cursor = localEnd;
    }

    if (match.end <= segmentEnd) {
      matchIndex += 1;
      continue;
    }

    break;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  state.matchIndex = matchIndex;
  return createElement(Fragment, { key: keyPrefix }, ...parts);
};

const renderInlineNodes = (
  nodes: MarkdownInlineNode[],
  state: MarkdownRenderState,
  matches: MatchRange[],
  options: MarkdownRenderOptions,
  keyPrefix: string,
): ReactNode[] =>
  nodes.map((node, index) => {
    const nodeKey = `${keyPrefix}-${index}`;

    switch (node.type) {
      case 'text':
        return renderTextSegment(node.text, state, matches, options, nodeKey);
      case 'code':
        return createElement(
          'code',
          {
            className: 'message-markdown__code',
            key: nodeKey,
          },
          renderTextSegment(node.text, state, matches, options, nodeKey),
        );
      case 'emphasis':
        return createElement(
          'em',
          {
            className: 'message-markdown__emphasis',
            key: nodeKey,
          },
          ...renderInlineNodes(node.children, state, matches, options, nodeKey),
        );
      case 'strong':
        return createElement(
          'strong',
          {
            className: 'message-markdown__strong',
            key: nodeKey,
          },
          ...renderInlineNodes(node.children, state, matches, options, nodeKey),
        );
      case 'link':
        return createElement(
          'a',
          {
            className: 'message-markdown__link',
            href: node.url,
            key: nodeKey,
            rel: 'noreferrer',
            target: '_blank',
          },
          ...renderInlineNodes(node.children, state, matches, options, nodeKey),
        );
      default:
        return null;
    }
  });

const renderBlocks = (
  blocks: MarkdownBlock[],
  state: MarkdownRenderState,
  matches: MatchRange[],
  options: MarkdownRenderOptions,
  keyPrefix: string,
): ReactNode[] => {
  let hasRenderedText = false;

  return blocks.map((block, index) => {
    const blockKey = `${keyPrefix}-${index}`;
    const blockText = blockToPlainText(block);
    if (blockText.length > 0 && hasRenderedText) {
      state.offset += 2;
    }

    let node: ReactNode;
    switch (block.type) {
      case 'heading':
        node = createElement(
          `h${block.depth}`,
          {
            className: `message-markdown__heading message-markdown__heading--${block.depth}`,
            key: blockKey,
          },
          ...renderInlineNodes(block.children, state, matches, options, blockKey),
        );
        break;
      case 'paragraph':
        node = createElement(
          'p',
          {
            className: 'message-markdown__paragraph',
            key: blockKey,
          },
          ...renderInlineNodes(block.children, state, matches, options, blockKey),
        );
        break;
      case 'code-block':
        node = createElement(
          'pre',
          {
            className: 'message-markdown__code-block',
            key: blockKey,
          },
          createElement(
            'code',
            {
              className: block.language ? `message-markdown__code-block-inner language-${block.language}` : 'message-markdown__code-block-inner',
            },
            renderTextSegment(block.code, state, matches, options, blockKey),
          ),
        );
        break;
      case 'blockquote':
        node = createElement(
          'blockquote',
          {
            className: 'message-markdown__quote',
            key: blockKey,
          },
          ...renderBlocks(block.children, state, matches, options, blockKey),
        );
        break;
      case 'list': {
        let hasRenderedItemText = false;
        const itemNodes = block.items.map((item, itemIndex) => {
          const itemText = inlineNodesToPlainText(item);
          if (itemText.length > 0 && hasRenderedItemText) {
            state.offset += 1;
          }

          const itemNode = createElement(
            'li',
            {
              className: 'message-markdown__list-item',
              key: `${blockKey}-item-${itemIndex}`,
            },
            ...renderInlineNodes(item, state, matches, options, `${blockKey}-item-${itemIndex}`),
          );

          if (itemText.length > 0) {
            hasRenderedItemText = true;
          }

          return itemNode;
        });

        node = createElement(
          block.ordered ? 'ol' : 'ul',
          {
            className: `message-markdown__list ${block.ordered ? 'message-markdown__list--ordered' : 'message-markdown__list--unordered'}`,
            key: blockKey,
          },
          ...itemNodes,
        );
        break;
      }
      case 'rule':
        node = createElement('hr', {
          className: 'message-markdown__rule',
          key: blockKey,
        });
        break;
      default:
        node = null;
    }

    if (blockText.length > 0) {
      hasRenderedText = true;
    }

    return node;
  });
};

export const messageMarkdownToPlainText = (markdown: string) => blocksToPlainText(parseMarkdownBlocks(markdown));

export const renderMessageMarkdown = (markdown: string, options: MarkdownRenderOptions = {}) => {
  const blocks = parseMarkdownBlocks(markdown);
  const matches = findMatchRanges(blocksToPlainText(blocks), options.query ?? '');
  const state: MarkdownRenderState = {
    anchoredMatchIndexes: new Set<number>(),
    matchIndex: 0,
    offset: 0,
  };

  return createElement(Fragment, null, ...renderBlocks(blocks, state, matches, options, 'markdown'));
};
