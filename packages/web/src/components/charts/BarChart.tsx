interface BarDatum {
  label: string;
  seriesA: number;
  seriesB: number;
}

interface BarChartProps {
  data: BarDatum[];
  seriesALabel: string;
  seriesBLabel: string;
  colorA?: string;
  colorB?: string;
  height?: number;
}

/**
 * Custom SVG grouped bar chart — no external dependency.
 * Rounded bar tops, horizontal gridlines, x-axis labels. Responsive via viewBox.
 */
export function BarChart({
  data,
  seriesALabel,
  seriesBLabel,
  colorA = '#7C3AED',
  colorB = '#C4B5FD',
  height = 220
}: BarChartProps) {
  const W = 560;
  const H = height;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxV = Math.max(1, ...data.map((d) => Math.max(d.seriesA, d.seriesB)));
  // Round max up to a nice number
  const niceMax = Math.ceil(maxV / 100) * 100 || 100;
  const y = (v: number) => padT + innerH - (Math.min(v, niceMax) / niceMax) * innerH;

  const n = data.length;
  const groupW = innerW / Math.max(1, n);
  const barW = Math.min(28, (groupW - 16) / 2);
  const gap = 4;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = niceMax * f;
    const yy = y(v);
    return { v, yy };
  });

  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${seriesALabel} vs ${seriesBLabel} bar chart`}>
        {/* Gridlines */}
        {gridlines.map(({ v, yy }) => (
          <g key={v}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#E5E1F2" strokeWidth={1} />
            <text x={padL - 8} y={yy + 4} textAnchor="end" fontSize={11} fill="#94A3B8">
              {fmtTick(v)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const gx = padL + i * groupW + groupW / 2;
          const aH = Math.max(0, y(0) - y(d.seriesA));
          const bH = Math.max(0, y(0) - y(d.seriesB));
          const aX = gx - barW - gap / 2;
          const bX = gx + gap / 2;
          const r = Math.min(6, barW / 2);
          return (
            <g key={d.label}>
              {/* Series A */}
              {aH > 0 && (
                <rect
                  x={aX}
                  y={y(d.seriesA)}
                  width={barW}
                  height={aH}
                  rx={r}
                  fill={colorA}
                />
              )}
              {/* Series B */}
              {bH > 0 && (
                <rect
                  x={bX}
                  y={y(d.seriesB)}
                  width={barW}
                  height={bH}
                  rx={r}
                  fill={colorB}
                />
              )}
              <text x={gx} y={H - 10} textAnchor="middle" fontSize={12} fill="#64748B" fontWeight={500}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-5 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorA }} />
          {seriesALabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorB }} />
          {seriesBLabel}
        </span>
      </div>
    </div>
  );
}
