import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  type CapturedWrite,
  FAILOVER_WINDOW_MS,
  isConnectionFailureError,
  normalizeQueryArgs,
  prepareCapturedWrite,
  PRIMARY_TIMEOUT_MS,
  scheduleDualWriteToBackup,
  scheduleFailoverWriteLog,
  schedulePrimaryRecoveryProbe,
  triggerHaTelegramAlert,
  withTimeout,
} from "@/lib/db-ha";

const primaryUrl = process.env.DATABASE_URL?.trim() || "";
const backupUrl =
  process.env.FALLBACK_DATABASE_URL?.trim() ||
  process.env.DATABASE_BACKUP_URL?.trim() ||
  "";

const globalForDb = globalThis as typeof globalThis & {
  __maestroPrimaryPool?: Pool;
  __maestroBackupPool?: Pool;
  __maestroFailoverWrapper?: Pool;
  __maestroDrizzleDb?: ReturnType<typeof drizzle>;
  __maestroFailoverUntil?: number;
};

/**
 * تهيئة رابط PostgreSQL لبيئة Supabase / Neon مع تجنب تعارض sslmode=require في pg@8.20+
 */
function buildPoolConfig(rawUrl: string, isBackup = false): PoolConfig {
  let connectionString = rawUrl;
  let disableSsl = false;
  let isLocalhost = false;

  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode === "disable") {
      disableSsl = true;
    } else if (sslMode) {
      // إزالة sslmode من الرابط حتى لا يفرض pg وضع verify-full على شهادات Supabase Pooler
      parsed.searchParams.delete("sslmode");
      connectionString = parsed.toString();
    }
    isLocalhost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {
    // في حال لم يكن URL قياسياً، نمرره كما هو
  }

  const config: PoolConfig = {
    connectionString,
    max: isBackup ? 3 : 6,
    idleTimeoutMillis: 8000,
    connectionTimeoutMillis: isBackup ? 12000 : PRIMARY_TIMEOUT_MS,
    query_timeout: isBackup ? 15000 : PRIMARY_TIMEOUT_MS,
    allowExitOnIdle: true,
  };

  if (!disableSsl && (!isLocalhost || rawUrl.includes("sslmode=") || rawUrl.includes("supabase") || rawUrl.includes("neon.tech"))) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

function getOrCreateBackupPool(): Pool | null {
  if (!backupUrl) return null;
  if (!globalForDb.__maestroBackupPool) {
    const bp = new Pool(buildPoolConfig(backupUrl, true));
    bp.on("error", (err) => {
      console.error("[PostgreSQL Backup/Neon Pool Error]", err?.message);
    });
    globalForDb.__maestroBackupPool = bp;
  }
  return globalForDb.__maestroBackupPool;
}

function activateFailoverWindow(reason: unknown): Pool | null {
  globalForDb.__maestroFailoverUntil = Date.now() + FAILOVER_WINDOW_MS;
  const errMsg = reason instanceof Error ? reason.message : String(reason || "Timeout / Connection error");
  console.error("[DB Failover] Primary (Supabase) unreachable or >3s — failing over to Neon:", errMsg);

  const bp = getOrCreateBackupPool();
  if (bp) {
    triggerHaTelegramAlert("PRIMARY_FAILOVER", "🚨 تحذير طوارئ: تحويل تلقائي إلى القاعدة الاحتياطية (Neon)", [
      `تعذر الاتصال بالقاعدة الأساسية (Supabase) أو تجاوزت مهلة الـ 3 ثوانٍ.`,
      `السبب: ${errMsg}`,
      `تم تفعيل التحويل التلقائي (Active-Passive Failover) فوراً إلى Neon لضمان عدم توقف النظام.`,
    ]);
  } else {
    triggerHaTelegramAlert("PRIMARY_DOWN_NO_BACKUP", "🚨 تعذر الاتصال بقاعدة البيانات الأساسية (Supabase)", [
      `الخطأ: ${errMsg}`,
      `القاعدة الاحتياطية (FALLBACK_DATABASE_URL) غير مضبوطة!`,
    ]);
  }
  return bp;
}

async function ensureBackupReady(bp: Pool): Promise<void> {
  try {
    const { ensureSchemaOnPool } = await import("@/lib/schema-check");
    await ensureSchemaOnPool(bp, { label: "Neon Backup" });
  } catch (e) {
    console.warn("[DB Failover] Backup schema ensure warning:", e instanceof Error ? e.message : e);
  }
}

function wrapHaClient(initialClient: PoolClient, initialSource: "primary" | "backup"): PoolClient {
  let activeClient = initialClient;
  let source = initialSource;
  let inTx = false;
  let txWrites: CapturedWrite[] = [];

  const wrapped: any = new Proxy(initialClient as any, {
    get(_target, prop) {
      if (prop === "release") {
        return (err?: Error | boolean) => activeClient.release(err);
      }

      if (prop === "query") {
        return async (...args: any[]) => {
          const { text, params, hasCallback } = normalizeQueryArgs(args);
          if (hasCallback) {
            return (activeClient.query as any)(...args);
          }

          const upper = text.trim().slice(0, 16).toUpperCase();
          const isBegin = upper.startsWith("BEGIN");
          const isCommit = upper.startsWith("COMMIT");
          const isRollback = upper.startsWith("ROLLBACK");

          const runOnClient = async (c: PoolClient, src: "primary" | "backup") => {
            if (src === "primary") {
              return withTimeout((c.query as any)(...args), PRIMARY_TIMEOUT_MS, "tx-query");
            }
            return (c.query as any)(...args);
          };

          try {
            const res = await runOnClient(activeClient, source);

            if (isBegin) {
              inTx = true;
              txWrites = [];
            } else if (isRollback) {
              inTx = false;
              txWrites = [];
            } else if (isCommit) {
              const batch = txWrites;
              txWrites = [];
              inTx = false;
              if (batch.length > 0) {
                if (source === "primary") {
                  scheduleDualWriteToBackup(batch);
                } else {
                  scheduleFailoverWriteLog(batch);
                }
              }
            } else {
              const captured = prepareCapturedWrite(text, params, res);
              if (captured) {
                if (inTx) {
                  txWrites.push(captured);
                } else if (source === "primary") {
                  scheduleDualWriteToBackup([captured]);
                } else {
                  scheduleFailoverWriteLog([captured]);
                }
              }
            }

            return res;
          } catch (err) {
            // إذا فشل BEGIN أو أول استعلام قراءة قبل بدء أي كتابة داخل المعاملة، نحول الاتصال تلقائياً لـ Neon
            if (source === "primary" && backupUrl && txWrites.length === 0 && isConnectionFailureError(err)) {
              const bp = activateFailoverWindow(err);
              if (bp) {
                try {
                  activeClient.release(true);
                } catch {}
                await ensureBackupReady(bp);
                activeClient = await bp.connect();
                source = "backup";
                if (!isBegin && inTx) {
                  await activeClient.query("BEGIN");
                }
                const res = await (activeClient.query as any)(...args);
                if (isBegin) {
                  inTx = true;
                  txWrites = [];
                } else {
                  const captured = prepareCapturedWrite(text, params, res);
                  if (captured) {
                    if (inTx) txWrites.push(captured);
                    else scheduleFailoverWriteLog([captured]);
                  }
                }
                return res;
              }
            }
            throw err;
          }
        };
      }

      const val = (activeClient as any)[prop];
      return typeof val === "function" ? val.bind(activeClient) : val;
    },
  });

  return wrapped as PoolClient;
}

const mockPool: any = {
  query: async () => ({ rows: [], rowCount: 0, fields: [] }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0, fields: [] }),
    release: () => {},
  }),
  on: () => mockPool,
  end: async () => {},
};

function createMockDb(): any {
  const dummyFn: any = () => dummyFn;
  dummyFn.then = (resolve: any) => Promise.resolve([]).then(resolve);
  dummyFn.catch = (reject: any) => Promise.resolve([]).catch(reject);
  dummyFn.finally = (cb: any) => Promise.resolve([]).finally(cb);

  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: any) => Promise.resolve([]).then(resolve);
      if (prop === "catch") return (reject: any) => Promise.resolve([]).catch(reject);
      if (prop === "finally") return (cb: any) => Promise.resolve([]).finally(cb);
      if (prop === "transaction") {
        return async (cb: (tx: any) => any) => cb(new Proxy(dummyFn, handler));
      }
      return (..._args: any[]) => new Proxy(dummyFn, handler);
    },
    apply(_target, _thisArg, _argArray) {
      return new Proxy(dummyFn, handler);
    },
  };

  return new Proxy(dummyFn, handler);
}

function shouldRouteToFailover(): boolean {
  const until = globalForDb.__maestroFailoverUntil;
  if (!backupUrl || !until) return false;
  if (Date.now() < until) return true;
  // انتهت نافذة الـ 45 ثانية — نفحص عودة القاعدة الأساسية في الخلفية دون تعطيل الطلب الحالي
  schedulePrimaryRecoveryProbe();
  return true;
}

function createFailoverPool(primary: Pool): Pool {
  const wrapper: any = {
    async query(...args: any[]) {
      const { text, params, hasCallback } = normalizeQueryArgs(args);
      if (hasCallback) {
        return (primary.query as any)(...args);
      }

      if (shouldRouteToFailover()) {
        const bp = getOrCreateBackupPool();
        if (bp) {
          await ensureBackupReady(bp);
          try {
            const res = await (bp.query as any)(...args);
            const captured = prepareCapturedWrite(text, params, res);
            if (captured) scheduleFailoverWriteLog([captured]);
            return res;
          } catch (backupErr) {
            if (isConnectionFailureError(backupErr)) {
              triggerHaTelegramAlert("BACKUP_FAILURE", "🚨 فشل القاعدة الاحتياطية (Neon) أثناء وضع الطوارئ", [
                `الخطأ: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
              ]);
            }
            throw backupErr;
          }
        }
      }

      try {
        const res = await withTimeout<any>((primary.query as any)(...args), PRIMARY_TIMEOUT_MS, "query");
        const captured = prepareCapturedWrite(text, params, res);
        if (captured) {
          scheduleDualWriteToBackup([captured]);
        }
        return res;
      } catch (err) {
        if (isConnectionFailureError(err)) {
          const bp = activateFailoverWindow(err);
          if (bp) {
            await ensureBackupReady(bp);
            try {
              const res = await (bp.query as any)(...args);
              const captured = prepareCapturedWrite(text, params, res);
              if (captured) scheduleFailoverWriteLog([captured]);
              return res;
            } catch (backupErr) {
              if (isConnectionFailureError(backupErr)) {
                triggerHaTelegramAlert("BACKUP_FAILURE", "🚨 تعذر الاتصال بالقاعدتين (Supabase و Neon) في نفس الوقت!", [
                  `خطأ Neon: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
                ]);
              }
              throw backupErr;
            }
          }
        }
        throw err;
      }
    },

    async connect(): Promise<PoolClient> {
      if (shouldRouteToFailover()) {
        const bp = getOrCreateBackupPool();
        if (bp) {
          await ensureBackupReady(bp);
          const bc = await bp.connect();
          return wrapHaClient(bc, "backup");
        }
      }

      try {
        const client = await withTimeout(primary.connect(), PRIMARY_TIMEOUT_MS, "connect");
        return wrapHaClient(client, "primary");
      } catch (err) {
        if (isConnectionFailureError(err)) {
          const bp = activateFailoverWindow(err);
          if (bp) {
            await ensureBackupReady(bp);
            try {
              const bc = await bp.connect();
              return wrapHaClient(bc, "backup");
            } catch (backupErr) {
              if (isConnectionFailureError(backupErr)) {
                triggerHaTelegramAlert("BACKUP_FAILURE", "🚨 تعذر فتح اتصال مع القاعدتين (Supabase و Neon)!", [
                  `خطأ Neon: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
                ]);
              }
              throw backupErr;
            }
          }
        }
        throw err;
      }
    },

    on(event: string, listener: (...args: any[]) => void) {
      primary.on(event as any, listener);
      return wrapper;
    },

    async end() {
      await Promise.allSettled([
        primary.end(),
        globalForDb.__maestroBackupPool ? globalForDb.__maestroBackupPool.end() : Promise.resolve(),
      ]);
    },
  };

  return wrapper as Pool;
}

let activePool: Pool;
let activeDb: ReturnType<typeof drizzle>;

if (primaryUrl) {
  try {
    if (!globalForDb.__maestroPrimaryPool) {
      globalForDb.__maestroPrimaryPool = new Pool(buildPoolConfig(primaryUrl, false));
      globalForDb.__maestroPrimaryPool.on("error", (err) => {
        console.error("[PostgreSQL Primary/Supabase Pool Error]", err?.message);
      });
    }

    if (!globalForDb.__maestroFailoverWrapper) {
      globalForDb.__maestroFailoverWrapper = createFailoverPool(globalForDb.__maestroPrimaryPool);
    }

    activePool = globalForDb.__maestroFailoverWrapper;
    if (!globalForDb.__maestroDrizzleDb) {
      globalForDb.__maestroDrizzleDb = drizzle(activePool);
    }
    activeDb = globalForDb.__maestroDrizzleDb;
  } catch (err) {
    console.warn("[AI Studio] Database connection error — using mock:", err);
    activePool = mockPool as Pool;
    activeDb = createMockDb() as ReturnType<typeof drizzle>;
  }
} else if (backupUrl) {
  const bp = getOrCreateBackupPool()!;
  activePool = bp;
  activeDb = drizzle(bp);
} else {
  console.warn("[AI Studio] DATABASE_URL not set — using in-memory mock");
  activePool = mockPool as Pool;
  activeDb = createMockDb() as ReturnType<typeof drizzle>;
}

export function getRawPools(): {
  primaryUrl: string;
  backupUrl: string;
  primaryPool: Pool | null;
  getBackupPool: () => Pool | null;
} {
  return {
    primaryUrl,
    backupUrl,
    primaryPool: globalForDb.__maestroPrimaryPool ?? null,
    getBackupPool: getOrCreateBackupPool,
  };
}

export function getDbStatus(): {
  configured: boolean;
  hasBackup: boolean;
  mode: "primary" | "standby-failover" | "mock";
} {
  if (!primaryUrl && !backupUrl) {
    return { configured: false, hasBackup: false, mode: "mock" };
  }
  if (!primaryUrl && backupUrl) {
    return { configured: true, hasBackup: true, mode: "standby-failover" };
  }
  const inFailover = Boolean(
    backupUrl && globalForDb.__maestroFailoverUntil && Date.now() < globalForDb.__maestroFailoverUntil
  );
  return {
    configured: true,
    hasBackup: Boolean(backupUrl),
    mode: inFailover ? "standby-failover" : "primary",
  };
}

export const pool = activePool;
export const db = activeDb;
