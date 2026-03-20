import { useMemo, useState } from 'react';
import { renderMessageMarkdown } from '../app/messageMarkdown';
import { isToolActivity, liveActivityHeadline, liveActivityPreview } from '../app/liveActivityPresentation';
import type { ActivityEntry } from '../app/types';

interface LiveActivityStackProps {
  busy: boolean;
  entries: ActivityEntry[];
  searchQuery: string;
}

const PLACEHOLDER_ENTRY: ActivityEntry = {
  detail: 'Waiting for agent updates...',
  id: 'live-placeholder',
  kind: 'commentary',
  status: 'in-progress',
  summary: 'Waiting for agent updates...',
  title: 'Thinking',
  turnId: 'live-placeholder',
};

export const LiveActivityStack = ({ busy, entries, searchQuery }: LiveActivityStackProps) => {
  const [expanded, setExpanded] = useState(false);
  const stackEntries = useMemo(
    () => [...(entries.length > 0 ? entries : busy ? [PLACEHOLDER_ENTRY] : [])].reverse(),
    [busy, entries],
  );
  const topEntry = stackEntries[0] ?? null;
  const layeredEntries = stackEntries.slice(1, 3);
  const canExpand = entries.length > 0;

  if (!topEntry) {
    return null;
  }

  return (
    <div className="message-live-stack">
      <div className="message-live-stack__header">
        <span className="message-live-stack__eyebrow">In progress</span>
      </div>

      <div className={`message-live-stack__summary ${expanded ? 'message-live-stack__summary--expanded' : ''}`}>
        {!expanded && layeredEntries.length > 0 ? (
          <div className="message-live-stack__layers" aria-hidden="true">
            {layeredEntries.map((entry, index) => (
              <article key={entry.id} className={`message-live-card message-live-card--layer message-live-card--layer-${index + 1}`}>
                <div className="message-live-card__header">
                  <span className="message-live-card__title">{liveActivityHeadline(entry)}</span>
                </div>
                <p className="message-live-card__preview">{liveActivityPreview(entry, 20)}</p>
              </article>
            ))}
          </div>
        ) : null}

        <article key={topEntry.id} className="message-live-card message-live-card--top">
          <div className="message-live-card__header">
            <span className="message-live-card__title">{liveActivityHeadline(topEntry)}</span>
            {canExpand ? (
              <button
                className="message-live-card__toggle"
                type="button"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? 'Hide stack' : 'Expand stack'}
              </button>
            ) : null}
          </div>

          {isToolActivity(topEntry) ? (
            <p className="message-live-card__preview">{liveActivityPreview(topEntry, 20)}</p>
          ) : (
            <div className="message-live-card__body message-markdown">
              {renderMessageMarkdown(topEntry.detail, {
                hitIdPrefix: `live-activity-${topEntry.id}`,
                query: searchQuery,
              })}
            </div>
          )}
        </article>
      </div>

      {expanded && stackEntries.length > 1 ? (
        <div className="message-live-stack__items">
          {stackEntries.slice(1).map((entry) => (
            <article key={entry.id} className="message-live-card">
              <div className="message-live-card__header">
                <span className="message-live-card__title">{liveActivityHeadline(entry)}</span>
              </div>
              {isToolActivity(entry) ? (
                <div className="message-live-card__detail">
                  <p className="message-live-card__preview">{liveActivityPreview(entry, 36)}</p>
                  {entry.detail ? <pre className="message-live-card__code">{entry.detail}</pre> : null}
                </div>
              ) : (
                <div className="message-live-card__body message-markdown">
                  {renderMessageMarkdown(entry.detail, {
                    hitIdPrefix: `live-activity-${entry.id}`,
                    query: searchQuery,
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
};
