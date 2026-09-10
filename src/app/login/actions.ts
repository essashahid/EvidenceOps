"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth/session";

export type LoginState = { error: string | null };

function safeNext(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !/^\/[\\/]/.test(s) ? s : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const result = await signIn(email, password);
  if (!result.ok) return { error: result.error };
  redirect(next);
}
