export interface TrendPoint {
  date: string;
  value: number | null | undefined;
}

export interface TrendSeries {
  label: string;
  points: TrendPoint[];
  // A Tailwind `text-*` color pair (e.g. "text-accent dark:text-accent-dark")
  // — applied once to a wrapping <g>, then every stroke/fill below
  // references `currentColor` to inherit it. Simpler than juggling separate
  // stroke-color and fill-color utility classes for the line vs. its dots.
  colorClassName: string;
}

// A small hand-rolled SVG line chart — no charting library added as a
// dependency for this, the same "simple hand-rolled client over a library
// for a narrow need" judgment call the Apple (CalDAV) sync increment's own
// ICS parser already made. Assumes every series in the same chart shares
// one x-axis (same point count, same dates in the same order) — true for
// how AnalyticsPage uses this today (mood+energy on one chart, sleep
// duration on its own).
export function TrendChart({
  series,
  min,
  max,
  height = 96,
}: {
  series: TrendSeries[];
  min: number;
  max: number;
  height?: number;
}) {
  const width = 300;
  const pointCount = series[0]?.points.length ?? 0;

  if (pointCount < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-text-secondary dark:text-text-secondary-dark">
        Not enough data yet.
      </div>
    );
  }

  const xStep = width / (pointCount - 1);
  const range = max - min || 1;

  function toXY(index: number, value: number): [number, number] {
    const x = index * xStep;
    const clamped = Math.min(max, Math.max(min, value));
    const y = height - ((clamped - min) / range) * height;
    return [x, y];
  }

  // Screen-reader pass: this SVG previously had no accessible name at all
  // (no role, no aria-label, no <title>) — a screen reader either skipped
  // it silently or announced nothing meaningful. The preceding <h2> on
  // AnalyticsPage already names the metric (e.g. "Sleep duration"), so this
  // adds the one thing that heading doesn't cover: which series are
  // plotted and over how many days. Being honest about the limit of this
  // fix: it names the chart, it does not expose each day's exact value as
  // text — a real remaining gap for anyone who needs the precise numbers,
  // not just the trend shape.
  const chartLabel = `Line chart of ${series.map((s) => s.label).join(' and ')} over the last ${pointCount} days.`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label={chartLabel}
    >
      {/* A light baseline so a mostly-empty chart still reads as "a chart
          with little data" rather than looking broken/blank. */}
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} className="stroke-border dark:stroke-border-dark" strokeWidth={1} />

      {series.map((s) => {
        // The one piece of real logic here: split into separate polylines
        // wherever a null value creates a gap, so a real missing day shows
        // as a visible break rather than a straight line silently bridging
        // over it — a run of consecutive known points is one segment, each
        // segment gets its own <polyline>.
        const segments: Array<Array<[number, number]>> = [];
        let current: Array<[number, number]> = [];
        s.points.forEach((p, i) => {
          if (p.value === null || p.value === undefined) {
            if (current.length) segments.push(current);
            current = [];
            return;
          }
          current.push(toXY(i, p.value));
        });
        if (current.length) segments.push(current);

        return (
          <g key={s.label} className={s.colorClassName}>
            {segments.map((seg, segIndex) => (
              <g key={segIndex}>
                {seg.length > 1 && (
                  <polyline
                    points={seg.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  />
                )}
                {seg.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={2.5} fill="currentColor" />
                ))}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
