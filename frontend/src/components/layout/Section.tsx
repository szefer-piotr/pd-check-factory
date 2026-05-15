import type { PropsWithChildren } from "react";

interface SectionProps extends PropsWithChildren {
  title?: string;
  className?: string;
}

export function Section({ title, children, className }: SectionProps): JSX.Element {
  const classes = ["section", className].filter(Boolean).join(" ");
  return (
    <section className={classes} aria-label={title}>
      {title ? <h2 className="section-title">{title}</h2> : null}
      {children}
    </section>
  );
}
