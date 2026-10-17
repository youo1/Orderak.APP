/* eslint-disable react/only-export-components */
import type { LucideIcon } from 'lucide-react';
import { FilterX, Inbox } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

type NoneYetProps = {
  variant: 'none-yet';
  /** The resource's own words, e.g. "No bug reports yet". */
  title?: string;
  /** How a record appears. */
  body?: string;
  icon?: LucideIcon;
  className?: string;
};

type NoMatchProps = {
  variant: 'no-match';
  /** Plural resource wording, e.g. "stores". */
  records: string;
  query: string;
  total: number;
  onClear: () => void;
  className?: string;
};

export type EmptyStateProps = NoneYetProps | NoMatchProps;

/**
 * Says which nothing it is: a resource with no records yet, or a filter that
 * hides every record. The two states carry different next steps, so they are
 * two variants of one primitive rather than one vague "no results" message.
 */
export function EmptyState(props: EmptyStateProps) {
  if (props.variant === 'no-match') {
    return (
      <div className={cn('empty-state', props.className)}>
        <span className="empty-state-glyph" aria-hidden="true"><FilterX size={22} /></span>
        <p className="empty-state-title">No {props.records} match “{props.query}”</p>
        <p className="empty-state-body">
          Check the spelling, or clear the filter to see all {props.total.toLocaleString()} {props.records}.
        </p>
        <button type="button" className="empty-state-clear" onClick={props.onClear}>Clear filter</button>
      </div>
    );
  }

  const Icon = props.icon ?? Inbox;
  return (
    <div className={cn('empty-state', props.className)}>
      <span className="empty-state-glyph" aria-hidden="true"><Icon size={22} /></span>
      <p className="empty-state-title">{props.title ?? 'No records yet'}</p>
      <p className="empty-state-body">{props.body ?? 'Records appear here when they are available.'}</p>
    </div>
  );
}
