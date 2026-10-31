import { cookies } from "next/headers";
import { all } from "./db";
import { ACTOR_COOKIE, type Role, type User } from "./roles";

export { ROLE_LABEL, ACTOR_COOKIE } from "./roles";
export type { Role, User } from "./roles";

export async function listUsers(): Promise<User[]> {
  return all<User>(
    "SELECT id, name, role, title, dept FROM users ORDER BY CASE role WHEN 'nurse' THEN 1 WHEN 'doctor' THEN 2 WHEN 'qc' THEN 3 ELSE 4 END",
  );
}

/** 演示版登录：用 cookie 记住当前身份，真实系统应接 SSO。 */
export async function currentUser(): Promise<User> {
  const store = await cookies();
  const id = store.get(ACTOR_COOKIE)?.value;
  const users = await listUsers();
  return (
    users.find((u) => u.id === id) ??
    users[0] ?? {
      id: "u-nurse-1",
      name: "王敏",
      role: "nurse" as Role,
      title: "ICU 责任护士",
      dept: "重症医学科",
    }
  );
}

export function canReport(role: Role): boolean {
  return role === "qc";
}

export function canApprove(role: Role): boolean {
  return role === "director";
}
