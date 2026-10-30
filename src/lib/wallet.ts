/**
 * محفظة مايسترو كي (Wallet) — بالريال اليمني (YER)
 * الشحن والتسوية من المدير (أو من يملك صلاحية WALLET_CHARGE).
 * قاعدة البيانات تمنع نزول الرصيد تحت الصفر عبر CHECK (balance >= 0).
 *
 * القاعدة الذهبية:
 * 1) كل تغيير في الرصيد يتم داخل معاملة (Transaction) مع قفل صف (FOR UPDATE)
 * 2) يُسجَّل في wallet_transactions (before/after + نوع الحركة + المنفّذ)
 * 3) يُزامَن حقل users.wallet_balance في نفس المعاملة للتوافق التام
 */
import { db } from "@/db";
import { users, walletBalances, walletTransactions } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export type WalletTxType = "TOPUP" | "PURCHASE" | "REFUND" | "DEDUCT";

export interface WalletBalance {
  userId: number;
  balance: number;
}

export interface WalletTxRow {
  id: number;
  userId: number;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  rentalId: number | null;
  note: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: Date;
}

async function ensureLockedWalletRow(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: number): Promise<number> {
  // تأكد من وجود صف في wallet_balances (مع استيراد أي رصيد سابق من users.wallet_balance عند أول إنشاء)
  const existing = await tx.execute(sql`
    SELECT balance FROM wallet_balances WHERE user_id = ${userId} FOR UPDATE
  `);
  const rows = existing.rows as Array<{ balance: number }>;
  if (rows.length > 0) {
    return Number(rows[0].balance) || 0;
  }

  const [u] = await tx
    .select({ walletBalance: users.walletBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const initial = Math.max(0, Math.floor(Number(u?.walletBalance || 0)));

  await tx
    .insert(walletBalances)
    .values({ userId, balance: initial })
    .onConflictDoNothing();

  const locked = await tx.execute(sql`
    SELECT balance FROM wallet_balances WHERE user_id = ${userId} FOR UPDATE
  `);
  const lockedRows = locked.rows as Array<{ balance: number }>;
  return Number(lockedRows[0]?.balance ?? initial) || 0;
}

/**
 * جلب رصيد المستخدم الحالي (يُنشئ المحفظة تلقائياً إذا لم تكن موجودة).
 */
export async function getWallet(userId: number): Promise<WalletBalance> {
  const [row] = await db
    .select()
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))
    .limit(1);
  if (row) return { userId: row.userId, balance: row.balance };

  const [u] = await db
    .select({ walletBalance: users.walletBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const initial = Math.max(0, Math.floor(Number(u?.walletBalance || 0)));

  const inserted = await db
    .insert(walletBalances)
    .values({ userId, balance: initial })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return { userId: inserted[0].userId, balance: inserted[0].balance };
  }
  const [again] = await db
    .select()
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))
    .limit(1);
  return { userId, balance: again?.balance ?? initial };
}

/**
 * شحن محفظة الموظف/الموزع (يدوي من المدير).
 */
export async function topUpWallet(input: {
  userId: number;
  amount: number;
  note?: string;
  createdBy: number;
}): Promise<{ balanceBefore: number; balanceAfter: number; txId: number }> {
  const amount = Math.floor(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const before = await ensureLockedWalletRow(tx, input.userId);
    const after = before + amount;
    const now = new Date();

    await tx
      .update(walletBalances)
      .set({ balance: after, updatedAt: now })
      .where(eq(walletBalances.userId, input.userId));

    await tx
      .update(users)
      .set({ walletBalance: String(after) })
      .where(eq(users.id, input.userId));

    const [created] = await tx
      .insert(walletTransactions)
      .values({
        userId: input.userId,
        type: "TOPUP",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        note: input.note?.trim() || "شحن محفظة من الإدارة",
        createdBy: input.createdBy,
      })
      .returning({ id: walletTransactions.id });

    return { balanceBefore: before, balanceAfter: after, txId: created.id };
  });
}

/**
 * خصم تسوية يدوية من محفظة الموظف/الموزع بواسطة المدير (مع منع النزول تحت الصفر).
 */
export async function adminDeductWallet(input: {
  userId: number;
  amount: number;
  note?: string;
  createdBy: number;
}): Promise<{ balanceBefore: number; balanceAfter: number; txId: number }> {
  const amount = Math.floor(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const before = await ensureLockedWalletRow(tx, input.userId);
    if (before < amount) {
      throw new Error(`الرصيد الحالي (${before.toLocaleString("ar-YE")} ر.ي) أقل من مبلغ الخصم المطلوب (${amount.toLocaleString("ar-YE")} ر.ي)`);
    }
    const after = before - amount;
    const now = new Date();

    await tx
      .update(walletBalances)
      .set({ balance: after, updatedAt: now })
      .where(eq(walletBalances.userId, input.userId));

    await tx
      .update(users)
      .set({ walletBalance: String(after) })
      .where(eq(users.id, input.userId));

    const [created] = await tx
      .insert(walletTransactions)
      .values({
        userId: input.userId,
        type: "DEDUCT",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        note: input.note?.trim() || "خصم تسوية إدارية",
        createdBy: input.createdBy,
      })
      .returning({ id: walletTransactions.id });

    return { balanceBefore: before, balanceAfter: after, txId: created.id };
  });
}

/**
 * خصم مبلغ من المحفظة (للشراء الفوري من نقطة البيع).
 */
export async function deductFromWallet(input: {
  userId: number;
  amount: number;
  rentalId?: number | null;
  note?: string;
  createdBy: number;
}): Promise<{ balanceBefore: number; balanceAfter: number; txId: number }> {
  const amount = Math.floor(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const before = await ensureLockedWalletRow(tx, input.userId);
    if (before < amount) {
      throw new Error(`رصيد المحفظة غير كافٍ — المطلوب ${amount.toLocaleString("ar-YE")} ر.ي والمتاح ${before.toLocaleString("ar-YE")} ر.ي`);
    }
    const after = before - amount;
    const now = new Date();

    await tx
      .update(walletBalances)
      .set({ balance: after, updatedAt: now })
      .where(eq(walletBalances.userId, input.userId));

    await tx
      .update(users)
      .set({ walletBalance: String(after) })
      .where(eq(users.id, input.userId));

    const [created] = await tx
      .insert(walletTransactions)
      .values({
        userId: input.userId,
        type: "PURCHASE",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        rentalId: input.rentalId ?? null,
        note: input.note?.trim() || "شراء اشتراك",
        createdBy: input.createdBy,
      })
      .returning({ id: walletTransactions.id });

    return { balanceBefore: before, balanceAfter: after, txId: created.id };
  });
}

/**
 * ربط عملية خصم المحفظة برقم الطلب بعد إنشاء سجل الإيجار.
 */
export async function attachRentalToWalletTx(txId: number, rentalId: number, note?: string): Promise<void> {
  try {
    const patch: Partial<typeof walletTransactions.$inferInsert> = { rentalId };
    if (note) patch.note = note;
    await db.update(walletTransactions).set(patch).where(eq(walletTransactions.id, txId));
  } catch {
    /* non-fatal linkage */
  }
}

/**
 * إرجاع رصيد للمحفظة عند إلغاء طلب أو استرداده.
 */
export async function refundToWallet(input: {
  userId: number;
  amount: number;
  rentalId?: number | null;
  note?: string;
  createdBy: number;
}): Promise<{ balanceBefore: number; balanceAfter: number; txId: number }> {
  const amount = Math.floor(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const before = await ensureLockedWalletRow(tx, input.userId);
    const after = before + amount;
    const now = new Date();

    await tx
      .update(walletBalances)
      .set({ balance: after, updatedAt: now })
      .where(eq(walletBalances.userId, input.userId));

    await tx
      .update(users)
      .set({ walletBalance: String(after) })
      .where(eq(users.id, input.userId));

    const [created] = await tx
      .insert(walletTransactions)
      .values({
        userId: input.userId,
        type: "REFUND",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        rentalId: input.rentalId ?? null,
        note: input.note?.trim() || "إلغاء طلب — إرجاع رصيد",
        createdBy: input.createdBy,
      })
      .returning({ id: walletTransactions.id });

    return { balanceBefore: before, balanceAfter: after, txId: created.id };
  });
}

/**
 * سجل حركات محفظة مستخدم محدد (الأحدث أولاً).
 */
export async function getWalletTransactions(userId: number, limit = 40): Promise<WalletTxRow[]> {
  const rows = await db
    .select({
      id: walletTransactions.id,
      userId: walletTransactions.userId,
      type: walletTransactions.type,
      amount: walletTransactions.amount,
      balanceBefore: walletTransactions.balanceBefore,
      balanceAfter: walletTransactions.balanceAfter,
      rentalId: walletTransactions.rentalId,
      note: walletTransactions.note,
      createdBy: walletTransactions.createdBy,
      createdByName: users.displayName,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .leftJoin(users, eq(walletTransactions.createdBy, users.id))
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
    .limit(limit);
  return rows;
}
