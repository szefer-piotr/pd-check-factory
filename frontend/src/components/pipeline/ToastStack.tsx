import type { ToastItem } from "../../jobs/PipelineJobContext";

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps): JSX.Element | null {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
          <div className="toast-body">
            <strong className="toast-title">{toast.title}</strong>
            {toast.detail ? <p className="toast-detail">{toast.detail}</p> : null}
          </div>
          <button type="button" className="button button-ghost toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
