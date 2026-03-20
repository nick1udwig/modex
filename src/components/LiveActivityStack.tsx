import { useMemo, useState } from 'react';
import { renderMessageMarkdown } from '../app/messageMarkdown';
import { isToolActivity, liveActivityHeadline, liveActivityPreview } from '../app/liveActivityPresentation';
import type { ActivityEntry } from '../app/types';

interface LiveActivityStackProps {
  entries: ActivityEntry[];
  searchQuery: string;
}

export const LiveActivityStack = ({ entries, searchQuery }: LiveActivityStackProps) => {
  const [expanded, setExpanded] = useState(false);
  const stackEntries = useMemo(() => [...entries].reverse(), [entries]);
  const topEntry = stackEntries[0] ?? null;

  if (!topEntry) {
    return null;
  }

  return (
    <div className="message-live-stack">
      <div className="message-live-stack__header">
        <span className="message-live-stack__eyebrow">In progress</span>
      </div>

      <div className={`message-live-stack__summary ${expanded ? 'message-live-stack__summary--expanded' : ''}`}>
        {!expanded && stackEntries.length > 1 ? (
          <div className="message-live-stack__layers" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : null}

        <article key={topEntry.id} className="message-live-card message-live-card--top">
          <div className="message-live-card__header">
            <span className="message-live-card__title">{liveActivityHeadline(topEntry)}</span>
            <button
              className="message-live-card__toggle"
              type="button"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Hide stack' : 'Expand stack'}
            </button>
          </div>

          {isToolActivity(topEntry) ? (
            <p className="message-live-card__preview">{liveActivityPreview(topEntry, 36)}</p>
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

      {expanded ? (
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
