import { EVENT_TYPES, OBS_CODES } from "@/lib/entry";
import { datetimeLocal } from "@/lib/format";
import { addCareEventAction, addObservationAction } from "@/app/actions";

/**
 * 补录表单：原生 form + Server Action，不依赖客户端 JS。
 * 默认时间取「入科 + 12h / +2h」，因为大多数质控指标看的是入科 24h 内的动作。
 */
export function EntryForms({
  patientId,
  admittedAt,
  period,
  reportStatus,
  frozen,
}: {
  patientId: string;
  admittedAt: string;
  period: string;
  reportStatus: string;
  frozen: boolean;
}) {
  const defaultObsAt = datetimeLocal(new Date(new Date(admittedAt).getTime() + 12 * 3600 * 1000).toISOString());
  const defaultEventAt = datetimeLocal(new Date(new Date(admittedAt).getTime() + 2 * 3600 * 1000).toISOString());

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="note">
        补录会立即重算该患者的派生指标（KDIGO / 柏林），并记录审计。
        {frozen
          ? `${period} 报告已冻结，补录只改变「当前重算值」，不会改写已上报的数字——差异可在报告页对比。`
          : `${period} 报告尚未冻结，补录会直接改变本月指标分子分母。`}
      </div>

      <form action={addObservationAction}>
        <input type="hidden" name="patientId" value={patientId} />
        <div className="field">
          <label>补录检验 / 监护数据</label>
          <div className="row" style={{ gap: 6 }}>
            <select name="code" className="select" defaultValue="creatinine" style={{ flex: "1 1 130px" }}>
              {OBS_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}（{c.unit}）
                </option>
              ))}
            </select>
            <input
              className="input"
              name="value"
              type="number"
              step="0.01"
              placeholder="数值"
              required
              style={{ flex: "0 1 100px" }}
            />
          </div>
        </div>
        <div className="field">
          <label>测量时间</label>
          <input className="input" type="datetime-local" name="measuredAt" defaultValue={defaultObsAt} required />
          <div className="hint">默认取入科后 12 小时；时间点会影响「入科 24h 内」类指标。</div>
        </div>
        <button className="btn btn-primary" type="submit" style={{ width: "100%", justifyContent: "center" }}>
          保存并重算
        </button>
      </form>

      <div className="divider" style={{ margin: "4px 0" }} />

      <form action={addCareEventAction}>
        <input type="hidden" name="patientId" value={patientId} />
        <div className="field">
          <label>补录护理事件 / 医嘱执行</label>
          <select name="type" className="select" defaultValue="dvt_prophylaxis">
            {EVENT_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>发生时间</label>
          <input className="input" type="datetime-local" name="at" defaultValue={defaultEventAt} required />
        </div>
        <div className="field">
          <label>说明（可选）</label>
          <input className="input" name="label" placeholder="例如：低分子肝素 4000U 皮下注射" />
        </div>
        <button className="btn" type="submit" style={{ width: "100%", justifyContent: "center" }}>
          保存事件并重算
        </button>
        <div className="hint" style={{ marginTop: 6 }}>
          当前报告状态：{reportStatus}
          {frozen ? " · 已冻结" : ""}
        </div>
      </form>
    </div>
  );
}
