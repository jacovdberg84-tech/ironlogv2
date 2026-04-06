type TopKpiSummaryGridProps = {
  mtbf: number | string;
  mttr: number | string;
  utilizationAvg: number;
  tonnesHauled: number | string;
};

export function TopKpiSummaryGrid({ mtbf, mttr, utilizationAvg, tonnesHauled }: TopKpiSummaryGridProps) {
  const kpiItems = [
    {
      title: "MTBF",
      value: `${mtbf} hrs`,
      detail: "Mean time between failures",
      tone: "accent"
    },
    {
      title: "MTTR",
      value: `${mttr} hrs`,
      detail: "Mean time to repair",
      tone: "warning"
    },
    {
      title: "Equipment Utilization",
      value: `${utilizationAvg}%`,
      detail: "Fleet-wide average",
      tone: utilizationAvg >= 80 ? "accent" : utilizationAvg < 55 ? "danger" : "default"
    },
    {
      title: "Tonnes Hauled",
      value: String(tonnesHauled),
      detail: "Current operations snapshot",
      tone: "default"
    }
  ] as const;

  return (
    <section className="kpi-grid" aria-label="Operations key performance indicators">
      {kpiItems.map((kpi) => (
        <article key={kpi.title} className={`kpi-card kpi-tone-${kpi.tone}`}>
          <p className="kpi-label">{kpi.title}</p>
          <h2 className="kpi-value">{kpi.value}</h2>
          <p className="kpi-meta">{kpi.detail}</p>
        </article>
      ))}
    </section>
  );
}
