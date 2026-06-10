import { useContext } from "react";
import { StudyContext } from "../context/studyContext";

export function useStudyContext() {
  const context = useContext(StudyContext);
  if (!context) {
    throw new Error("useStudyContext must be used within StudyProvider");
  }
  return context;
}
