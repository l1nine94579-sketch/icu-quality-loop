import { NextResponse } from "next/server";
import { persistRun, runAgent } from "@/lib/agent";
import { currentUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

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
