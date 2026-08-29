import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <button type="button" className="confirm-dialog-backdrop" aria-label="Dismiss" onClick={onCancel} />
      <div className="confirm-dialog-card">
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h2>
        <div className="confirm-dialog-body">{children}</div>
        <div className="confirm-dialog-actions">
          <button type="button" className="button button-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`button ${danger ? "button-danger" : "button-primary"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
