import { Fragment } from 'react';
import { findMatchRanges } from '../app/search';

interface HighlightedTextProps {
  activeHitId?: string | null;
  hitIdPrefix?: string;
  query: string;
  text: string;
}

export const HighlightedText = ({
  activeHitId = null,
  hitIdPrefix,
  query,
  text,
}: HighlightedTextProps) => {
  const ranges = findMatchRanges(text, query);
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  let cursor = 0;

  return (
    <>
      {ranges.map((range, index) => {
        const leading = text.slice(cursor, range.start);
        const match = text.slice(range.start, range.end);
        cursor = range.end;
        const hitId = hitIdPrefix ? `${hitIdPrefix}-${index}` : undefined;

        return (
          <Fragment key={`${range.start}-${range.end}`}>
            {leading}
            <mark id={hitId} className={`search-hit ${hitId && hitId === activeHitId ? 'search-hit--active' : ''}`}>
              {match}
            </mark>
          </Fragment>
        );
      })}
      {text.slice(cursor)}
    </>
  );
};
