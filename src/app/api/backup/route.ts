import { db } from "@/db";
import { customers, paymentMethods, payments, platforms, rentals, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { audit, jsonError, requireAdmin } from "@/lib/auth";
import {
  buildFullBackupPayload,
  getLastTelegramBackupAt,
  restoreBackupPayload,
  sendBackupDocumentToTelegram,
} from "@/lib/backup";
import { ensureSeeded } from "@/lib/seed";
import { resolveTelegramArchiveConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const admin = await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") || "";
    const format = sp.get("format") || "json";
    const type = sp.get("type") || "customers";
    const dateStr = new Date().toISOString().slice(0, 10);

    if (action === "status") {
      const [lastTelegramBackupAt, cfg] = await Promise.all([
        getLastTelegramBackupAt(),
        resolveTelegramArchiveConfig(),
      ]);
      return Response.json({
        lastTelegramBackupAt,
        telegramConfigured: Boolean(cfg.token && cfg.archiveChatId),
      });
    }

    if (format === "csv") {
      if (type === "rentals") {
        const [rents, pays] = await Promise.all([
          db
            .select({
              id: rentals.id,
              customerName: customers.name,
              customerPhone: customers.phone,
              platformName: platforms.name,
              rentalType: rentals.rentalType,
              status: rentals.status,
              startDate: rentals.startDate,
              endDate: rentals.endDate,
              durationDays: rentals.durationDays,
              isLifetime: rentals.isLifetime,
              customerEmail: rentals.customerEmail,
              sellerName: users.displayName,
              createdAt: rentals.createdAt,
            })
            .from(rentals)
            .innerJoin(customers, eq(rentals.customerId, customers.id))
            .innerJoin(platforms, eq(rentals.platformId, platforms.id))
            .innerJoin(users, eq(rentals.createdBy, users.id))
            .orderBy(desc(rentals.createdAt)),
          db
            .select({
              rentalId: payments.rentalId,
              amount: payments.amount,
              status: payments.status,
              transactionRef: payments.transactionRef,
              bankName: paymentMethods.name,
            })
            .from(payments)
            .leftJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.id)),
        ]);

        const payMap = new Map<number, typeof pays>();
        for (const p of pays) {
          const arr = payMap.get(p.rentalId);
          if (arr) arr.push(p);
          else payMap.set(p.rentalId, [p]);
        }

        const headers = [
          "رقم الاشتراك",
          "اسم العميل",
          "رقم الهاتف",
          "المنصة",
          "النوع",
          "الحالة",
          "تاريخ البداية",
          "تاريخ الانتهاء",
          "المدة (أيام)",
          "إجمالي المدفوع (ر.ي)",
          "حالة الدفع",
          "البنك / المحفظة",
          "رقم العملية",
          "إيميل العميل",
          "البائع",
          "تاريخ الإنشاء",
        ];

        const csvRows = rents.map((r) => {
          const rPays = payMap.get(r.id) || [];
          const totalAmount = rPays
            .filter((p) => p.status !== "REJECTED")
            .reduce((s, p) => s + (p.amount || 0), 0);
          const latestPay = rPays[0];
          return [
            r.id,
            r.customerName,
            r.customerPhone,
            r.platformName,
            r.rentalType === "RENEWAL" ? "تجديد" : "بيع جديد",
            r.status,
            r.startDate ? new Date(r.startDate).toISOString().slice(0, 10) : "",
            r.isLifetime ? "مدى الحياة" : r.endDate ? new Date(r.endDate).toISOString().slice(0, 10) : "",
            r.isLifetime ? "دائم" : r.durationDays,
            totalAmount,
            latestPay?.status || "",
            latestPay?.bankName || (latestPay?.transactionRef?.startsWith("WALLET-") ? "المحفظة" : ""),
            latestPay?.transactionRef || "",
            r.customerEmail || "",
            r.sellerName,
            r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " ") : "",
          ];
        });

        await audit(admin, "BACKUP_CSV_EXPORTED", "rentals", null, `تصدير ملف الاشتراكات CSV (${rents.length} سجل)`);
        const csv = buildCsv(headers, csvRows);
        return new Response(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="maestro-key-subscriptions-${dateStr}.csv"`,
          },
        });
      }

      // Default CSV: customers + summary
      const [custs, rents, pays] = await Promise.all([
        db.select().from(customers).orderBy(desc(customers.createdAt)),
        db.select({ id: rentals.id, customerId: rentals.customerId, status: rentals.status }).from(rentals),
        db.select({ rentalId: payments.rentalId, amount: payments.amount, status: payments.status }).from(payments),
      ]);

      const rentToCust = new Map<number, number>();
      const rentCounts = new Map<number, { total: number; active: number }>();
      for (const r of rents) {
        rentToCust.set(r.id, r.customerId);
        const cur = rentCounts.get(r.customerId) || { total: 0, active: 0 };
        cur.total++;
        if (r.status === "ACTIVE") cur.active++;
        rentCounts.set(r.customerId, cur);
      }

      const paidByCust = new Map<number, number>();
      for (const p of pays) {
        if (p.status === "REJECTED") continue;
        const cid = rentToCust.get(p.rentalId);
        if (cid !== undefined) paidByCust.set(cid, (paidByCust.get(cid) || 0) + (p.amount || 0));
      }

      const headers = [
        "المعرف",
        "اسم العميل",
        "رقم الواتساب",
        "إجمالي الاشتراكات",
        "الاشتراكات النشطة",
        "إجمالي المدفوع (ر.ي)",
        "ملاحظات",
        "تاريخ التسجيل",
      ];
      const csvRows = custs.map((c) => {
        const cnt = rentCounts.get(c.id) || { total: 0, active: 0 };
        return [
          c.id,
          c.name,
          c.phone,
          cnt.total,
          cnt.active,
          paidByCust.get(c.id) || 0,
          c.notes || "",
          c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 19).replace("T", " ") : "",
        ];
      });

      await audit(admin, "BACKUP_CSV_EXPORTED", "customers", null, `تصدير ملف العملاء CSV (${custs.length} عميل)`);
      const csv = buildCsv(headers, csvRows);
      return new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="maestro-key-customers-${dateStr}.csv"`,
        },
      });
    }

    // Default JSON Full Backup Download
    const payload = await buildFullBackupPayload();
    await audit(
      admin,
      "BACKUP_JSON_EXPORTED",
      "backup",
      null,
      `تحميل نسخة احتياطية JSON (${payload.counts.customers} عميل، ${payload.counts.rentals} اشتراك)`
    );
    const body = JSON.stringify(payload, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="maestro-key-backup-${dateStr}.json"`,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/backup GET] failed:", e);
    return jsonError("تعذر تصدير النسخة الاحتياطية", 500);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const admin = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");

    if (action === "sendTelegram") {
      const res = await sendBackupDocumentToTelegram({
        reason: `نسخة احتياطية يدوية بواسطة ${admin.displayName || admin.username}`,
      });
      if (!res.ok) return jsonError(res.error || "فشل إرسال النسخة إلى تيليجرام", 400);
      await audit(admin, "BACKUP_SENT_TELEGRAM", "backup", null, `إرسال نسخة احتياطية إلى تيليجرام: ${res.filename}`);
      return Response.json(res);
    }

    if (action === "restore") {
      if (!b.backup) return jsonError("يرجى اختيار ملف نسخة احتياطية JSON صالح", 400);
      const summary = await restoreBackupPayload(b.backup);
      await audit(
        admin,
        "BACKUP_RESTORED",
        "backup",
        null,
        `استعادة ودمج نسخة احتياطية: +${summary.inserted.customers} عملاء، +${summary.inserted.rentals} اشتراكات، +${summary.inserted.accounts} حسابات`
      );
      return Response.json({ ok: true, summary });
    }

    return jsonError("إجراء غير معروف");
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/backup POST] failed:", e);
    return jsonError(e instanceof Error ? e.message : "خطأ أثناء معالجة النسخة الاحتياطية", 500);
  }
}
