# إصلاح تثبيت Maestro Key وأيقونات الإشعارات على Vercel

## أيقونة التبويب وإشعارات النظام

تحديث mk8 يضيف `src/app/favicon.ico` بمقاسات متعددة، وروابط إشعارات مُراجَعة، وشعاراً داخل التنبيهات. راجع [FAVICON_NOTIFICATIONS.md](./FAVICON_NOTIFICATIONS.md) للرفع والتجربة على `/icon-check.html`.
الحزمة الحالية الشاملة: `public/downloads/maestro-key-browser-notification-icons.zip`، وهي نفس تحديث PWA الكامل دون أسرار.

## الأسماء المطلوبة جاهزة الآن

| مسار المستودع | رابط المتصفح | المقاس / الاستخدام |
| --- | --- | --- |
| `public/icons/icon-192x192.png` | `/icons/icon-192x192.png` | 192×192 PNG — أيقونة التطبيق والإشعار الملون |
| `public/icons/icon-512x512.png` | `/icons/icon-512x512.png` | 512×512 PNG — أيقونة PWA الكبيرة |
| `public/icons/icon-maskable-512x512.png` | `/icons/icon-maskable-512x512.png` | 512×512 PNG — `purpose=maskable` للأندرويد |
| `public/icons/badge-72x72.png` | `/icons/badge-72x72.png` | 72×72 PNG — مفتاح أبيض بخلفية شفافة لشريط الإشعارات |

الملفات مشتقة من شعار Maestro Key الموجود، وبنفس تصميم الأيقونة البيضاء المدورة الذي تم اختياره. لم تُبدّل واجهات المتجر أو إعدادات البريد.
أيقونة maskable لها خلفية معتمة كاملة، والشعار داخل مساحة آمنة قطرها أقل من 80% حتى لا يقصّه نظام الهاتف.
أيقونة badge ليست شعاراً ملوناً؛ أندرويد يحولها إلى رمز أحادي اللون اعتماداً على الشفافية.

**ملفات إضافية موجودة لدعم الشعار وiPhone والمتصفح:**
- `public/logo.png`: شعار صفحات المتجر.
- `public/icons/apple-touch-white-v3-180.png`: Apple touch 180×180.
- `public/icons/favicon-white-v3-64.png`: favicon 64×64.
- `src/app/icon.png`: نفس favicon 64×64، لأن Next.js يكتشف الملف تلقائياً.

## manifest واحد، وليس ملفين متعارضين

التطبيق يستخدم `public/manifest.json` مربوطاً من `src/app/layout.tsx`. لا تضف `src/app/manifest.ts` آخر لنفس الغرض.
الخصائص الحالية:
- `id=/` و`scope=/` و`start_url=/sale` للحفاظ على هوية التطبيق الموجود.
- `display=standalone`.
- `prefer_related_applications=false`.
- أيقونتان 192 و512 بـ `purpose=any` وأيقونة maskable مستقلة 512.
- كل `type=image/png` و`sizes` مطابق لأبعاد الملف الحقيقية.
- كل المسارات تبدأ `/icons/`، وليس `/public/icons/`.
- واجهة المتجر وشاشة البدء تظلان غامقتين عبر `theme_color` و`background_color`.

## إصلاح تسجيل Service Worker

- `src/components/PwaInstall.tsx` مربوط في Layout العام: التسجيل يبدأ من **صفحة الدخول** ولا ينتظر حساب موظف/مدير أو السماح بالإشعارات.
- `src/lib/pwa-client.ts` يسجل `/sw.js` مع `scope=/` و`updateViaCache=none` في HTTPS/localhost فقط.
- يوجد خيار «تثبيت التطبيق» عند وصول حدث Chromium الحقيقي `beforeinstallprompt` فقط؛ لا نعرض وعداً زائفاً بالتثبيت إن لم يسمح المتصفح.
- `sw.js` يُرسل كـ JavaScript ولا يُحوّل لتسجيل الدخول، وmanifest والأيقونات متاحة دون مصادقة التطبيق.
- يوجد Fetch handler وشاشة `public/offline.html` للانقطاع. الكاش يحتوي صوراً عامة وصفحة عامة فقط؛ لا تُخزَّن بيانات العملاء، كلمات المرور، الـAPI أو صفحات الحسابات.
- إشعارات Push وإشعارات الصفحة تستخدمان `/icons/icon-192x192.png` و`/icons/badge-72x72.png`.
- أيقونة الإشعار لا تغني عن مفتاحي VAPID والاشتراك والإذن. الخلفية الحقيقية تعمل عبر Web Push، لا مؤقت داخل الـService Worker.

## حزمة الرفع

- `public/downloads/maestro-key-pwa-icons.zip`: الملفات الأربعة المطلوبة + manifest فقط.
- `public/downloads/maestro-key-pwa-fix.zip`: حزمة الإصلاح الكاملة، فيها الصور، manifest، Service Worker، تسجيله من Login، الـLayout، الحماية، إعدادات البناء وفحص الأصول.

فك ZIP على جهازك وارفع **الملفات المستخرجة** إلى نفس أماكنها في مستودع GitHub. رفع ملف ZIP وحده لا ينشئ الأيقونات على Vercel.
حزمة الإصلاح لا تحتوي `.env` أو كلمات مرور أو بيانات المتجر أو تغييرات قاعدة البيانات.
تحتوي كذلك صور المنصات والشعار حتى يعمل فحص الأصول الذي يمنع نشر صور ناقصة.

## الفحص بعد نشر Commit جديد على Vercel

1. Framework Preset = Next.js، وRoot Directory هو المجلد الذي فيه `package.json` و`public` معاً.
2. انشر الملفات على نفس مشروع/نطاق الإنتاج (Redeploy للإصدار الجديد)، ولا تختبر رابط Commit قديم.
3. افتح هذه المسارات من نطاق الإنتاج دون تسجيل دخول:
   - `/manifest.json`: يجب أن يرجع 200 وJSON، لا HTML أو صفحة حماية Vercel.
   - `/icons/icon-192x192.png`، `/icons/icon-512x512.png`، `/icons/icon-maskable-512x512.png`، `/icons/badge-72x72.png`: صور PNG، 200.
   - `/sw.js`: 200 ومحتوى JavaScript، لا 307/HTML.
4. من Chrome DevTools → Application → Manifest: لا توجد أخطاء الصور أو المقاسات أو start_url خارج scope.
5. من Application → Service Workers: التسجيل Activated ونطاقه `/`. افتح صفحة الدخول أولاً ثم حدّث الصفحة إذا كان الهاتف يحمل نسخة Worker سابقة.
6. استخدم HTTPS ورابط إنتاج يمكن الوصول إليه دون Vercel Deployment Protection. لا تستخدم التصفح الخفي أو المتصفح الداخلي لتطبيق مراسلة عند اختبار زر التثبيت.
7. إذا التطبيق مثبّت بالفعل، Chrome قد لا يعرض زر تثبيت آخر. إذا أيقونته قديمة فانتظر تحديث WebAPK، أو أزل النسخة السابقة ثم أعد التثبيت من نفس نطاق الإنتاج النهائي.
8. في iOS استخدم Safari → مشاركة → إضافة إلى الشاشة الرئيسية؛ الحدث `beforeinstallprompt` ليس مدعوماً هناك.

**لا يمكن ضمان أن زر التثبيت يظهر فوراً بمجرد رفع الصور.** القرار للمتصفح وقد يعتمد على التفاعل مع الصفحة، حالة التثبيت، وسياسات الجهاز/النطاق. ولا يمكن إزالة تحذير Chrome عن سمعة نطاق أو الإشعارات بمجرد تعديل الأيقونة.

## فحص من جهاز المطور

```sh
npx --no-install tsx scripts/verify-public-assets.ts
npx --no-install tsx scripts/verify-public-assets.test.ts
npx --no-install tsx scripts/verify-pwa.test.ts
```

لتوليد الأيقونات مجدداً من مصادر الشعار:

```sh
node scripts/generate-brand-icons.mjs
node scripts/package-pwa-fix.mjs
```

لا يلزم توليدها على Vercel إن رُفعت ملفات PNG الحقيقية. لا ترفع ملفات LFS النصية أو JPEG أعيدت تسميتها PNG.

## مراجع
- https://nextjs.org/docs/app/guides/progressive-web-apps
- https://web.dev/articles/install-criteria
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
