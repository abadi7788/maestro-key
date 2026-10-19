# Maestro Key — مايسترو كي

متجر اشتراكات بواجهات مدير وموظف، مبني بـ Next.js App Router وPostgreSQL وDrizzle.

## الصور وأيقونات Vercel / PWA

- [الأسماء والمسارات والمقاسات وخطوات الفحص](./ASSETS_VERCEL.md).
- فحص مستقل: `npx --no-install tsx scripts/verify-public-assets.ts`.
- يعمل فحص الأصول تلقائياً مع `npm run build` لمنع نشر ملفات صور ناقصة.
- حزمة الصور: `public/downloads/maestro-key-vercel-assets.zip` (تُفك وتُرفع ملفاتها إلى جذر التطبيق).

## إنشاء الجداول على Neon

- [الخطوات بالعربية](./NEON_SETUP.md).
- SQL الجاهز للنسخ إلى Neon SQL Editor: `public/downloads/maestro-key-neon-schema.sql`.
- يحتوي المخطط فقط دون أسرار أو بيانات المتجر.

## رابط دائم بدل روابط المعاينة

[دليل النشر والتحديث بالعربية](./DEPLOYMENT.md) يشرح نشر خدمة واحدة وقاعدة بيانات دائمة على Render، ونقل بيانات المتجر بأمان، واستخدام نفس الرابط عند كل تحديث.

- `render.yaml`: خدمة ويب + PostgreSQL دائم (موارد مدفوعة، ولا تُنشأ دون ربط حساب الاستضافة).
- `.env.example`: أسماء الإعدادات فقط، بلا أسرار.
- `drizzle.production.config.ts` و`drizzle/`: ترحيلات الإنتاج.
- `scripts/check-production-env.mjs`: فحص البيئة قبل النشر.
- `scripts/export-store-data.mjs`: نسخة بيانات خاصة لنقل المتجر (تحتاج pg_dump).

لا ترفع `.env` أو `.env.local` أو `backups/` إلى المستودع.
لا تستخدم `DATABASE_URL` الخاص بالمعاينة كقاعدة إنتاج، ولا تغيّر مفتاح التشفير عند نقل البيانات.

## التطوير المحلي

1. ثبّت الحزم عبر `npm ci`.
2. اضبط البيئة المحلية حسب `.env.example` مع PostgreSQL محلي.
3. طبّق مخطط قاعدة التطوير باستخدام إعداد Drizzle المحلي.
4. عند بدء قاعدة فارغة اضبط `ADMIN_INITIAL_PASSWORD` بكلمة قوية؛ لا يُستخدم أي حساب موظف تجريبي.
5. شغّل `npm run dev`.

## التحقق

```sh
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
```

ملف النشر لا يمثل رابطاً منشوراً فعلياً. تحصل على الرابط الدائم من لوحة الاستضافة بعد ربط المستودع والأسرار ومراجعة التكلفة.
