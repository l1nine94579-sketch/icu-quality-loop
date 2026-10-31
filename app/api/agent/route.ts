import { NextResponse } from "next/server";
import { persistRun, runAgent } from "@/lib/agent";
import { currentUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { question?: string; patientId?: string; period?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const question = (body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ error: "问题不能为空" }, { status: 400 });

  const user = await currentUser();

  // 患者级会诊只对临床角色开放；报告级会诊只对质控/管理角色开放
  const capability = body.patientId ? "agent:patient" : "agent:period";
  if (!can(user.role, capability)) {
    return NextResponse.json(
      {
        error: body.patientId
          ? "患者级 AI 会诊仅对责任护士与主管医生开放，请切换到临床身份后重试。"
          : "报告级 AI 会诊仅对科室质控员与科主任开放。",
      },
      { status: 403 },
    );
  }

  try {
    const result = await runAgent({ question, patientId: body.patientId, period: body.period });
    const runId = persistRun({ question, patientId: body.patientId, period: body.period }, user.id, result);
    recordAudit({
      actor: user,
      action: "agent_consulted",
      entity: body.patientId ? "patient" : "period",
      entityId: body.patientId ?? body.period ?? "—",
      after: { engine: result.engine, tools: result.steps.map((s) => s.tool) },
      note: question.slice(0, 80),
    });
    return NextResponse.json({ ...result, runId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent 执行失败" },
      { status: 500 },
    );
  }
}
