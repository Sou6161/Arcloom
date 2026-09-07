import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Repository } from '@decodr/types';
import { Badge, Card, ConfirmDialog } from '@/components/ui';
import { ArrowRightIcon, TrashIcon } from '@/components/icons';
import { STATUS_META } from './statusMeta';
import { useDeleteRepository } from './hooks';

const STAT = (label: string, value: number) => ({ label, value });

export function RepositoryCard({ repository }: { repository: Repository }) {
  const status = STATUS_META[repository.status];
  const [confirmOpen, setConfirmOpen] = useState(false);
  const del = useDeleteRepository();

  const stats = [
    STAT('Files', repository.fileCount),
    STAT('Components', repository.componentCount),
    STAT('Hooks', repository.hookCount),
    STAT('Routes', repository.routeCount),
  ];

  // The delete button and its dialog sit OUTSIDE the Link on purpose: nested
  // inside it, a click on "Delete" bubbles up and navigates to the project that
  // was just removed.
  return (
    <div className="group relative h-full">
      <Link to={`/repositories/${repository.id}`} className="block h-full">
        <Card className="h-full p-5 transition-all duration-200 hover:border-border-strong hover:bg-surface-raised/60">
          <div className="flex items-start justify-between gap-3 pr-8">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {repository.name}
            </h3>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="text-lg font-semibold tabular-nums text-foreground">
                  {s.value}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-subtle">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs text-subtle">
              {new Date(repository.createdAt).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-muted transition-colors group-hover:text-primary">
              Open
              <ArrowRightIcon width={14} height={14} />
            </span>
          </div>
        </Card>
      </Link>

      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        aria-label={`Delete ${repository.name}`}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-subtle opacity-0 transition-all hover:bg-danger/15 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon width={16} height={16} />
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete project?"
        description={`"${repository.name}" and its analysis will be permanently removed. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() => del.mutate(repository.id, { onSuccess: () => setConfirmOpen(false) })}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
