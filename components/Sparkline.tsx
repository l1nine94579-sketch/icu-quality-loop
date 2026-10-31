import { fmtDateTime } from "@/lib/format";

type Point = { at: string; value: number };

/** 极简趋势线：不引入图表库，保证零依赖与一致的渲染结果 */
export function Sparkline({
  points,
  baseline,
  height = 96,
  unit = "",
  width = 520,
}: {
  points: Point[];
  baseline?: number | null;
  height?: number;
  unit?: string;
  width?: number;
}) {
  if (points.length < 2) {
    return <div className="empty" style={{ padding: 18 }}>数据点不足，无法绘制趋势</div>;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values, baseline ?? Infinity) * 0.9;
  const max = Math.max(...values, baseline ?? -Infinity) * 1.05;
  const span = max - min || 1;
  const padX = 10;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const x = (i: number) => padX + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padY + innerH - ((v - min) / span) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${height - padY} L${x(0).toFixed(1)},${height - padY} Z`;
  const baseY = baseline != null ? y(baseline) : null;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="趋势图">
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12a594" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#12a594" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={width - padX}
            y1={padY + innerH * f}
            y2={padY + innerH * f}
            stroke="#eef2f6"
            strokeWidth="1"
          />
        ))}
        {baseY != null ? (
          <>
            <line x1={padX} x2={width - padX} y1={baseY} y2={baseY} stroke="#98a2b3" strokeDasharray="4 3" strokeWidth="1" />
            <text x={width - padX} y={baseY - 4} fontSize="9" fill="#98a2b3" textAnchor="end">
              基线 {baseline}
            </text>
          </>
        ) : null}
        <path d={area} fill="url(#spark)" />
        <path d={path} fill="none" stroke="#0b6b68" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.at} cx={x(i)} cy={y(p.value)} r={2.2} fill="#0b6b68" />
        ))}
      </svg>
      <div className="row between faint" style={{ fontSize: 10.5, padding: "0 4px" }}>
        <span>{fmtDateTime(points[0].at)}</span>
        <span>
          峰值 {Math.max(...values).toFixed(2)} {unit}
        </span>
        <span>{fmtDateTime(points[points.length - 1].at)}</span>
      </div>
    </div>
  );
}
