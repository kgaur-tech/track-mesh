import { AppShell } from "@/components/layout/shells";
import { requireRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  if (process.env.NODE_ENV !== "development") {
    const result = await requireRole(["LEADER", "ADMIN"]);
    if ("response" in result) redirect("/app");
  }

  return <AppShell role="leader">{children}</AppShell>;
}
