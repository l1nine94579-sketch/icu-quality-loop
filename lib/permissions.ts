import type { Role, User } from "./roles";
import { ROLE_LABEL } from "./roles";

/**
 * 能力（Capability）而不是角色判断。
 *
 * 页面与 Server Action 都只问"这个身份有没有这个能力"，不写 `if (role === 'qc')`：
 * 以后加"院感科"只需要改矩阵，不用满项目找判断。
 */
export type Capability =
  | "patient:view"
  | "patient:edit"
  | "indicator:view"
  | "report:view"
  | "report:submit"
  | "report:recompute"
  | "report:review"
  | "report:reportOut"
  | "audit:view"
  | "agent:patient"
  | "agent:period";

export const CAP_LABEL: Record<Capability, string> = {
  "patient:view": "查看患者",
  "patient:edit": "补录数据 / 重算派生指标",
  "indicator:view": "查看指标口径",
  "report:view": "查看质控报告",
  "report:submit": "提交 / 修订报告",
  "report:recompute": "按当前口径重取数",
  "report:review": "审核 / 退回报告",
  "report:reportOut": "上报质控中心",
  "audit:view": "查看审计日志",
  "agent:patient": "患者级 AI 会诊",
  "agent:period": "报告级 AI 会诊",
};

/**
 * 权限矩阵：四类身份，11 项能力。
 * 设计原则来自真实科室分工：护士录数、医生看专病、质控员出报告、主任审签。
 */
const MATRIX: Record<Role, Capability[]> = {
  nurse: ["patient:view", "patient:edit", "report:view", "agent:patient"],
  doctor: ["patient:view", "indicator:view", "report:view", "agent:patient"],
  qc: [
    "patient:view",
    "patient:edit",
    "indicator:view",
    "report:view",
    "report:submit",
    "report:recompute",
    "report:reportOut",
    "audit:view",
    "agent:period",
  ],
  director: [
    "patient:view",
    "indicator:view",
    "report:view",
    "report:review",
    "report:reportOut",
    "audit:view",
    "agent:period",
  ],
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

export function allows(user: User, capability: Capability): boolean {
  return can(user.role, capability);
}

export function capabilitiesOf(role: Role): Capability[] {
  return MATRIX[role] ?? [];
}

/** 哪些角色拥有这项能力（用于 403 页面告诉用户该找谁） */
export function rolesWith(capability: Capability): Role[] {
  return (Object.keys(MATRIX) as Role[]).filter((role) => can(role, capability));
}

export class PermissionError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability, role?: Role) {
    const who = role ? `当前身份「${ROLE_LABEL[role]}」` : "当前身份";
    super(`${who}没有「${CAP_LABEL[capability]}」权限`);
    this.name = "PermissionError";
    this.capability = capability;
  }
}

/** 服务端硬校验：页面与 Server Action 的第一行都应该调用它 */
export function assertCan(user: User, capability: Capability): void {
  if (!can(user.role, capability)) throw new PermissionError(capability, user.role);
}
