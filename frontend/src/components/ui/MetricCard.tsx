import { Card } from "../layout/Card";

interface MetricCardProps {
  label: string;
  value: string | number;
}

export function MetricCard({ label, value }: MetricCardProps): JSX.Element {
  return (
    <Card>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </Card>
  );
}
