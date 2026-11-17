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
  __maestroHaQueueCleaned?: WeakSet<object>;
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

function isPermanentWriteReplayError(err: unknown): boolean {
  const code = String((err as any)?.code || "");
  const msg = String((err as any)?.message || "").toLowerCase();
  if (code === "42P02" || code === "08P01" || code === "42601" || code === "42703") {
    return true;
  }
  return (
    msg.includes("there is no parameter $") ||
    msg.includes("bind message supplies") ||
    msg.includes("syntax error at or near")
  );
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
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

/* ---------------- SQL Normalization, Param Validation & Write Capture ---------------- */

/**
 * تطبيع معاملات الاستعلام القادمة من pg أو Drizzle ORM:
 * ملاحظة مهمة: Drizzle ORM يمرر (queryConfigObject, paramsArray)
 * حيث يكون args[0] كائناً لا يحتوي على values، بينما المصفوفة تكون في args[1].
 */
export function normalizeQueryArgs(args: any[]): { text: string; params: any[]; hasCallback: boolean } {
  const first = args[0];
  const hasCallback = typeof args[args.length - 1] === "function";
  if (typeof first === "string") {
    const params = Array.isArray(args[1]) ? args[1] : [];
    return { text: first, params, hasCallback };
  }
  if (first && typeof first === "object" && typeof first.text === "string") {
    const params = Array.isArray(first.values)
      ? first.values
      : Array.isArray(args[1])
      ? args[1]
      : [];
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

/**
 * استخراج أعلى رقم متغير ($1, $2, ...) خارج النصوص المقتبسة '...'
 */
export function getMaxSqlParamIndex(sqlText: string): number {
  let maxIdx = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && sqlText[i + 1] === "'") {
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && ch === "$") {
      let j = i + 1;
      while (j < sqlText.length && sqlText[j] >= "0" && sqlText[j] <= "9") j++;
      if (j > i + 1) {
        const idx = Number(sqlText.slice(i + 1, j));
        if (Number.isInteger(idx) && idx > maxIdx) maxIdx = idx;
        i = j - 1;
      }
    }
  }
  return maxIdx;
}

export function hasValidSqlParams(sqlText: string, params: unknown): boolean {
  if (!sqlText || typeof sqlText !== "string") return false;
  if (!Array.isArray(params)) return false;
  const maxParam = getMaxSqlParamIndex(sqlText);
  return params.length >= maxParam;
}

function extractInsertedIdFromResult(res?: QueryResult<any>): number | null {
  const rows = res?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row0: any = rows[0];

  if (row0 && typeof row0 === "object" && !Array.isArray(row0) && row0.id != null) {
    const n = Number(row0.id);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  // Drizzle ORM يستخدم rowMode: "array" فتعود rows[0] كمصفوفة قيم
  if (Array.isArray(row0) && Array.isArray(res?.fields)) {
    const idIdx = res.fields.findIndex((f: any) => String(f?.name || "").toLowerCase() === "id");
    if (idIdx >= 0 && row0[idIdx] != null) {
      const n = Number(row0[idIdx]);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/**
 * تقسيم VALUES (...) الأولى بأمان مع مراعاة الأقواس المتداخلة وعلامات الاقتباس
 */
function parseFirstValuesTuple(restAfterValuesOpenParen: string): {
  expressions: string[];
  afterTuple: string;
} | null {
  const expressions: string[] = [];
  let current = "";
  let depth = 1;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < restAfterValuesOpenParen.length; i++) {
    const ch = restAfterValuesOpenParen[i];

    if (ch === "'" && !inDouble) {
      current += ch;
      if (inSingle && restAfterValuesOpenParen[i + 1] === "'") {
        current += "'";
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "(") {
        depth++;
        current += ch;
        continue;
      }
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          expressions.push(current.trim());
          return {
            expressions,
            afterTuple: restAfterValuesOpenParen.slice(i + 1),
          };
        }
        current += ch;
        continue;
      }
      if (ch === "," && depth === 1) {
        expressions.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  return null;
}

function appendOnConflictDoNothing(sqlText: string): string {
  if (/\bon\s+conflict\b/i.test(sqlText)) return sqlText;
  const returningMatch = sqlText.match(/\breturning\b/i);
  if (returningMatch && typeof returningMatch.index === "number") {
    const idx = returningMatch.index;
    return `${sqlText.slice(0, idx).trimEnd()} ON CONFLICT DO NOTHING ${sqlText.slice(idx)}`;
  }
  return `${sqlText} ON CONFLICT DO NOTHING`;
}

export function prepareCapturedWrite(
  sqlText: string,
  params: any[],
  res?: QueryResult<any>
): CapturedWrite | null {
  const kind = getWriteKind(sqlText);
  if (!kind) return null;

  const normalizedParams = Array.isArray(params)
    ? params.map((p) => (p === undefined ? null : p))
    : [];
  let replicatedSql = sqlText.trim();
  let tableName: string | null = null;
  const insertedId = extractInsertedIdFromResult(res);

  if (kind === "INSERT") {
    const m = replicatedSql.match(
      /^(insert\s+into\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?\s*\()([^)]+)(\)\s*values\s*\()([\s\S]*)$/i
    );
    if (m) {
      const insertHead = m[1];
      tableName = m[2];
      const colsPart = m[3];
      const midPart = m[4];
      const restAfterOpen = m[5];

      const parsedTuple = parseFirstValuesTuple(restAfterOpen);
      const colNames = colsPart.split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());

      if (parsedTuple) {
        const hasMultipleTuples = /^\s*,/.test(parsedTuple.afterTuple);
        const maxBefore = getMaxSqlParamIndex(replicatedSql);

        if (
          !hasMultipleTuples &&
          insertedId !== null &&
          normalizedParams.length >= maxBefore &&
          colNames.length === parsedTuple.expressions.length
        ) {
          const idIdx = colNames.indexOf("id");
          if (idIdx >= 0 && /^default$/i.test(parsedTuple.expressions[idIdx])) {
            const nextParamIdx = normalizedParams.length + 1;
            normalizedParams.push(insertedId);
            parsedTuple.expressions[idIdx] = `$${nextParamIdx}`;
            replicatedSql = `${insertHead}${colsPart}${midPart}${parsedTuple.expressions.join(", ")})${parsedTuple.afterTuple}`;
          } else if (idIdx === -1) {
            const nextParamIdx = normalizedParams.length + 1;
            normalizedParams.push(insertedId);
            replicatedSql = `${insertHead}"id", ${colsPart}${midPart}$${nextParamIdx}, ${parsedTuple.expressions.join(", ")})${parsedTuple.afterTuple}`;
          }
        }
      }

      replicatedSql = appendOnConflictDoNothing(replicatedSql);
    }
  } else if (kind === "UPDATE") {
    const m = replicatedSql.match(/^update\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/i);
    if (m) tableName = m[1];
  } else if (kind === "DELETE") {
    const m = replicatedSql.match(/^delete\s+from\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/i);
    if (m) tableName = m[1];
  }

  // ضمان مطابقة مصفوفة المعاملات لأرقام $1, $2, ... قبل وضع العملية في طابور المزامنة
  if (!hasValidSqlParams(replicatedSql, normalizedParams)) {
    console.warn(
      `[db-ha] Skipping write capture due to parameter count mismatch (table=${tableName}, params=${normalizedParams.length}, needed=${getMaxSqlParamIndex(replicatedSql)})`
    );
    return null;
  }

  return {
    sql: replicatedSql,
    params: normalizedParams,
    tableName,
    insertedId,
    kind,
  };
}

/* ---------------- Retry Queue Cleanup ---------------- */

function sanitizePendingBackupQueue(): void {
  if (!globalForHa.__maestroPendingToBackup?.length) return;
  globalForHa.__maestroPendingToBackup = globalForHa.__maestroPendingToBackup
    .map((batch) => batch.filter((w) => hasValidSqlParams(w.sql, w.params)))
    .filter((batch) => batch.length > 0);
}

export async function cleanupBrokenHaSyncQueue(backupPool: Pool, force = false): Promise<number> {
  if (!globalForHa.__maestroHaQueueCleaned) {
    globalForHa.__maestroHaQueueCleaned = new WeakSet<object>();
  }
  if (!force && globalForHa.__maestroHaQueueCleaned.has(backupPool)) {
    return 0;
  }

  try {
    const existsRes = await backupPool
      .query(`SELECT to_regclass('public._ha_sync_queue') AS tbl`)
      .catch(() => null);
    if (!existsRes?.rows?.[0]?.tbl) {
      globalForHa.__maestroHaQueueCleaned.add(backupPool);
      return 0;
    }

    const pending = await backupPool.query(
      `SELECT id, sql_text, params_json FROM _ha_sync_queue WHERE synced = FALSE ORDER BY id ASC LIMIT 2000`
    );
    const brokenIds: number[] = [];
    for (const row of pending.rows || []) {
      let parsed: unknown = [];
      try {
        parsed = JSON.parse(row.params_json || "[]");
      } catch {
        parsed = null;
      }
      if (!hasValidSqlParams(String(row.sql_text || ""), parsed)) {
        brokenIds.push(Number(row.id));
      }
    }

    if (brokenIds.length > 0) {
      await backupPool.query(
        `UPDATE _ha_sync_queue SET synced = TRUE WHERE id = ANY($1::int[])`,
        [brokenIds]
      );
      console.info(`[db-ha] Cleaned ${brokenIds.length} broken/param-missing item(s) from _ha_sync_queue.`);
    }

    globalForHa.__maestroHaQueueCleaned.add(backupPool);
    return brokenIds.length;
  } catch {
    return 0;
  }
}

/* ---------------- Dual-Write Replication (Primary -> Backup) ---------------- */

async function executeWritesOnPool(targetPool: Pool, batch: CapturedWrite[]): Promise<void> {
  const validBatch = batch.filter((w) => hasValidSqlParams(w.sql, w.params));
  if (!validBatch.length) return;

  const client = await targetPool.connect();
  const tablesToSyncSeq = new Set<string>();
  try {
    await client.query("BEGIN");
    for (const w of validBatch) {
      await client.query(w.sql, w.params);
      if (w.kind === "INSERT" && w.tableName && w.insertedId !== null) {
        tablesToSyncSeq.add(w.tableName);
      }
    }
    for (const tbl of tablesToSyncSeq) {
      await client
        .query(
          `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${tbl}"), 1), 1), true)`
        )
        .catch(() => {});
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
  const validWrites = writes.filter((w) => hasValidSqlParams(w.sql, w.params));
  if (!validWrites.length) return;

  scheduleBackgroundTask(async () => {
    const { getRawPools } = await import("@/db");
    const { backupUrl, getBackupPool } = getRawPools();
    if (!backupUrl) return;

    const backupPool = getBackupPool();
    if (!backupPool) return;

    try {
      const { ensureSchemaOnPool } = await import("./schema-check");
      await ensureSchemaOnPool(backupPool, { label: "Neon Backup" });
      await cleanupBrokenHaSyncQueue(backupPool);

      sanitizePendingBackupQueue();
      if (!globalForHa.__maestroPendingToBackup) {
        globalForHa.__maestroPendingToBackup = [];
      }

      // إعادة تشغيل الدفعات المعلقة السليمة فقط؛ إذا فشلت دفعة قديمة بخطأ معاملات تُحذف فوراً
      while (globalForHa.__maestroPendingToBackup.length > 0) {
        const pendingBatch = globalForHa.__maestroPendingToBackup[0];
        try {
          await executeWritesOnPool(backupPool, pendingBatch);
          globalForHa.__maestroPendingToBackup.shift();
        } catch (replayErr: any) {
          if (isPermanentWriteReplayError(replayErr)) {
            console.warn("[db-ha] Dropped permanently invalid queued batch:", replayErr?.message);
            globalForHa.__maestroPendingToBackup.shift();
            continue;
          }
          throw replayErr;
        }
      }

      await executeWritesOnPool(backupPool, validWrites);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[db-ha] Dual-Write to Neon backup failed:", msg);

      // لا نعيد جدولة أي دفعة فاشلة بسبب نقص معاملات أو صياغة غير قابلة للإعادة
      if (isPermanentWriteReplayError(err)) {
        return;
      }

      if (!globalForHa.__maestroPendingToBackup) {
        globalForHa.__maestroPendingToBackup = [];
      }
      if (globalForHa.__maestroPendingToBackup.length < 200) {
        globalForHa.__maestroPendingToBackup.push(validWrites);
      } else {
        globalForHa.__maestroBackupNeedsFullSync = true;
      }

      // خطأ مفتاح خارجي (سجل أب مفقود في Neon) -> مزامنة آمنة بالدمج (Upsert بدون TRUNCATE)
      if (String(err?.code || "") === "23503" && !globalForHa.__maestroFullSyncPromise) {
        globalForHa.__maestroBackupNeedsFullSync = true;
        void syncPrimaryToBackupFull({ silentAlert: true }).catch(() => {});
      }

      triggerHaTelegramAlert("BACKUP_FAILURE", "⚠️ فشل مزامنة عملية مع القاعدة الاحتياطية (Neon)", [
        `العملية: ${validWrites.map((w) => `${w.kind} ${w.tableName || ""}`).join("، ")}`,
        `السبب: ${msg}`,
        `سيتم الاحتفاظ بالتحديثات وإعادة المحاولة تلقائياً.`,
      ]);
    }
  });
}

/* ---------------- Failover Queue (Backup -> Primary Recovery) ---------------- */

export function scheduleFailoverWriteLog(writes: CapturedWrite[]): void {
  const validWrites = writes.filter((w) => hasValidSqlParams(w.sql, w.params));
  if (!validWrites.length) return;

  scheduleBackgroundTask(async () => {
    const { getRawPools } = await import("@/db");
    const backupPool = getRawPools().getBackupPool();
    if (!backupPool) return;
    try {
      const { ensureSchemaOnPool } = await import("./schema-check");
      await ensureSchemaOnPool(backupPool, { label: "Neon Backup" });
      for (const w of validWrites) {
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

    await cleanupBrokenHaSyncQueue(backupPool, true);

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
        if (!hasValidSqlParams(String(row.sql_text || ""), params)) {
          syncedIds.push(Number(row.id));
          continue;
        }
        await primaryClient.query("SAVEPOINT sp_reconcile_row");
        try {
          await primaryClient.query(row.sql_text, params);
          await primaryClient.query("RELEASE SAVEPOINT sp_reconcile_row");
          syncedIds.push(Number(row.id));
        } catch (rowErr: any) {
          await primaryClient.query("ROLLBACK TO SAVEPOINT sp_reconcile_row").catch(() => {});
          if (isPermanentWriteReplayError(rowErr)) {
            syncedIds.push(Number(row.id));
          } else {
            throw rowErr;
          }
        }
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
      await cleanupBrokenHaSyncQueue(backupPool);
      const qRes = await backupPool.query(
        `SELECT COUNT(*)::int AS c FROM _ha_sync_queue WHERE synced = FALSE`
      );
      pendingFailoverWrites = Number(qRes.rows?.[0]?.c || 0);
    } catch {
      pendingFailoverWrites = 0;
    }
  }

  sanitizePendingBackupQueue();
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

/* ---------------- Safe Upsert Sync (Supabase -> Neon, Zero TRUNCATE) ---------------- */

type SyncTableSpec = {
  table: string;
  pk: string;
  uniqueKeys?: string[][];
  columns: string[];
  hasId: boolean;
};

const FULL_SYNC_TABLES: SyncTableSpec[] = [
  { table: "settings", pk: "id", uniqueKeys: [["key"]], columns: ["id", "key", "value", "updated_at"], hasId: true },
  { table: "payment_methods", pk: "id", uniqueKeys: [["name"]], columns: ["id", "name", "is_active", "created_at"], hasId: true },
  {
    table: "platforms",
    pk: "id",
    uniqueKeys: [["name"]],
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
    pk: "id",
    uniqueKeys: [["username"]],
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
  { table: "customers", pk: "id", uniqueKeys: [["phone"]], columns: ["id", "name", "phone", "notes", "created_at"], hasId: true },
  {
    table: "accounts",
    pk: "id",
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
    pk: "id",
    uniqueKeys: [["account_id", "profile_no"]],
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
    pk: "id",
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
    pk: "id",
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
  { table: "wallet_balances", pk: "user_id", columns: ["user_id", "balance", "updated_at"], hasId: false },
  {
    table: "wallet_transactions",
    pk: "id",
    columns: ["id", "user_id", "type", "amount", "balance_before", "balance_after", "rental_id", "note", "created_by", "created_at"],
    hasId: true,
  },
  {
    table: "whatsapp_logs",
    pk: "id",
    columns: ["id", "rental_id", "customer_id", "phone", "message", "kind", "status", "created_at"],
    hasId: true,
  },
  { table: "alerts", pk: "id", columns: ["id", "title", "body", "kind", "href", "for_user_id", "created_at"], hasId: true },
  { table: "email_codes", pk: "id", columns: ["id", "email", "code_hash", "expires_at", "used", "created_at"], hasId: true },
  {
    table: "audit_logs",
    pk: "id",
    columns: ["id", "user_id", "username", "action", "entity_type", "entity_id", "details", "created_at"],
    hasId: true,
  },
  {
    table: "push_subscriptions",
    pk: "id",
    uniqueKeys: [["endpoint"]],
    columns: ["id", "user_id", "endpoint", "p256dh", "auth", "created_at"],
    hasId: true,
  },
];

async function upsertSingleRowFallback(
  client: PoolClient,
  spec: SyncTableSpec,
  row: Record<string, any>
): Promise<void> {
  const cols = spec.columns;
  const quotedCols = cols.map((c) => `"${c}"`).join(", ");
  const updateCols = cols.filter((c) => c !== spec.pk);
  const updateSet = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
  const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
  const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");

  await client.query("SAVEPOINT sp_upsert_row");
  try {
    await client.query(
      `INSERT INTO "${spec.table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ("${spec.pk}") DO UPDATE SET ${updateSet}`,
      values
    );
    await client.query("RELEASE SAVEPOINT sp_upsert_row");
    return;
  } catch (err: any) {
    await client.query("ROLLBACK TO SAVEPOINT sp_upsert_row").catch(() => {});

    // تعارض مفتاح فريد ثانوي (مثل username أو phone أو endpoint أو settings.key) -> تحديث السجل الفردي دون حذف
    if (String(err?.code || "") === "23505" && spec.uniqueKeys?.length) {
      for (const keyCols of spec.uniqueKeys) {
        const keyVals = keyCols.map((k) => row[k]);
        if (keyVals.some((v) => v === undefined || v === null)) continue;

        const nonKeyCols = cols.filter((c) => c !== spec.pk && !keyCols.includes(c));
        if (!nonKeyCols.length) return;

        const setParams: any[] = nonKeyCols.map((c) => (row[c] === undefined ? null : row[c]));
        const setSql = nonKeyCols.map((c, idx) => `"${c}" = $${idx + 1}`).join(", ");
        const whereSql = keyCols
          .map((k, idx) => {
            setParams.push(row[k]);
            return `"${k}" = $${nonKeyCols.length + idx + 1}`;
          })
          .join(" AND ");

        await client.query("SAVEPOINT sp_upsert_uk");
        try {
          await client.query(`UPDATE "${spec.table}" SET ${setSql} WHERE ${whereSql}`, setParams);
          await client.query("RELEASE SAVEPOINT sp_upsert_uk");
          return;
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT sp_upsert_uk").catch(() => {});
        }
      }
    }
    throw err;
  }
}

async function batchUpsertRows(
  client: PoolClient,
  spec: SyncTableSpec,
  rows: Record<string, any>[]
): Promise<void> {
  if (!rows.length) return;
  const cols = spec.columns;
  const maxRowsPerBatch = Math.max(1, Math.floor(4000 / cols.length));
  const quotedCols = cols.map((c) => `"${c}"`).join(", ");
  const updateCols = cols.filter((c) => c !== spec.pk);
  const updateSet = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");

  for (let offset = 0; offset < rows.length; offset += maxRowsPerBatch) {
    const slice = rows.slice(offset, offset + maxRowsPerBatch);
    const values: any[] = [];
    const tuples: string[] = [];

    for (const r of slice) {
      const placeholders: string[] = [];
      for (const col of cols) {
        values.push(r[col] === undefined ? null : r[col]);
        placeholders.push(`$${values.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }

    await client.query("SAVEPOINT sp_upsert_batch");
    try {
      await client.query(
        `INSERT INTO "${spec.table}" (${quotedCols}) VALUES ${tuples.join(", ")} ON CONFLICT ("${spec.pk}") DO UPDATE SET ${updateSet}`,
        values
      );
      await client.query("RELEASE SAVEPOINT sp_upsert_batch");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT sp_upsert_batch").catch(() => {});
      for (const row of slice) {
        await upsertSingleRowFallback(client, spec, row);
      }
    }
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

    // 1. فحص توفر القاعدتين
    await withTimeout(primaryPool.query("SELECT 1"), 4000, "Supabase Primary");
    await withTimeout(backupPool.query("SELECT 1"), 6000, "Neon Backup");

    // 2. تصريف طابور الطوارئ من Neon -> Supabase أولاً قبل المزامنة
    await reconcileFailoverWritesToPrimary().catch(() => {});

    // 3. ضمان تطابق المخطط على الطرفين
    const { ensureSchemaOnPool, syncSequencesOnQueryable } = await import("./schema-check");
    await Promise.all([
      ensureSchemaOnPool(primaryPool, { label: "Supabase Primary" }),
      ensureSchemaOnPool(backupPool, { force: true, label: "Neon Backup" }),
    ]);

    // 4. سحب جميع الجداول الـ 16 بالتوازي من الأساسية (Supabase)
    const snapshots = await Promise.all(
      FULL_SYNC_TABLES.map(async (spec) => {
        const orderBy = spec.hasId ? `ORDER BY id ASC` : "";
        const res = await primaryPool.query(
          `SELECT ${spec.columns.map((c) => `"${c}"`).join(", ")} FROM "${spec.table}" ${orderBy}`
        );
        return { spec, rows: res.rows || [] };
      })
    );

    // 5. دمج آمن (Safe Upsert بدون أي TRUNCATE أو حذف) في Neon داخل معاملة ذرية
    const backupClient = await backupPool.connect();
    const counts: Record<string, number> = {};
    try {
      await backupClient.query("BEGIN");

      for (const { spec, rows } of snapshots) {
        await batchUpsertRows(backupClient, spec, rows);
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
    console.info(`[db-ha] Safe Upsert sync Supabase -> Neon completed in ${durationMs}ms.`);
    return { counts, durationMs };
  })()
    .catch((err) => {
      const msg = err?.message || String(err);
      if (!opts?.silentAlert) {
        triggerHaTelegramAlert("BACKUP_FAILURE", "⚠️ فشلت المزامنة الآمنة مع القاعدة الاحتياطية (Neon)", [
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
