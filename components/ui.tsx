import Link from "next/link";
import { STATUS_LABEL, STATUS_TONE, type ReportStatus } from "@/lib/roles";

export function Pill({ tone = "neutral", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: ReportStatus }) {
  return (
    <span className={`pill ${STATUS_TONE[status]}`}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const AKI_TONE = ["neutral", "info", "warn", "bad"];
export function AkiPill({ stage }: { stage: number | null | undefined }) {
  if (stage == null) return <span className="faint">—</span>;
  if (stage === 0) return <span className="pill neutral">无 AKI</span>;
  return <span className={`pill ${AKI_TONE[stage]}`}>AKI {stage} 期</span>;
}

export function ArdsPill({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <span className="faint">—</span>;
  const map: Record<string, [string, string]> = {
    none: ["neutral", "未达标准"],
    mild: ["info", "轻度"],
    moderate: ["warn", "中度"],
    severe: ["bad", "重度"],
    insufficient: ["neutral", "数据不足"],
  };
  const [tone, label] = map[severity] ?? ["neutral", severity];
  return <span className={`pill ${tone}`}>{label}</span>;
}

export function Kpi({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: "ok" | "warn" | "bad";
}) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : undefined;
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "ok" | "warn" | "bad" }) {
  const pctValue = Math.max(0, Math.min(100, value * 100));
  const cls = tone ?? (value >= 0.9 ? "ok" : value >= 0.7 ? "warn" : "bad");
  return (
    <div className="meter">
      <div className={`meter-fill ${cls}`} style={{ width: `${pctValue}%` }} />
    </div>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  bodyClass,
  foot,
}: {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClass?: string;
  foot?: React.ReactNode;
}) {
  return (
    <section className="card">
      {title || actions ? (
        <header className="card-head">
          <div>
            <h2 className="card-title">{title}</h2>
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          <div className="spacer" />
          {actions}
        </header>
      ) : null}
      <div className={`card-body ${bodyClass ?? ""}`}>{children}</div>
      {foot ? <footer className="card-foot">{foot}</footer> : null}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Flash({ message, kind }: { message?: string; kind?: string }) {
  if (!message) return null;
  const cls = kind === "error" ? "note bad" : "note";
  return <div className={cls} style={{ marginBottom: 14 }}>{message}</div>;
}

export function Delta({ value, direction = "up" }: { value: number | null; direction?: "up" | "down" | "info" }) {
  if (value == null) return <span className="faint">—</span>;
  const pp = value * 100;
  const good = direction === "info" ? null : direction === "down" ? pp < 0 : pp > 0;
  const color =
    Math.abs(pp) < 0.05 || good === null ? "var(--muted)" : good ? "var(--ok)" : "var(--bad)";
  return (
    <span className="tnum" style={{ color, fontSize: 11.5, fontWeight: 600 }}>
      {pp > 0 ? "+" : ""}
      {pp.toFixed(1)}pp
    </span>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="muted" style={{ fontSize: 12 }}>
      ← {children}
    </Link>
  );
}
