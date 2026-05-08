import type { PropsWithChildren } from "react";

export function Page({ children }: PropsWithChildren): JSX.Element {
  return <main className="page">{children}</main>;
}
