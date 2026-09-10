import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export interface ObjectStorage {
  readonly driver: "local" | "supabase";
  put(objectPath: string, bytes: Buffer, contentType: string): Promise<void>;
  get(objectPath: string): Promise<Buffer>;
  exists(objectPath: string): Promise<boolean>;
}

function safeJoin(root: string, objectPath: string): string {
  const full = path.resolve(root, objectPath);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`invalid object path ${objectPath}`);
  return full;
}

export function createLocalStorage(root: string): ObjectStorage {
  return {
    driver: "local",
    async put(objectPath, bytes) {
      const full = safeJoin(root, objectPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, full);
    },
    async get(objectPath) {
      return fs.readFile(safeJoin(root, objectPath));
    },
    async exists(objectPath) {
      try {
        await fs.access(safeJoin(root, objectPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createSupabaseStorage(url: string, serviceKey: string, bucket: string): ObjectStorage {
  async function client() {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return {
    driver: "supabase",
    async put(objectPath, bytes, contentType) {
      const sb = await client();
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await sb.storage.from(bucket).upload(objectPath, bytes, { contentType, upsert: true });
        if (!error) return;
        lastErr = error;
      }
      throw new Error(`storage upload failed after 3 attempts: ${String((lastErr as Error)?.message ?? lastErr)}`);
    },
    async get(objectPath) {
      const sb = await client();
      const { data, error } = await sb.storage.from(bucket).download(objectPath);
      if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async exists(objectPath) {
      const sb = await client();
      const dir = path.posix.dirname(objectPath);
      const base = path.posix.basename(objectPath);
      const { data } = await sb.storage.from(bucket).list(dir, { search: base });
      return Boolean(data?.some((f) => f.name === base));
    },
  };
}

let cached: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (cached) return cached;
  const e = env();
  if (e.STORAGE_DRIVER === "supabase") {
    if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase storage requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    cached = createSupabaseStorage(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, e.SUPABASE_STORAGE_BUCKET);
  } else {
    const root = e.NODE_ENV === "test" || e.EVIDENCEOPS_DB === "test" ? `${e.LOCAL_STORAGE_DIR}-test` : e.LOCAL_STORAGE_DIR;
    cached = createLocalStorage(path.resolve(/* turbopackIgnore: true */ process.cwd(), root));
  }
  return cached;
}

export function resetStorageCache() {
  cached = null;
}
