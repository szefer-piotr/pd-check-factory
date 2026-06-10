import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { createStudy } from "../services/stepApi";

function validateStudyId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Study ID is required.";
  }
  if (trimmed.includes("/")) {
    return "Study ID must not contain '/'.";
  }
  return null;
}

export function NewProjectPage(): JSX.Element {
  const navigate = useNavigate();
  const [studyId, setStudyId] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const validationError = validateStudyId(studyId);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const created = await createStudy(studyId.trim());
      navigate(`/projects/${encodeURIComponent(created.studyId)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Page>
      <Stack gap="lg">
        <Section>
          <Link className="text-link" to="/welcome">
            Back to Welcome
          </Link>
          <h1 className="page-title">New Project</h1>
          <p className="page-lead">Enter a unique study identifier for this workspace.</p>
          <form className="new-project-form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="control-group" htmlFor="study-id">
              <span className="control-label">Study ID</span>
              <input
                id="study-id"
                className="input"
                value={studyId}
                onChange={(event) => setStudyId(event.target.value)}
                placeholder="e.g. STUDY-2026-001"
                autoComplete="off"
              />
            </label>
            {error ? <p className="step1-error">{error}</p> : null}
            <button className="button button-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create project"}
            </button>
          </form>
        </Section>
      </Stack>
    </Page>
  );
}
