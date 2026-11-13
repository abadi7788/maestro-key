import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

const primaryUrl = process.env.DATABASE_URL?.trim() || "";
const backupUrl = process.env.DATABASE_BACKUP_URL?.trim() || "";
const FAILOVER_WINDOW_MS = 60_000;

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
    max: isBackup ? 2 : 5,
    idleTimeoutMillis: 8000,
    connectionTimeoutMillis: isBackup ? 15000 : 8000,
    allowExitOnIdle: true,
  };

  if (!disableSsl && (!isLocalhost || rawUrl.includes("sslmode=") || rawUrl.includes("supabase") || rawUrl.includes("neon.tech"))) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

/**
 * التحقق مما إذا كان الخطأ ناتجاً عن انقطاع الاتصال بقاعدة البيانات الأساسية (Supabase)
 * وليس خطأ منطقي أو قيد بيانات (مثل UNIQUE أو FOREIGN KEY).
 */
function isConnectionFailureError(err: unknown): boolean {
  const candidates: any[] = [err, (err as any)?.cause].filter(Boolean);
  const netCodes = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "EPIPE",
  ]);
  const pgConnCodes = new Set([
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "08P01",
    "57P01",
    "57P02",
    "57P03",
    "53300",
  ]);

  for (const c of candidates) {
    const code = String(c?.code || "");
    if (netCodes.has(code) || pgConnCodes.has(code) || code.startsWith("08")) {
      return true;
    }
    const msg = String(c?.message || "").toLowerCase();
    if (
      msg.includes("connection terminated") ||
      msg.includes("timeout exceeded") ||
      msg.includes("connection timeout") ||
      msg.includes("could not connect") ||
      msg.includes("server closed the connection unexpectedly") ||
      msg.includes("tenant or user not found") ||
      msg.includes("dbhandler exited") ||
      msg.includes("circuit breaker open") ||
      msg.includes("getaddrinfo") ||
      msg.includes("ssl handshake") ||
      msg.includes("remaining connection slots")
    ) {
      return true;
    }
  }
  return false;
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

function createFailoverPool(primary: Pool): Pool {
  const wrapper: any = {
    async query(...args: any[]) {
      const inFailover = Boolean(
        backupUrl && globalForDb.__maestroFailoverUntil && Date.now() < globalForDb.__maestroFailoverUntil
      );

      if (inFailover) {
        const bp = getOrCreateBackupPool();
        if (bp) return (bp.query as any)(...args);
      }

      try {
        const res = await (primary.query as any)(...args);
        if (globalForDb.__maestroFailoverUntil) {
          globalForDb.__maestroFailoverUntil = 0;
          console.info("[DB Failover] Primary (Supabase) recovered — returning to primary database.");
        }
        return res;
      } catch (err) {
        if (backupUrl && isConnectionFailureError(err)) {
          console.error(
            "[DB Failover] Primary (Supabase) connection failed — switching temporarily to Neon standby backup:",
            (err as any)?.message || err
          );
          globalForDb.__maestroFailoverUntil = Date.now() + FAILOVER_WINDOW_MS;
          const bp = getOrCreateBackupPool();
          if (bp) return (bp.query as any)(...args);
        }
        throw err;
      }
    },

    async connect() {
      const inFailover = Boolean(
        backupUrl && globalForDb.__maestroFailoverUntil && Date.now() < globalForDb.__maestroFailoverUntil
      );

      if (inFailover) {
        const bp = getOrCreateBackupPool();
        if (bp) return bp.connect();
      }

      try {
        const client = await primary.connect();
        if (globalForDb.__maestroFailoverUntil) {
          globalForDb.__maestroFailoverUntil = 0;
          console.info("[DB Failover] Primary (Supabase) recovered — returning to primary database.");
        }
        return client;
      } catch (err) {
        if (backupUrl && isConnectionFailureError(err)) {
          console.error(
            "[DB Failover] Primary (Supabase) connect failed — switching temporarily to Neon standby backup:",
            (err as any)?.message || err
          );
          globalForDb.__maestroFailoverUntil = Date.now() + FAILOVER_WINDOW_MS;
          const bp = getOrCreateBackupPool();
          if (bp) return bp.connect();
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
} else {
  console.warn("[AI Studio] DATABASE_URL not set — using in-memory mock");
  activePool = mockPool as Pool;
  activeDb = createMockDb() as ReturnType<typeof drizzle>;
}

export function getDbStatus(): {
  configured: boolean;
  hasBackup: boolean;
  mode: "primary" | "standby-failover" | "mock";
} {
  if (!primaryUrl) {
    return { configured: false, hasBackup: Boolean(backupUrl), mode: "mock" };
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
