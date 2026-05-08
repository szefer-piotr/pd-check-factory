import type { PropsWithChildren } from "react";

export function Card({ children }: PropsWithChildren): JSX.Element {
  return <article className="card">{children}</article>;
}
