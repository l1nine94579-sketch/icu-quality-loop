"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTOR_COOKIE, currentUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  approveReport,
  getReport,
  recomputeReport,
  reportToCenter,
  returnReport,
  submitReport,
} from "@/lib/reports";
import { run } from "@/lib/db";
import { rebuildMetrics } from "@/lib/rebuild";

function flash(path: string, message: string, kind: "ok" | "error" = "ok"): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}flash=${encodeURIComponent(message)}&kind=${kind}`);
}

export async function switchActor(formData: FormData): Promise<void> {
  const id = String(formData.get("userId") ?? "");
  const store = await cookies();
  store.set(ACTOR_COOKIE, id, { httpOnly: false, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}

export async function submitReportAction(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const note = String(formData.get("note") ?? "");
  const actor = await currentUser();
  try {
    submitReport(period, actor, note);
  } catch (err) {
    flash(`/reports/${period}`, err instanceof Error ? err.message : "提交失败", "error");
  }
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, `已提交 ${period} 报告，等待科主任审核`);
}

export async function approveAction(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const note = String(formData.get("note") ?? "");
  const actor = await currentUser();
  try {
    approveReport(period, actor, note);
  } catch (err) {
    flash(`/reports/${period}`, err instanceof Error ? err.message : "审核失败", "error");
  }
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, "审核通过，报告可上报质控中心");
}

export async function returnAction(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const note = String(formData.get("note") ?? "");
  const actor = await currentUser();
  try {
    returnReport(period, actor, note);
  } catch (err) {
    flash(`/reports/${period}`, err instanceof Error ? err.message : "退回失败", "error");
  }
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, "已退回，报告版本号 +1");
}

export async function reportOutAction(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const actor = await currentUser();
  try {
    reportToCenter(period, actor);
  } catch (err) {
    flash(`/reports/${period}`, err instanceof Error ? err.message : "上报失败", "error");
  }
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, "已上报质控中心（演示为本地模拟）");
}

export async function recomputeAction(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const actor = await currentUser();
  try {
    recomputeReport(period, actor);
  } catch (err) {
    flash(`/reports/${period}`, err instanceof Error ? err.message : "重算失败", "error");
  }
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, "已按当前口径重新取数，冻结快照未变");
}

export async function rebuildMetricsAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get("patientId") ?? "");
  const actor = await currentUser();
  const result = rebuildMetrics(patientId || undefined);
  recordAudit({
    actor,
    action: "metrics_rebuilt",
    entity: "patient",
    entityId: patientId || "all",
    after: result,
    note: patientId ? "单患者重算派生指标" : "全量重算派生指标",
  });
  revalidatePath("/", "layout");
  flash(patientId ? `/patients/${patientId}` : "/patients", `已重算 ${result.count} 名患者的派生指标`);
}

/** 采纳 AI 草稿：AI 只产出文本，落库必须由人点击确认（HITL） */
export async function adoptAgentDraft(formData: FormData): Promise<void> {
  const period = String(formData.get("period"));
  const note = String(formData.get("note") ?? "");
  const actor = await currentUser();
  const report = getReport(period);
  run("UPDATE qc_reports SET submit_note = ? WHERE period = ?", note, period);
  recordAudit({
    actor,
    action: "agent_draft_adopted",
    entity: "qc_report",
    entityId: period,
    before: { submit_note: report.submit_note },
    after: { submit_note: note },
    note: "采纳 AI 生成的报告说明草稿（人工确认后落库）",
  });
  revalidatePath("/", "layout");
  flash(`/reports/${period}`, "已采纳 AI 草稿，可在提交时继续修改");
}
