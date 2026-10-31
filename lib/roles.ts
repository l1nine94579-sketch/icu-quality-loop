/** 角色与身份：纯类型/常量模块，可被客户端组件安全引用 */
export type Role = "nurse" | "doctor" | "qc" | "director";

export type User = {
  id: string;
  name: string;
  role: Role;
  title: string;
  dept: string;
};

export const ROLE_LABEL: Record<Role, string> = {
  nurse: "责任护士",
  doctor: "主管医生",
  qc: "科室质控员",
  director: "科主任",
};

export const ACTOR_COOKIE = "icu_actor";

export type ReportStatus = "draft" | "submitted" | "approved" | "returned" | "reported";

export const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: "填报中",
  submitted: "待审核",
  approved: "已通过",
  returned: "已退回",
  reported: "已上报",
};

export const STATUS_TONE: Record<ReportStatus, string> = {
  draft: "neutral",
  submitted: "warn",
  approved: "ok",
  returned: "bad",
  reported: "info",
};
