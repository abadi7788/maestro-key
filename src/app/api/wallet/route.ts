import { db } from "@/db";
import { users, walletBalances, walletTransactions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { canChargeWallet } from "@/lib/permissions";
import {
  getWallet,
  getWalletTransactions,
  topUpWallet,
  adminDeductWallet,
} from "@/lib/wallet";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;

    // عرض كل محافظ الموظفين للإدارة
    if (sp.get("all") === "1") {
      if (!canChargeWallet(user)) {
        return jsonError("هذه الصلاحية للمدير فقط", 403);
      }
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          isActive: users.isActive,
          legacyBalance: users.walletBalance,
        })
        .from(users)
        .orderBy(users.id);

      const balances = await db.select().from(walletBalances);
      const balMap = new Map(balances.map((b) => [b.userId, b]));

      const recentTx = await db
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
          createdAt: walletTransactions.createdAt,
        })
        .from(walletTransactions)
        .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
        .limit(100);

      const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

      const wallets = allUsers.map((u) => {
        const wb = balMap.get(u.id);
        const balance = wb ? wb.balance : Math.max(0, Math.floor(Number(u.legacyBalance || 0)));
        return {
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          balance,
          updatedAt: wb?.updatedAt ?? null,
        };
      });

      return Response.json({
        wallets,
        transactions: recentTx.map((t) => ({
          ...t,
          userDisplayName: userMap.get(t.userId) || `#${t.userId}`,
          createdByName: t.createdBy ? userMap.get(t.createdBy) || `#${t.createdBy}` : "النظام",
        })),
      });
    }

    const targetId = sp.get("userId") ? Number(sp.get("userId")) : user.id;
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return jsonError("معرّف مستخدم غير صالح");
    }
    if (targetId !== user.id && !canChargeWallet(user)) {
      return jsonError("غير مصرح لك بعرض محفظة مستخدم آخر", 403);
    }

    const wallet = await getWallet(targetId);
    const transactions = await getWalletTransactions(targetId, 50);
    return Response.json({
      userId: targetId,
      balance: wallet.balance,
      transactions,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/wallet GET] failed:", e);
    return jsonError("خطأ في تحميل بيانات المحفظة", 500);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const actor = await requireUser();
    if (!canChargeWallet(actor)) {
      return jsonError("شحن وتسوية المحافظ متاح للمدير فقط", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "topup");
    const userId = Number(body.userId);
    const amount = Math.floor(Number(body.amount || 0));
    const note = String(body.note || "").trim();

    if (!Number.isInteger(userId) || userId <= 0) {
      return jsonError("اختر الموظف أولاً");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError("أدخل مبلغاً صحيحاً أكبر من صفر");
    }

    const [target] = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return jsonError("المستخدم غير موجود", 404);

    if (action === "topup") {
      const res = await topUpWallet({
        userId,
        amount,
        note: note || "شحن رصيد من الإدارة",
        createdBy: actor.id,
      });

      await notifyUser(userId, {
        title: "💳 تم شحن محفظتك",
        body: `أُضيف ${amount.toLocaleString("ar-YE")} ر.ي إلى محفظتك. رصيدك الحالي: ${res.balanceAfter.toLocaleString("ar-YE")} ر.ي${note ? ` — ${note}` : ""}`,
        kind: "WALLET_TOPUP",
        href: "/sale",
      });

      await audit(
        actor,
        "WALLET_TOPUP",
        "users",
        userId,
        `شحن محفظة ${target.displayName} (@${target.username}) بمبلغ ${amount} ر.ي — الرصيد الجديد ${res.balanceAfter} ر.ي${note ? ` (${note})` : ""}`,
      );

      return Response.json({
        ok: true,
        balanceBefore: res.balanceBefore,
        balanceAfter: res.balanceAfter,
        message: `تم شحن محفظة ${target.displayName} بمبلغ ${amount.toLocaleString("ar-YE")} ر.ي بنجاح`,
      });
    }

    if (action === "deduct") {
      const res = await adminDeductWallet({
        userId,
        amount,
        note: note || "خصم تسوية إدارية",
        createdBy: actor.id,
      });

      await notifyUser(userId, {
        title: "💳 تسوية على المحفظة",
        body: `تم خصم ${amount.toLocaleString("ar-YE")} ر.ي من محفظتك. رصيدك الحالي: ${res.balanceAfter.toLocaleString("ar-YE")} ر.ي${note ? ` — ${note}` : ""}`,
        kind: "WALLET_DEDUCT",
        href: "/sale",
      });

      await audit(
        actor,
        "WALLET_DEDUCT",
        "users",
        userId,
        `خصم من محفظة ${target.displayName} (@${target.username}) مبلغ ${amount} ر.ي — الرصيد الجديد ${res.balanceAfter} ر.ي${note ? ` (${note})` : ""}`,
      );

      return Response.json({
        ok: true,
        balanceBefore: res.balanceBefore,
        balanceAfter: res.balanceAfter,
        message: `تم خصم ${amount.toLocaleString("ar-YE")} ر.ي من محفظة ${target.displayName}`,
      });
    }

    return jsonError("إجراء محفظة غير معروف");
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[api/wallet POST] failed:", e);
    return jsonError(e?.message || "تعذر تنفيذ العملية على المحفظة", 400);
  }
}
