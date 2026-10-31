"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ROLE_LABEL, type User } from "@/lib/roles";
import { IconAudit, IconDashboard, IconReport, IconTarget, IconUsers } from "./icons";

type Counts = { pendingReview: number; pendingDraft: number; periods: number };

const NAV = [
  { href: "/", label: "临床工作台", icon: IconDashboard, group: "临床" },
  { href: "/patients", label: "患者与专病", icon: IconUsers, group: "临床" },
  { href: "/reports", label: "质控报告", icon: IconReport, group: "质控" },
  { href: "/indicators", label: "指标口径库", icon: IconTarget, group: "质控" },
  { href: "/audit", label: "审计日志", icon: IconAudit, group: "质控" },
];

export function Shell({
  user,
  users,
  counts,
  switchActor,
  children,
}: {
  user: User;
  users: User[];
  counts: Counts;
  switchActor: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const formRef = useRef<HTMLFormElement>(null);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const crumb = (() => {
    if (pathname === "/") return { root: "临床工作台", leaf: null };
    if (pathname.startsWith("/patients/")) return { root: "患者与专病", leaf: "患者详情" };
    if (pathname.startsWith("/patients")) return { root: "患者与专病", leaf: null };
    if (pathname.startsWith("/reports/")) return { root: "质控报告", leaf: "报告详情" };
    if (pathname.startsWith("/reports")) return { root: "质控报告", leaf: null };
    if (pathname.startsWith("/indicators")) return { root: "指标口径库", leaf: null };
    if (pathname.startsWith("/audit")) return { root: "审计日志", leaf: null };
    return { root: "工作台", leaf: null };
  })();

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-dot">Q</span>
            重症质控闭环
          </div>
          <div className="brand-sub">ICU QUALITY LOOP · DEMO</div>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div key={group}>
              <div className="nav-label">{group}</div>
              {NAV.filter((n) => n.group === group).map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const badge =
                  item.href === "/reports"
                    ? user.role === "director"
                      ? counts.pendingReview
                      : counts.pendingDraft
                    : item.href === "/patients"
                      ? null
                      : null;
                return (
                  <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`}>
                    <Icon />
                    <span>{item.label}</span>
                    {badge ? <span className="nav-count">{badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: "#12a594" }} />
            合成数据 · 58 例患者
          </div>
          <div style={{ marginTop: 4, opacity: 0.75 }}>不含任何真实患者信息</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <span>{crumb.root}</span>
            {crumb.leaf ? (
              <>
                <span>/</span>
                <b>{crumb.leaf}</b>
              </>
            ) : null}
          </div>

          <div className="topbar-right">
            <span className="chip">
              <b>{ROLE_LABEL[user.role]}</b>视图
            </span>
            <form ref={formRef} action={switchActor} className="actor" style={{ border: "none", padding: 0 }}>
              <div className="avatar">{user.name.slice(0, 1)}</div>
              <div className="actor-meta">
                <div className="actor-name">{user.name}</div>
                <div className="actor-role">{user.title}</div>
              </div>
              <select
                name="userId"
                defaultValue={user.id}
                aria-label="切换身份"
                onChange={() => formRef.current?.requestSubmit()}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 7,
                  padding: "3px 6px",
                  background: "#fff",
                  fontSize: 11.5,
                  maxWidth: 108,
                }}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{ROLE_LABEL[u.role]}）
                  </option>
                ))}
              </select>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
