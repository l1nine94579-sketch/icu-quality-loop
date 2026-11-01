import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">找不到这个页面</h1>
          <div className="page-sub">链接可能已失效，或者这条记录不存在 / 已被删除</div>
        </div>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="empty" style={{ padding: "34px 16px" }}>
            <div className="mono" style={{ fontSize: 34, fontWeight: 700, color: "var(--line-strong)" }}>
              404
            </div>
            <div style={{ marginTop: 8 }}>没有找到对应的页面或患者记录</div>
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 8 }}>
            <Link className="btn btn-primary" href="/">
              回到工作台
            </Link>
            <Link className="btn" href="/patients">
              患者列表
            </Link>
            <Link className="btn" href="/reports">
              质控报告
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
