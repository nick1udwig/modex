import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { messageMarkdownToPlainText, renderMessageMarkdown } from '../src/app/messageMarkdown.ts';
import { searchThreadMessages } from '../src/app/search.ts';
import type { ChatThread } from '../src/app/types.ts';

test('renderMessageMarkdown renders block and inline markdown safely', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      { className: 'message-markdown' },
      renderMessageMarkdown(
        [
          '# Heading',
          '',
          'Paragraph with **bold**, *emphasis*, `code`, and [docs](https://example.com/docs).',
          '',
          '- first item',
          '- second item',
          '',
          '> quoted line',
          '',
          '```ts',
          'const total = 2 + 2;',
          '```',
          '',
          '[bad](javascript:alert(1))',
        ].join('\n'),
      ),
    ),
  );

  assert.match(markup, /<h1 class="message-markdown__heading message-markdown__heading--1">Heading<\/h1>/);
  assert.match(markup, /<strong class="message-markdown__strong">bold<\/strong>/);
  assert.match(markup, /<em class="message-markdown__emphasis">emphasis<\/em>/);
  assert.match(markup, /<code class="message-markdown__code">code<\/code>/);
  assert.match(markup, /<a class="message-markdown__link" href="https:\/\/example\.com\/docs" rel="noreferrer" target="_blank">docs<\/a>/);
  assert.match(markup, /<ul class="message-markdown__list message-markdown__list--unordered">/);
  assert.match(markup, /<blockquote class="message-markdown__quote">/);
  assert.match(markup, /<pre class="message-markdown__code-block"><code class="message-markdown__code-block-inner language-ts">const total = 2 \+ 2;<\/code><\/pre>/);
  assert.doesNotMatch(markup, /javascript:alert/);
});

test('messageMarkdownToPlainText removes markdown syntax for search hits', () => {
  assert.equal(
    messageMarkdownToPlainText('Heading with **bold** text, `code`, and [docs](https://example.com).'),
    'Heading with bold text, code, and docs.',
  );

  const thread: ChatThread = {
    activity: [],
    cwd: '/workspace/project',
    id: 'chat-markdown',
    messages: [
      {
        content: 'Heading with **bold** text and `code`.',
        createdAt: '2026-03-19T12:00:00.000Z',
        id: 'msg-1',
        role: 'assistant',
        turnId: 'turn-1',
      },
    ],
    preview: 'Heading with bold text and code.',
    status: 'idle',
    title: 'Markdown search',
    tokenUsageLabel: null,
    updatedAt: '2026-03-19T12:00:00.000Z',
  };

  assert.deepEqual(searchThreadMessages(thread, 'bold'), {
    hitOrder: [
      {
        anchorId: 'search-hit-msg-1-0',
        messageId: 'msg-1',
      },
    ],
    matchesByMessageId: {
      'msg-1': [{ end: 17, start: 13 }],
    },
    totalHits: 1,
  });
});
