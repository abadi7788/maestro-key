/**
 * محفظة مايسترو كي (Wallet) — بالريال اليمني (YER)
 * الشحن يدوي من المدير فقط. قاعدة البيانات تمنع نزول الرصيد تحت الصفر
 * عبر CHECK (balance >= 0) في جدول wallet_balances.
 *
 * القاعدة الذهبية: كل تغيير في الرصيد يتم داخل المعاملة نفسها
 * مع تحديث wallet_transactions (before/after + نوع الحركة).
 */
import { db } from "@/db";
import { walletBalances, walletTransactions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export type WalletTxType = "TOPUP" | "PURCHASE" | "REFUND";

export interface WalletBalance {
  userId: number;
  balance: number;
}

export interface WalletTx {
  type: WalletTxType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  rentalId?: number | null;
  note?: string | null;
  createdBy?: number | null;
}

/**
 * جلب رصيد المستخدم الحالي (يُنشئ المحفظة برصيد 0 إذا لم تكن موجودة).
 */
export async function getWallet(userId: number): Promise<WalletBalance> {
  const [row] = await db
    .select()
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))
    .limit(1);
  if (row) return { userId: row.userId, balance: row.balance };
  const [created] = await db
    .insert(walletBalances)
    .values({ userId, balance: 0 })
    .returning();
  return { userId: created.userId, balance: created.balance };
}

/**
 * شحن محفظة المستخدم (يدوي من المدير فقط).
 * يضمن عدم النزول تحت الصفر حتى مع القيم السالبة.
 */
export type WalletInput = {
  userId: number;
  amount: number;
  rentalId?: number | null;
  note?: string;
  createdBy?: number;
};

function normalizeWalletInput(
  inputOrUserId: number | WalletInput,
  maybeAmount?: number,
  maybeNoteOrRentalId?: string | number | null,
  maybeCreatedBy?: number
): {
  userId: number;
  amount: number;
  rentalId?: number | null;
  note?: string;
  createdBy: number;
} {
  if (typeof inputOrUserId === "number") {
    const note = typeof maybeNoteOrRentalId === "string" ? maybeNoteOrRentalId : undefined;
    const rentalId = typeof maybeNoteOrRentalId === "number" ? maybeNoteOrRentalId : undefined;
    return {
      userId: inputOrUserId,
      amount: maybeAmount ?? 0,
      rentalId: rentalId ?? null,
      note,
      createdBy: maybeCreatedBy ?? inputOrUserId,
    };
  }
  return {
    userId: inputOrUserId.userId,
    amount: inputOrUserId.amount,
    rentalId: inputOrUserId.rentalId ?? null,
    note: inputOrUserId.note,
    createdBy: inputOrUserId.createdBy ?? inputOrUserId.userId,
  };
}

/**
 * شحن محفظة المستخدم (يدوي من المدير فقط).
 * يضمن عدم النزول تحت الصفر حتى مع القيم السالبة.
 */
export async function topUpWallet(
  input: WalletInput
): Promise<{ balanceAfter: number }>;
export async function topUpWallet(
  userId: number,
  amount: number,
  note?: string,
  createdBy?: number
): Promise<{ balanceAfter: number }>;
export async function topUpWallet(
  inputOrUserId: number | WalletInput,
  maybeAmount?: number,
  maybeNote?: string,
  maybeCreatedBy?: number
): Promise<{ balanceAfter: number }> {
  const input = normalizeWalletInput(inputOrUserId, maybeAmount, maybeNote, maybeCreatedBy);
  const amount = Math.floor(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.userId, input.userId))
      .limit(1);
    const before = bal?.balance ?? 0;
    const after = before + amount;
    if (bal) {
      await tx
        .update(walletBalances)
        .set({ balance: after, updatedAt: new Date() })
        .where(eq(walletBalances.userId, input.userId));
    } else {
      await tx.insert(walletBalances).values({ userId: input.userId, balance: after });
    }
    await tx.insert(walletTransactions).values({
      userId: input.userId,
      type: "TOPUP",
      amount,
      balanceBefore: before,
      balanceAfter: after,
      note: input.note ?? "شحن محفظة",
      createdBy: input.createdBy,
    });
    return { balanceAfter: after };
  });
}

/**
 * خصم مبلغ من المحفظة (للشراء). يرفض إذا كان الرصيد غير كافٍ.
 * المبلغ موجب دائماً (نخصم المبلغ بالسالب على خلفية المخزن).
 */
export async function deductFromWallet(
  input: WalletInput
): Promise<{ balanceAfter: number }>;
export async function deductFromWallet(
  userId: number,
  amount: number,
  note?: string,
  createdBy?: number
): Promise<{ balanceAfter: number }>;
export async function deductFromWallet(
  inputOrUserId: number | WalletInput,
  maybeAmount?: number,
  maybeNote?: string,
  maybeCreatedBy?: number
): Promise<{ balanceAfter: number }> {
  const input = normalizeWalletInput(inputOrUserId, maybeAmount, maybeNote, maybeCreatedBy);
  const amount = Math.floor(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    // قفل الصف: منع التزامن على نفس الرصيد
    const [bal] = await tx
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.userId, input.userId))
      .limit(1);
    const before = bal?.balance ?? 0;
    if (before < amount) {
      throw new Error(`الرصيد غير كافٍ — المطلوب ${amount} ريال، والمتاح ${before} ريال`);
    }
    const after = before - amount;
    await tx
      .update(walletBalances)
      .set({ balance: after, updatedAt: new Date() })
      .where(and(eq(walletBalances.userId, input.userId), eq(walletBalances.balance, before)));
    await tx.insert(walletTransactions).values({
      userId: input.userId,
      type: "PURCHASE",
      amount,
      balanceBefore: before,
      balanceAfter: after,
      rentalId: input.rentalId ?? null,
      note: input.note ?? "شراء اشتراك",
      createdBy: input.createdBy,
    });
    return { balanceAfter: after };
  });
}

/**
 * إرجاع رصيد للمحفظة عند إلغاء طلب (مثلاً عدم توفر رابط التفعيل).
 */
export async function refundToWallet(
  input: WalletInput
): Promise<{ balanceAfter: number }>;
export async function refundToWallet(
  userId: number,
  amount: number,
  note?: string,
  createdBy?: number
): Promise<{ balanceAfter: number }>;
export async function refundToWallet(
  inputOrUserId: number | WalletInput,
  maybeAmount?: number,
  maybeNote?: string,
  maybeCreatedBy?: number
): Promise<{ balanceAfter: number }> {
  const input = normalizeWalletInput(inputOrUserId, maybeAmount, maybeNote, maybeCreatedBy);
  const amount = Math.floor(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }
  return db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(walletBalances)
      .where(eq(walletBalances.userId, input.userId))
      .limit(1);
    const before = bal?.balance ?? 0;
    const after = before + amount;
    if (bal) {
      await tx
        .update(walletBalances)
        .set({ balance: after, updatedAt: new Date() })
        .where(eq(walletBalances.userId, input.userId));
    } else {
      await tx.insert(walletBalances).values({ userId: input.userId, balance: after });
    }
    await tx.insert(walletTransactions).values({
      userId: input.userId,
      type: "REFUND",
      amount,
      balanceBefore: before,
      balanceAfter: after,
      rentalId: input.rentalId ?? null,
      note: input.note ?? "إلغاء طلب — إرجاع رصيد",
      createdBy: input.createdBy,
    });
    return { balanceAfter: after };
  });
}
