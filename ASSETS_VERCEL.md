# صور وأيقونات Maestro Key الحالية

تم توحيد أسماء PWA. الدليل الحالي الكامل: [PWA_SETUP.md](./PWA_SETUP.md).

## الملفات المطلوبة حالياً في public/icons

| الاسم | المقاس | الاستخدام |
| --- | --- | --- |
| `icon-192x192.png` | 192×192 PNG | أيقونة التطبيق والإشعار الملون |
| `icon-512x512.png` | 512×512 PNG | أيقونة التطبيق الكبيرة |
| `icon-maskable-512x512.png` | 512×512 PNG | أندرويد، `purpose=maskable` |
| `badge-72x72.png` | 72×72 PNG | رمز الإشعارات الأبيض الشفاف |
| `apple-touch-white-v3-180.png` | 180×180 PNG | iPhone / iPad |
| `favicon-16x16.png` | 16×16 PNG | أيقونة تبويب صغيرة |
| `favicon-32x32.png` | 32×32 PNG | أيقونة تبويب المتصفح |
| `favicon-64x64.png` | 64×64 PNG | نسخة `src/app/icon.png` |

ملف المتصفح الأساسي `src/app/favicon.ico` يحتوي 16 و32 و48 و64 ويُعرض على `/favicon.ico`. دليل الإصلاح: [FAVICON_NOTIFICATIONS.md](./FAVICON_NOTIFICATIONS.md).

`public/logo.png` مقاسه الحالي 1254×1254 ويُستخدم في تسجيل الدخول والقائمة والخلفية.
صور المنصات في `public/platforms/`: `netflix.png`, `shahid.png`, `disney.png`, `youtube.png`, `osn.png`, `tod.png`، كلها 1254×1254 في النسخة الحالية.

ضع public بجانب package.json وليس داخل src. رابط المتصفح يبدأ `/icons/` أو `/logo.png`، ولا يحتوي `/public`.
أسماء الأحرف وحجمها مهمة على Vercel؛ تأكد أن ملفات الصور نفسها مرفوعة إلى Commit.

## الحزم الجديدة

- `public/downloads/maestro-key-pwa-icons.zip`: الصور الأربعة وmanifest.
- `public/downloads/maestro-key-pwa-fix.zip`: الملفات الكاملة للإصلاح والتسجيل والاختبارات.
- `public/downloads/maestro-key-vercel-assets.zip`: نسخة من حزمة الأصول والتثبيت الحالية للتوافق مع رابط التنزيل السابق.

فك الحزمة وارفع الملفات المستخرجة، وليس ZIP وحده. انشر نفس المشروع مجدداً بعد الرفع.
الأسماء القديمة v2/v3 بقيت للتوافق مع الأجهزة السابقة، لكن manifest والإشعارات الآن يستخدمان الأسماء القياسية أعلاه.

فحص الصور يعمل تلقائياً أثناء `npm run build` عبر `src/lib/asset-preflight.ts`، ويمكن تشغيله منفصلاً عبر `npx --no-install tsx scripts/verify-public-assets.ts`.

راجع الدليل الجديد لمعالجة 404، صفحات Vercel Protection، أخطاء MIME/manifest، كاش Worker وأيقونة الهاتف القديمة. لا ترفع أي `.env` أو بيانات متجر داخل public.
