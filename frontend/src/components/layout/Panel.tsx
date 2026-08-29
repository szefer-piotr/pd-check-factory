import type { PropsWithChildren, ReactNode } from "react";

interface PanelProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  noPadding?: boolean;
  className?: string;
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  noPadding = false,
  className = ""
}: PanelProps): JSX.Element {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="panel-header-text">
            {title ? <h2 className="panel-title">{title}</h2> : null}
            {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      )}
      <div className={noPadding ? "panel-body panel-body-flush" : "panel-body"}>{children}</div>
    </section>
  );
}
