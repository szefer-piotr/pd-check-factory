import type { PropsWithChildren } from "react";

interface StackProps extends PropsWithChildren {
  gap?: "sm" | "md" | "lg";
}

export function Stack({ children, gap = "md" }: StackProps): JSX.Element {
  return <div className={`stack stack-${gap}`}>{children}</div>;
}
