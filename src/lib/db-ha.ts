import { after } from "next/server";
import type { Pool, PoolClient, QueryResult } from "pg";

export const PRIMARY_TIMEOUT_MS = 3000;
export const FAILOVER_WINDOW_MS = 45_000;

export type CapturedWrite = {
  sql: string;
  params: any[];
  tableName: string | null;
  insertedId: number | null;
  kind: "INSERT" | "UPDATE" | "DELETE";
};

export type DbEndpointHealth = {
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  error?: string;
};

export type BothDatabasesHealth = {
  mode: "primary" | "standby-failover" | "mock";
  primary: DbEndpointHealth;
  backup: DbEndpointHealth & { pendingFailoverWrites: number; pendingDualWrites: number };
  checkedAt: string;
};

const globalForHa = globalThis as typeof globalThis & {
  __maestroFailoverUntil?: number;
  __maestroPendingToBackup?: CapturedWrite[][];
  __maestroBackupNeedsFullSync?: boolean;
  __maestroRecoveryProbeRunning?: boolean;
  __maestroReconcilingPromise?: Promise<number> | null;
  __maestroFullSyncPromise?: Promise<{ counts: Record<string, number>; durationMs: number }> | null;
};

/* ---------------- Error & Timeout Utilities ---------------- */

export function isConnectionFailureError(err: unknown): boolean {
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
    "HA_PRIMARY_TIMEOUT",
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
      msg.includes("query read timeout") ||
      msg.includes("primary db timeout") ||
      msg.includes("could not connect") ||
      msg.includes("server closed the connection unexpectedly") ||
      msg.includes("tenant or user not found") ||
      msg.includes("dbhandler exited") ||
      msg.includes("circuit breaker open") ||
      msg.includes("getaddrinfo") ||
      msg.includes("ssl handshake") ||
      msg.includes("remaining connection slots") ||
      msg.includes("maxclientsinsessionmode") ||
      msg.includes("enotfound") ||
      msg.includes("econnrefused")
    ) {
      return true;
    }
  }
  return false;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Prevent unhandled rejection if caller races ahead on timeout
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`Primary DB timeout after ${ms}ms (${label})`);
      err.code = "HA_PRIMARY_TIMEOUT";
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        if (timer) clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (timer) clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function scheduleBackgroundTask(fn: () => Promise<void>): void {
  const safeRun = async () => {
    try {
      await fn();
    } catch (e) {
      console.warn("[db-ha] background task warning:", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(safeRun);
  } catch {
    void safeRun();
  }
}

export function triggerHaTelegramAlert(
  eventKey: "PRIMARY_FAILOVER" | "PRIMARY_DOWN_NO_BACKUP" | "PRIMARY_RECOVERED" | "BACKUP_FAILURE" | "SYNC_ERROR",
  title: string,
  lines: string[] = []
): void {
  scheduleBackgroundTask(async () => {
    const { sendHaEmergencyTelegramAlert } = await import("./telegram");
    await sendHaEmergencyTelegramAlert(eventKey, title, lines);
  });
}

/* ---------------- SQL Normalization & Write Capture ---------------- */

export function normalizeQueryArgs(args: any[]): { text: string; params: any[]; hasCallback: boolean } {
  const first = args[0];
  const hasCallback = typeof args[args.length - 1] === "function";
  if (typeof first === "string") {
    const params = Array.isArray(args[1]) ? args[1] : [];
    return { text: first, params, hasCallback };
  }
  if (first && typeof first === "object" && typeof first.text === "string") {
    const params = Array.isArray(first.values) ? first.values : [];
    return { text: first.text, params, hasCallback };
  }
  return { text: "", params: [], hasCallback };
}

function stripLeadingComments(sql: string): string {
  return sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/g, "").trim();
}

export function getWriteKind(sqlText: string): "INSERT" | "UPDATE" | "DELETE" | null {
  const cleaned = stripLeadingComments(sqlText);
  if (!cleaned) return null;
  const upperHead = cleaned.slice(0, 16).toUpperCase();
  if (
    cleaned.includes("_schema_meta") ||
    cleaned.includes("_ha_sync_queue") ||
    cleaned.includes("pg_get_serial_sequence")
  ) {
    return null;
  }
  if (upperHead.startsWith("INSERT ")) return "INSERT";
  if (upperHead.startsWith("UPDATE ")) return "UPDATE";
  if (upperHead.startsWith("DELETE ")) return "DELETE";
  return null;
}

export function prepareCapturedWrite(
  sqlText: string,
  params: any[],
  res?: QueryResult<any>
): CapturedWrite | null {
  const kind = getWriteKind(sqlText);
  if (!kind) return null;

  const normalizedParams = Array.isArray(params) ? [...params] : [];
  let replicatedSql = sqlText.trim();
  let tableName: string | null = null;
  let insertedId: number | null = null;

  if (kind === "INSERT") {
    const m = replicatedSql.match(
      /^insert\s+into\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?\s*\(([^)]+)\)\s*values\s*\(([\s\S]*)$/i
    );
    if (m) {
      tableName = m[1];
      const colsPart = m[2];
      const restAfterValues = m[3];

      // Single-row VALUES detection: check returned id from RETURNING
      const rows = res?.rows;
      if (Array.isArray(rows) && rows.length === 1 && typeof rows[0]?.id === "number") {
        insertedId = rows[0].id;
        const colNames = colsPart.split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
        const hasMultipleTuples = /\)\s*,\s*\(/.test(restAfterValues.split(/\b(?:on\s+conflict|returning)\b/i)[0] || "");

        if (!hasMultipleTuples && !colNames.includes("id")) {
          const nextParamIdx = normalizedParams.length + 1;
          normalizedParams.push(insertedId);
          replicatedSql = replicatedSql.replace(
            /^(insert\s+into\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?[a-zA-Z0-9_]+"?\s*\()([^)]+)(\)\s*values\s*\()/i,
            `$1"id", $2$3$${nextParamIdx}, `
          );
        } else if (!hasMultipleTuples && colNames[0] === "id" && /^\s*default\s*,/i.test(restAfterValues)) {
          const nextParamIdx = normalizedParams.length + 1;
          normalizedParams.push(insertedId);
          replicatedSql = replicatedSql.replace(
            /^((?:insert\s+into\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?[a-zA-Z0-9_]+"?\s*\([^)]+\)\s*values\s*\()\s*)default(\s*,)/i,
            `$1$${nextParamIdx}$2`
          );
        }
      }

      // Make non-upsert inserts idempotent on conflict when replicating
      if (!/\bon\s+conflict\b/i.test(replicatedSql)) {
        if (/\breturning\b/i.test(replicatedSql)) {
          replicatedSql = replicatedSql.replace(/\breturning\b/i, "ON CONFLICT DO NOTHING RETURNING");
        } else {
          replicatedSql = `${replicatedSql} ON CONFLICT DO NOTHING`;
        }
      }
    }
  } else if (kind === "UPDATE") {
    const m = replicatedSql.match(/^update\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/i);
    if (m) tableName = m[1];
  } else if (kind === "DELETE") {
    const m = replicatedSql.match(/^delete\s+from\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/i);
    if (m) tableName = m[1];
  }

  return {
    sql: replicatedSql,
    params: normalizedParams,
    tableName,
    insertedId,
    kind,
  };
}

/* ---------------- Dual-Write Replication (Primary -> Backup) ---------------- */

async function executeWritesOnPool(targetPool: Pool, batch: CapturedWrite[]): Promise<void> {
  if (!batch.length) return;
  const client = await targetPool.connect();
  const tablesToSyncSeq = new Set<string>();
  try {
    await client.query("BEGIN");
    for (const w of batch) {
      await client.query(w.sql, w.params);
      if (w.kind === "INSERT" && w.tableName && w.insertedId !== null) {
        tablesToSyncSeq.add(w.tableName);
      }
    }
    for (const tbl of tablesToSyncSeq) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${tbl}"), 1), 1), true)`
      ).catch(() => {});
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function scheduleDualWriteToBackup(writes: CapturedWrite[]): void {
  if (!writes.length) return;
  scheduleBackgroundTask(async () => {
    const { getRawPools } = await import("@/db");
    const { backupUrl, getBackupPool } = getRawPools();
    if (!backupUrl) return;

    const backupPool = getBackupPool();
    if (!backupPool) return;

    try {
      const { ensureSchemaOnPool } = await import("./schema-check");
      await ensureSchemaOnPool(backupPool, { label: "Neon Backup" });

      if (!globalForHa.__maestroPendingToBackup) {
        globalForHa.__maestroPendingToBackup = [];
      }

      // Replay previously queued failed batches first
      while (globalForHa.__maestroPendingToBackup.length > 0) {
        const pendingBatch = globalForHa.__maestroPendingToBackup[0];
        await executeWritesOnPool(backupPool, pendingBatch);
        globalForHa.__maestroPendingToBackup.shift();
      }

      await executeWritesOnPool(backupPool, writes);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[db-ha] Dual-Write to Neon backup failed:", msg);

      // Buffer failed batch (max 200) so transient network glitches self-heal
      if (!globalForHa.__maestroPendingToBackup) {
        globalForHa.__maestroPendingToBackup = [];
      }
      if (globalForHa.__maestroPendingToBackup.length < 200) {
        globalForHa.__maestroPendingToBackup.push(writes);
      } else {
        globalForHa.__maestroBackupNeedsFullSync = true;
      }

      // Foreign key violation (e.g. backup missed older parent record) -> auto heal via full sync
      if (String(err?.code || "") === "23503" && !globalForHa.__maestroFullSyncPromise) {
        globalForHa.__maestroBackupNeedsFullSync = true;
        void syncPrimaryToBackupFull({ silentAlert: true }).catch(() => {});
      }

      triggerHaTelegramAlert("BACKUP_FAILURE", "⚠️ فشل مزامنة عملية مع القاعدة الاحتياطية (Neon)", [
        `العملية: ${writes.map((w) => `${w.kind} ${w.tableName || ""}`).join("، ")}`,
        `السبب: ${msg}`,
        `سيتم الاحتفاظ بالتحديثات وإعادة المحاولة تلقائياً.`,
      ]);
    }
  });
}

/* ---------------- Failover Queue (Backup -> Primary Recovery) ---------------- */

export function scheduleFailoverWriteLog(writes: CapturedWrite[]): void {
  if (!writes.length) return;
  scheduleBackgroundTask(async () => {
    const { getRawPools } = await import("@/db");
    const backupPool = getRawPools().getBackupPool();
    if (!backupPool) return;
    try {
      const { ensureSchemaOnPool } = await import("./schema-check");
      await ensureSchemaOnPool(backupPool, { label: "Neon Backup" });
      for (const w of writes) {
        await backupPool.query(
          `INSERT INTO _ha_sync_queue (sql_text, params_json, table_name, inserted_id) VALUES ($1, $2, $3, $4)`,
          [w.sql, JSON.stringify(w.params ?? []), w.tableName, w.insertedId]
        );
      }
    } catch (e) {
      console.warn("[db-ha] Failed to record failover write log:", e instanceof Error ? e.message : e);
    }
  });
}

export async function reconcileFailoverWritesToPrimary(): Promise<number> {
  if (globalForHa.__maestroReconcilingPromise) {
    return globalForHa.__maestroReconcilingPromise;
  }

  globalForHa.__maestroReconcilingPromise = (async () => {
    const { getRawPools } = await import("@/db");
    const { primaryPool, getBackupPool } = getRawPools();
    const backupPool = getBackupPool();
    if (!primaryPool || !backupPool) return 0;

    const { ensureSchemaOnPool, syncSequencesOnQueryable } = await import("./schema-check");
    await ensureSchemaOnPool(primaryPool, { label: "Supabase Primary" });

    // Ensure queue table exists on backup before reading
    await backupPool
      .query(
        `CREATE TABLE IF NOT EXISTS _ha_sync_queue (
          id SERIAL PRIMARY KEY,
          sql_text TEXT NOT NULL,
          params_json TEXT NOT NULL DEFAULT '[]',
          table_name VARCHAR(80),
          inserted_id INTEGER,
          synced BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      )
      .catch(() => {});

    const pendingRes = await backupPool.query(
      `SELECT id, sql_text, params_json, table_name, inserted_id FROM _ha_sync_queue WHERE synced = FALSE ORDER BY id ASC LIMIT 2000`
    );
    const rows = pendingRes.rows || [];
    if (rows.length === 0) return 0;

    const syncedIds: number[] = [];
    const primaryClient = await primaryPool.connect();
    try {
      await primaryClient.query("BEGIN");
      for (const row of rows) {
        let params: any[] = [];
        try {
          params = JSON.parse(row.params_json || "[]");
        } catch {
          params = [];
        }
        await primaryClient.query(row.sql_text, params);
        syncedIds.push(Number(row.id));
      }
      await syncSequencesOnQueryable(primaryClient);
      await primaryClient.query("COMMIT");
    } catch (err) {
      await primaryClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      primaryClient.release();
    }

    if (syncedIds.length > 0) {
      await backupPool.query(
        `UPDATE _ha_sync_queue SET synced = TRUE WHERE id = ANY($1::int[])`,
        [syncedIds]
      );
    }

    return syncedIds.length;
  })()
    .catch((err) => {
      const msg = err?.message || String(err);
      console.error("[db-ha] Failover recovery sync error:", msg);
      triggerHaTelegramAlert("SYNC_ERROR", "⚠️ تعذر مزامنة بعض عمليات الطوارئ عند عودة Supabase", [
        `السبب: ${msg}`,
        `يمكنك استخدام زر "مزامنة القاعدة الاحتياطية الآن" أو مراجعة السجل.`,
      ]);
      return 0;
    })
    .finally(() => {
      globalForHa.__maestroReconcilingPromise = null;
    });

  return globalForHa.__maestroReconcilingPromise;
}

export function schedulePrimaryRecoveryProbe(): void {
  if (globalForHa.__maestroRecoveryProbeRunning) return;
  globalForHa.__maestroRecoveryProbeRunning = true;

  scheduleBackgroundTask(async () => {
    try {
      const { getRawPools } = await import("@/db");
      const { primaryPool } = getRawPools();
      if (!primaryPool) return;

      await withTimeout(primaryPool.query("SELECT 1"), PRIMARY_TIMEOUT_MS, "Primary Recovery Probe");
      const syncedCount = await reconcileFailoverWritesToPrimary();
      globalForHa.__maestroFailoverUntil = 0;

      console.info(`[db-ha] Supabase recovered! Synced ${syncedCount} failover write(s) back to Primary.`);
      triggerHaTelegramAlert("PRIMARY_RECOVERED", "✅ عادت قاعدة البيانات الأساسية (Supabase) للعمل", [
        `تم إنهاء وضع الطوارئ والعودة إلى التشغيل الطبيعي عبر Supabase.`,
        syncedCount > 0
          ? `🔄 تمت مزامنة ${syncedCount} عملية جديدة مسجلة أثناء الطوارئ من Neon إلى Supabase بنجاح.`
          : `✨ لم تكن هناك عمليات معلقة تحتاج للمزامنة.`,
      ]);
    } catch {
      // Primary still offline — stay on Neon for another window
      globalForHa.__maestroFailoverUntil = Date.now() + FAILOVER_WINDOW_MS;
    } finally {
      globalForHa.__maestroRecoveryProbeRunning = false;
    }
  });
}

/* ---------------- Health Probe (On-Demand in Settings / Deep Health) ---------------- */

export async function probeBothDatabases(): Promise<BothDatabasesHealth> {
  const { getRawPools, getDbStatus } = await import("@/db");
  const { primaryUrl, backupUrl, primaryPool, getBackupPool } = getRawPools();
  const status = getDbStatus();

  const checkOne = async (
    configured: boolean,
    targetPool: Pool | null,
    label: string
  ): Promise<DbEndpointHealth> => {
    if (!configured || !targetPool) {
      return { configured: false, connected: false, latencyMs: null, error: "غير مضاف في متغيرات البيئة" };
    }
    const start = Date.now();
    try {
      await withTimeout(targetPool.query("SELECT 1"), 3500, `${label} Health Check`);
      return { configured: true, connected: true, latencyMs: Date.now() - start };
    } catch (e: any) {
      return {
        configured: true,
        connected: false,
        latencyMs: Date.now() - start,
        error: e?.message || "تعذر الاتصال",
      };
    }
  };

  const backupPool = getBackupPool();
  const [primaryHealth, backupHealth] = await Promise.all([
    checkOne(Boolean(primaryUrl), primaryPool, "Supabase Primary"),
    checkOne(Boolean(backupUrl), backupPool, "Neon Backup"),
  ]);

  let pendingFailoverWrites = 0;
  if (backupHealth.connected && backupPool) {
    try {
      const qRes = await backupPool.query(
        `SELECT COUNT(*)::int AS c FROM _ha_sync_queue WHERE synced = FALSE`
      );
      pendingFailoverWrites = Number(qRes.rows?.[0]?.c || 0);
    } catch {
      // Queue table may not exist yet on fresh Neon DB
      pendingFailoverWrites = 0;
    }
  }

  const pendingDualWrites = globalForHa.__maestroPendingToBackup?.length ?? 0;

  if (primaryHealth.configured && !primaryHealth.connected) {
    triggerHaTelegramAlert("PRIMARY_FAILOVER", "🚨 تنبيه: تعذر الاتصال بقاعدة البيانات الأساسية (Supabase)", [
      `الخطأ: ${primaryHealth.error || "Timeout"}`,
      backupHealth.connected
        ? `القاعدة الاحتياطية (Neon) متصلة وجاهزة للتحويل التلقائي.`
        : `⚠️ تنبيه: القاعدة الاحتياطية (Neon) غير متصلة أيضاً!`,
    ]);
  }
  if (backupHealth.configured && !backupHealth.connected) {
    triggerHaTelegramAlert("BACKUP_FAILURE", "⚠️ تنبيه: القاعدة الاحتياطية (Neon) غير متصلة", [
      `الخطأ: ${backupHealth.error || "Connection error"}`,
      `يرجى مراجعة متغير FALLBACK_DATABASE_URL وحصة Neon.`,
    ]);
  }

  return {
    mode: status.mode,
    primary: primaryHealth,
    backup: {
      ...backupHealth,
      pendingFailoverWrites,
      pendingDualWrites,
    },
    checkedAt: new Date().toISOString(),
  };
}

/* ---------------- Full One-Click Sync (Supabase -> Neon) ---------------- */

type SyncTableSpec = {
  table: string;
  columns: string[];
  hasId: boolean;
};

const FULL_SYNC_TABLES: SyncTableSpec[] = [
  { table: "settings", columns: ["id", "key", "value", "updated_at"], hasId: true },
  { table: "payment_methods", columns: ["id", "name", "is_active", "created_at"], hasId: true },
  {
    table: "platforms",
    columns: [
      "id",
      "name",
      "color",
      "short_name",
      "image_url",
      "delivery_mode",
      "requires_customer_email",
      "extra_field_label",
      "is_lifetime",
      "is_active",
      "low_stock_threshold",
      "created_at",
    ],
    hasId: true,
  },
  {
    table: "users",
    columns: [
      "id",
      "username",
      "password_hash",
      "display_name",
      "role",
      "wallet_balance",
      "is_active",
      "failed_attempts",
      "locked_until",
      "last_login_at",
      "email",
      "permissions",
      "created_at",
    ],
    hasId: true,
  },
  { table: "customers", columns: ["id", "name", "phone", "notes", "created_at"], hasId: true },
  {
    table: "accounts",
    columns: [
      "id",
      "platform_id",
      "type",
      "max_profiles",
      "delivery_kind",
      "email",
      "password_encrypted",
      "invite_link",
      "license_key_encrypted",
      "max_uses",
      "used_count",
      "pin",
      "expiry_date",
      "status",
      "notes",
      "sale_price",
      "is_deleted",
      "deleted_at",
      "deleted_reason",
      "created_at",
      "updated_at",
    ],
    hasId: true,
  },
  {
    table: "profiles",
    columns: [
      "id",
      "account_id",
      "profile_no",
      "profile_name",
      "pin",
      "is_occupied",
      "current_rental_id",
      "status",
      "sold_at",
      "sold_by",
      "created_at",
    ],
    hasId: true,
  },
  {
    table: "rentals",
    columns: [
      "id",
      "account_id",
      "profile_id",
      "customer_id",
      "platform_id",
      "created_by",
      "rental_type",
      "start_date",
      "end_date",
      "duration_days",
      "is_lifetime",
      "status",
      "password_used_encrypted",
      "whatsapp_alert_sent",
      "whatsapp_alert_sent_at",
      "customer_email",
      "customer_extra",
      "activation_status",
      "activated_email",
      "activated_password",
      "activated_link",
      "activated_pin",
      "activated_note",
      "activated_at",
      "activated_by",
      "delivery_source",
      "manual_email",
      "manual_password_encrypted",
      "manual_link",
      "manual_code_encrypted",
      "manual_note",
      "refunded_at",
      "refund_reason",
      "created_at",
      "updated_at",
    ],
    hasId: true,
  },
  {
    table: "payments",
    columns: [
      "id",
      "rental_id",
      "payment_method_id",
      "transaction_ref",
      "amount",
      "receipt_image_data",
      "receipt_hash",
      "status",
      "reviewed_by",
      "reviewed_at",
      "rejection_reason",
      "is_extension",
      "duration_days",
      "previous_end_date",
      "previous_rental_status",
      "created_by",
      "created_at",
    ],
    hasId: true,
  },
  { table: "wallet_balances", columns: ["user_id", "balance", "updated_at"], hasId: false },
  {
    table: "wallet_transactions",
    columns: ["id", "user_id", "type", "amount", "balance_before", "balance_after", "rental_id", "note", "created_by", "created_at"],
    hasId: true,
  },
  {
    table: "whatsapp_logs",
    columns: ["id", "rental_id", "customer_id", "phone", "message", "kind", "status", "created_at"],
    hasId: true,
  },
  { table: "alerts", columns: ["id", "title", "body", "kind", "href", "for_user_id", "created_at"], hasId: true },
  { table: "email_codes", columns: ["id", "email", "code_hash", "expires_at", "used", "created_at"], hasId: true },
  {
    table: "audit_logs",
    columns: ["id", "user_id", "username", "action", "entity_type", "entity_id", "details", "created_at"],
    hasId: true,
  },
  { table: "push_subscriptions", columns: ["id", "user_id", "endpoint", "p256dh", "auth", "created_at"], hasId: true },
];

async function batchInsertRows(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, any>[]
): Promise<void> {
  if (!rows.length) return;
  const maxRowsPerBatch = Math.max(1, Math.floor(4500 / columns.length));
  const quotedCols = columns.map((c) => `"${c}"`).join(", ");

  for (let offset = 0; offset < rows.length; offset += maxRowsPerBatch) {
    const slice = rows.slice(offset, offset + maxRowsPerBatch);
    const values: any[] = [];
    const tuples: string[] = [];

    for (const r of slice) {
      const placeholders: string[] = [];
      for (const col of columns) {
        values.push(r[col] ?? null);
        placeholders.push(`$${values.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }

    await client.query(
      `INSERT INTO "${table}" (${quotedCols}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
      values
    );
  }
}

export async function syncPrimaryToBackupFull(opts?: {
  silentAlert?: boolean;
}): Promise<{ counts: Record<string, number>; durationMs: number }> {
  if (globalForHa.__maestroFullSyncPromise) {
    return globalForHa.__maestroFullSyncPromise;
  }

  globalForHa.__maestroFullSyncPromise = (async () => {
    const started = Date.now();
    const { getRawPools } = await import("@/db");
    const { primaryPool, getBackupPool, backupUrl, primaryUrl } = getRawPools();

    if (!primaryUrl || !primaryPool) {
      throw new Error("قاعدة البيانات الأساسية (DATABASE_URL) غير مضبوطة.");
    }
    const backupPool = getBackupPool();
    if (!backupUrl || !backupPool) {
      throw new Error("القاعدة الاحتياطية (FALLBACK_DATABASE_URL) غير مضبوطة.");
    }

    // 1. Check both reachable
    await withTimeout(primaryPool.query("SELECT 1"), 4000, "Supabase Primary");
    await withTimeout(backupPool.query("SELECT 1"), 6000, "Neon Backup");

    // 2. Reconcile any pending failover writes from Neon -> Supabase before mirroring Supabase -> Neon
    await reconcileFailoverWritesToPrimary().catch(() => {});

    // 3. Ensure schema is 100% synced on both sides
    const { ensureSchemaOnPool, syncSequencesOnQueryable } = await import("./schema-check");
    await Promise.all([
      ensureSchemaOnPool(primaryPool, { label: "Supabase Primary" }),
      ensureSchemaOnPool(backupPool, { force: true, label: "Neon Backup" }),
    ]);

    // 4. Snapshot all 16 tables concurrently from Primary (Supabase)
    const snapshots = await Promise.all(
      FULL_SYNC_TABLES.map(async (spec) => {
        const orderBy = spec.hasId ? `ORDER BY id ASC` : "";
        const res = await primaryPool.query(
          `SELECT ${spec.columns.map((c) => `"${c}"`).join(", ")} FROM "${spec.table}" ${orderBy}`
        );
        return { spec, rows: res.rows || [] };
      })
    );

    // 5. Atomic mirror into Neon inside BEGIN ... COMMIT
    const backupClient = await backupPool.connect();
    const counts: Record<string, number> = {};
    try {
      await backupClient.query("BEGIN");
      const truncateOrder = [...FULL_SYNC_TABLES].reverse().map((s) => `"${s.table}"`).join(", ");
      await backupClient.query(`TRUNCATE TABLE ${truncateOrder} RESTART IDENTITY CASCADE`);

      for (const { spec, rows } of snapshots) {
        await batchInsertRows(backupClient, spec.table, spec.columns, rows);
        counts[spec.table] = rows.length;
      }

      await syncSequencesOnQueryable(backupClient);
      await backupClient.query(`UPDATE _ha_sync_queue SET synced = TRUE WHERE synced = FALSE`).catch(() => {});
      await backupClient.query("COMMIT");
    } catch (err) {
      await backupClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      backupClient.release();
    }

    globalForHa.__maestroPendingToBackup = [];
    globalForHa.__maestroBackupNeedsFullSync = false;

    const durationMs = Date.now() - started;
    console.info(`[db-ha] Full sync Supabase -> Neon completed in ${durationMs}ms.`);
    return { counts, durationMs };
  })()
    .catch((err) => {
      const msg = err?.message || String(err);
      if (!opts?.silentAlert) {
        triggerHaTelegramAlert("BACKUP_FAILURE", "⚠️ فشلت المزامنة الكاملة مع القاعدة الاحتياطية (Neon)", [
          `السبب: ${msg}`,
        ]);
      }
      throw err;
    })
    .finally(() => {
      globalForHa.__maestroFullSyncPromise = null;
    });

  return globalForHa.__maestroFullSyncPromise;
}
