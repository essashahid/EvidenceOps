import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { requireWorkspace } from "@/lib/workspace";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  return (
    <>
      <AppNav email={user.email} role={workspace.role} workspaceName={workspace.name} signOutAction={signOutAction} />
      <main className="mx-auto max-w-[1400px] px-4 py-4">{children}</main>
    </>
  );
}
