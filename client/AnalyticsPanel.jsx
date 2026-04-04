import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";

export default function AnalyticsPanel({ analytics }) {
  if (!analytics) {
    return <div className="empty-state">Analytics will appear after a few saved practice turns.</div>;
  }

  const { summary, scoreTrend, modeBreakdown } = analytics;

  return (
    <section className="analytics-stack">
      <div className="metrics-grid">
        <MetricCard title="Attempts" score={summary.totalAttempts} description="Saved scored turns" />
        <MetricCard title="Average" score={`${summary.avgOverall}/100`} description="Average overall score" />
        <MetricCard title="Best" score={`${summary.bestOverall}/100`} description="Best overall score" />
        <MetricCard title="Delta" score={`${summary.improvementDelta >= 0 ? "+" : ""}${summary.improvementDelta}`} description="Change from first to latest turn" />
      </div>

      <div className="chart-grid">
        <div className="panel chart-card">
          <h3>Score Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={scoreTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,42,44,0.12)" />
              <XAxis dataKey="index" stroke="#5f6a68" />
              <YAxis domain={[0, 100]} stroke="#5f6a68" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="overall" stroke="#b24c2e" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="confidence" stroke="#1f6f50" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="clarity" stroke="#376996" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chart-card">
          <h3>Mode Breakdown</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={modeBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,42,44,0.12)" />
              <XAxis dataKey="modeLabel" stroke="#5f6a68" />
              <YAxis domain={[0, 100]} stroke="#5f6a68" />
              <Tooltip />
              <Legend />
              <Bar dataKey="avgOverall" fill="#b24c2e" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ title, score, description }) {
  return (
    <div className="metric-card">
      <span>{title}</span>
      <strong>{score}</strong>
      <p>{description}</p>
    </div>
  );
}
