import type { PropsWithChildren } from "react";

interface SectionProps extends PropsWithChildren {
  title?: string;
}

export function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <section className="section" aria-label={title}>
      {title ? <h2 className="section-title">{title}</h2> : null}
      {children}
    </section>
  );
}
