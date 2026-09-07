import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a bug shows a recoverable screen instead of a
 * blank white page. Errors during rendering are not catchable by hooks, so this
 * has to be a class component.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console so the stack is available when debugging a report.
    console.error('Render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Something broke</h1>
          <p className="mt-2 text-sm text-muted">
            The page hit an unexpected error. Reloading usually clears it.
          </p>
          <p className="mt-3 break-words rounded-lg bg-surface-raised p-3 text-left font-mono text-[11px] text-subtle">
            {error.message}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="ghost" onClick={() => { window.location.href = '/'; }}>
              Go home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
