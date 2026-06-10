import { Navigate, Route, Routes } from "react-router-dom";
import { StudyLayout } from "./layouts/StudyLayout";
import { LiveReviewPage } from "./pages/LiveReviewPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SetupPage } from "./pages/SetupPage";
import { SummaryPage } from "./pages/SummaryPage";
import { WelcomePage } from "./pages/WelcomePage";

export function AppRouter(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/welcome" replace />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/projects/new" element={<NewProjectPage />} />
      <Route path="/projects/:studyId" element={<StudyLayout />}>
        <Route index element={<ProjectPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="summary" element={<SummaryPage />} />
        <Route path="review" element={<LiveReviewPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/welcome" replace />} />
    </Routes>
  );
}
