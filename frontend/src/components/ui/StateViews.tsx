import { Card } from "../layout/Card";

export function LoadingState(): JSX.Element {
  return (
    <div className="skeleton-grid" aria-live="polite" aria-busy="true">
      <Card>
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </Card>
      <Card>
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </Card>
    </div>
  );
}

export function EmptyState(): JSX.Element {
  return (
    <Card>
      <p className="state-title">No deviations found</p>
      <p className="state-text">Try another study ID or remove filters to broaden results.</p>
    </Card>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <Card>
      <p className="state-title">Unable to load data</p>
      <p className="state-text">{message}</p>
      <button className="button" type="button" onClick={onRetry}>
        Retry
      </button>
    </Card>
  );
}
