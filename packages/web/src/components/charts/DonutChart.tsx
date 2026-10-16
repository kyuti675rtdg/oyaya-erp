interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}

/**
 * Custom SVG donut chart — no external dependency.
 * Renders segments as arcs with a center label/value and a dot legend below.
 */
export function DonutChart({ segments, centerValue, centerLabel, size = 190 }: DonutChartProps) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const r = 70;
  const cx = 100;
  const cy = 100;
  const strokeW = 26;
  const C = 2 * Math.PI * r;

  let acc = 0;
  const arcs = segments.map((seg) => {
    const frac = total > 0 ? Math.max(0, seg.value) / total : 0;
    const start = acc;
    acc += frac;
    return { ...seg, start, frac };
  });

  // Rotate so the first segment starts at 12 o'clock
  const rot = -90;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        role="img"
        aria-label={`${centerLabel}: ${centerValue}`}
      >
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EDE9F7" strokeWidth={strokeW} />
        {/* Segments */}
        {arcs.map((a, i) =>
          a.frac > 0 ? (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={strokeW}
              strokeDasharray={`${(a.frac * C).toFixed(2)} ${C.toFixed(2)}`}
              strokeDashoffset={(-a.start * C).toFixed(2)}
              strokeLinecap="butt"
              transform={`rotate(${rot} ${cx} ${cy})`}
            />
          ) : null
        )}
        {/* Center text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={26} fontWeight={800} fill="#1E1B2E">
          {centerValue}
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" fontSize={12} fill="#8B8AA3">
          {centerLabel}
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-3 w-full space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-slate-600">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-800">{s.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
