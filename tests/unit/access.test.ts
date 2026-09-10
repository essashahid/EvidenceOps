import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: () => ({ PUBLIC_DEMO_MODE: true, DEMO_MUTATIONS_ENABLED: false }), jobsConfigured: () => false }));
import { assertMutation, mutationAllowed } from "@/lib/access";
import type { SessionContext, WorkspaceRole } from "@/lib/workspace";
const context = (role: WorkspaceRole, isPublic=false): SessionContext => ({user:{id:"u",email:"test@example.test",displayName:"Test"},workspace:{workspaceId:"w",slug:"demo",name:"Demo",role},isPublic});
describe("public demo authorization",()=>{
  it("rejects anonymous mutation calls before accessing the database",async()=>{
    await expect(assertMutation(context("viewer",true),"upload")).rejects.toThrow("read-only");
  });
  it("keeps viewer and reviewer sessions read-only when demo mutations are disabled",()=>{
    expect(mutationAllowed(context("viewer"))).toBe(false);
    expect(mutationAllowed(context("reviewer"))).toBe(false);
  });
  it("rejects job mutations before database writes while Inngest is missing", async () => {
    await expect(assertMutation(context("admin"), "upload")).rejects.toThrow("Background processing is not configured");
  });
  it("allows signed-in admins to manage the demo",()=>{
    expect(mutationAllowed(context("admin"))).toBe(true);
    expect(mutationAllowed(context("admin",true))).toBe(false);
  });
});
