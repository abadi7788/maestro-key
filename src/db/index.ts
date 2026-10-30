import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDrizzleDb?: ReturnType<typeof drizzle>;
};

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

let activePool: Pool;
let activeDb: ReturnType<typeof drizzle>;

if (databaseUrl) {
  try {
    if (!globalForDb.__arenaNextJsPostgresqlPool) {
      const config: PoolConfig = {
        connectionString: databaseUrl,
        // إعدادات مخصصة لبيئة Vercel Serverless وقواعد بيانات Neon السحابية
        max: 2, // خفض استهلاك اتصالات Neon لتفادي نفاد الاتصالات (Connection exhaustion)
        idleTimeoutMillis: 8000,
        connectionTimeoutMillis: 15000, // 15 ثانية كافية لإيقاظ سحابة Neon عند خمولها (Auto-suspend wake-up)
        allowExitOnIdle: true, // حاسم لـ Vercel: يسمح للـ Function بالإغلاق الفوري دون انتظار انتهاء الـ Pool
      };

      if (databaseUrl.includes("neon.tech") || databaseUrl.includes("sslmode=")) {
        config.ssl = { rejectUnauthorized: false };
      }

      globalForDb.__arenaNextJsPostgresqlPool = new Pool(config);
      globalForDb.__arenaNextJsPostgresqlPool.on("error", (err) => {
        console.error("[PostgreSQL Pool Error]", err?.message);
      });

    }

    activePool = globalForDb.__arenaNextJsPostgresqlPool;
    if (!globalForDb.__arenaNextJsDrizzleDb) {
      globalForDb.__arenaNextJsDrizzleDb = drizzle(activePool);
    }
    activeDb = globalForDb.__arenaNextJsDrizzleDb;
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

export const pool = activePool;
export const db = activeDb;


