export default function Loading() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="sk sk-title" />
          <div className="sk sk-sub" />
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="card kpi" key={i}>
            <div className="sk sk-line" style={{ width: "45%" }} />
            <div className="sk sk-value" />
            <div className="sk sk-line" style={{ width: "60%", marginTop: 8 }} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="sk sk-line" style={{ width: 120 }} />
        </div>
        <div className="card-body">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="sk sk-row" key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
