import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { currentUser, listUsers } from "@/lib/session";
import { chromeCounts } from "@/lib/repo";
import { switchActor } from "./actions";

export const metadata: Metadata = {
  title: "重症质控闭环工作台",
  description: "多角色审批 + 指标口径可追溯 + 可解释的临床 Agent（演示）",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, users] = await Promise.all([currentUser(), listUsers()]);
  const counts = chromeCounts();

  return (
    <html lang="zh-CN">
      <body>
        <Shell user={user} users={users} counts={counts} switchActor={switchActor}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
