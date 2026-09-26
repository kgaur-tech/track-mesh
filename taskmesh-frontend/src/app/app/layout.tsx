import { AppShell } from "@/components/layout/shells";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  if (process.env.NODE_ENV !== "development") {
    const result = await requireUser();
    if ("response" in result) redirect("/sign-in?callbackUrl=/app/dashboard");
  }

  return <AppShell role="student">{children}</AppShell>;
}
