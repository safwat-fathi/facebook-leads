import Link from 'next/link';
import { appliesTo } from '@/lib/job-present';
import type { JobRow } from '@/lib/jobs';

/** What a job was about: its own search, the search or label it was scoped to, or the filters it ran with. Works in server and client components. */
export function AppliesTo({ job }: { job: Pick<JobRow, 'id' | 'kind' | 'label' | 'params' | 'target'> }) {
  const a = appliesTo(job);
  if (a.scope === 'filters') return <p className="applies"><span className="scope-word">Applies to </span>{a.detail === 'all pages' ? 'all pages' : <>pages matching <span dir="ltr">{a.detail}</span></>}</p>;
  return (
    <p className="applies">
      <span className="scope-word">{a.scope === 'own' ? 'Search' : a.scope === 'search' ? 'Applies to search' : 'Applies to label'} </span>
      {a.href ? <Link href={a.href} dir="auto">{a.text}</Link> : <b>{a.text}</b>}
      {a.detail && <span className="note" dir="ltr"> · {a.detail}</span>}
    </p>
  );
}
