import { type PropsWithChildren } from "react";
import { StudyContext, type StudyContextValue } from "./studyContext";

export function StudyProvider({
  value,
  children
}: PropsWithChildren<{ value: StudyContextValue }>): JSX.Element {
  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}
