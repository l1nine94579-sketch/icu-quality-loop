import { all, run } from "./db";
import type { User } from "./session";

export type AuditEntry = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  note: string | null;
};

export const ACTION_LABEL: Record<string, string> = {
  report_submitted: "提交质控报告",
  report_approved: "审核通过",
  report_returned: "退回修订",
  report_reported: "上报质控中心",
  report_recomputed: "重新取数",
  metrics_rebuilt: "重算患者派生指标",
  observation_added: "补录检验数据",
  event_added: "补录护理事件",
  report_exported: "导出质控报告",
  agent_consulted: "发起 AI 会诊",
  agent_draft_adopted: "采纳 AI 草稿",
};

export function recordAudit(input: {
  actor: User;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}): void {
  run(
    `INSERT INTO audit_logs (at, actor_id, actor_name, role, action, entity, entity_id, before_json, after_json, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    new Date().toISOString(),
    input.actor.id,
    input.actor.name,
    input.actor.role,
    input.action,
    input.entity,
    input.entityId,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.note ?? null,
  );
}

export function listAudit(options: { limit?: number; entity?: string; entityId?: string } = {}): AuditEntry[] {
  const { limit = 50, entity, entityId } = options;
  if (entity && entityId) {
    return all<AuditEntry>(
      "SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?",
      entity,
      entityId,
      limit,
    );
  }
  if (entity) {
    return all<AuditEntry>("SELECT * FROM audit_logs WHERE entity = ? ORDER BY id DESC LIMIT ?", entity, limit);
  }
  return all<AuditEntry>("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", limit);
}
