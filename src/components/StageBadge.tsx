import { STAGE_LABEL } from '@/lib/present';

// One small line icon per stage (24x24 grid, same stroke style as app/icon.svg). The colour comes from .st-<stage> in globals.css; the label stays visible, so colour is never the only signal.
const ICON: Record<string, React.ReactNode> = {
  new: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  reviewed: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  qualified: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  contacted: <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  replied: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  converted: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M10 17h4M8 21h8" />,
  rejected: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
};

export function StageBadge({ stage }: { stage: string }) {
  const icon = ICON[stage];
  return (
    <span className={`stage st-${stage}`}>
      {icon && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>}
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}
