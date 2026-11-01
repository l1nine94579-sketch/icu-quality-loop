"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">页面出错了</h1>
          <div className="page-sub">这不是你操作的问题，错误已记录在服务端日志</div>
        </div>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="note bad">
            <strong>错误信息</strong>
            <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 11.5, wordBreak: "break-all" }}>
              {error.message || "未知错误"}
            </div>
            {error.digest ? (
              <div className="hint" style={{ marginTop: 6 }}>
                digest：{error.digest}（可凭此在服务端日志中定位）
              </div>
            ) : null}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" type="button" onClick={() => reset()}>
              重试
            </button>
            <a className="btn" href="/">
              回到工作台
            </a>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            如果重试仍然失败，多半是数据库没有初始化：在项目根目录执行 <code className="mono">pnpm seed</code> 后刷新。
          </div>
        </div>
      </section>
    </main>
  );
}
