import type { DeviationItem } from "../../types/study";
import { Card } from "../layout/Card";

interface DeviationListProps {
  items: DeviationItem[];
}

export function DeviationList({ items }: DeviationListProps): JSX.Element {
  return (
    <div className="deviation-list" role="list" aria-label="Deviation results">
      {items.map((item) => (
        <Card key={item.id}>
          <div className="deviation-header">
            <h3>{item.title}</h3>
            <span className={`status-chip status-${item.status}`}>{item.status.replace("_", " ")}</span>
          </div>
          <p className="deviation-summary">{item.summary}</p>
          <p className="deviation-rule">Rule: {item.ruleId}</p>
        </Card>
      ))}
    </div>
  );
}
