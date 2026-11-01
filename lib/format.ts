const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getMonth()]}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${pad(d.getDate())}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function pct(rate: number | null | undefined, digits = 1): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v.toFixed(digits)).toString();
}

export function stayLabel(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

export function relativeDays(iso: string, now = new Date()): string {
  const diff = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${diff} 天前`;
}

/** datetime-local 输入框需要 "YYYY-MM-DDTHH:mm" 的本地时间字符串 */
export function datetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
