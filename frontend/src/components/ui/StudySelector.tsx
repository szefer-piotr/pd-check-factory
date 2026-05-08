interface StudySelectorProps {
  value: string;
  onChange: (next: string) => void;
}

export function StudySelector({ value, onChange }: StudySelectorProps): JSX.Element {
  return (
    <label className="control-group" htmlFor="study-id-input">
      <span className="control-label">Study ID</span>
      <input
        id="study-id-input"
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="MY-STUDY"
        autoComplete="off"
      />
    </label>
  );
}
