# صور وشعار وأيقونات Maestro Key على Vercel

## ما الذي تأكدنا منه؟

الصور موجودة في نسخة المشروع الحالية، وملف manifest يشير إلى الأسماء الحالية الموضحة أدناه. لا يمكن استنتاج سبب فشل نسخة Vercel المنشورة دون فحص استجابات رابطها.
الأسباب الشائعة: لم تُرفع الصور إلى GitHub، Root Directory خاطئ، فرق في حالة الأحرف، امتداد غير مطابق للصورة، إعادة توجيه الصورة لتسجيل الدخول، أو أيقونة قديمة مخزنة على الهاتف.

**مكان `public` هو جذر تطبيق Next.js بجانب `package.json` و`next.config.ts`، وليس `src/public` أو `src/app/public`.**
إن كان المستودع يحتوي عدة تطبيقات، يكون هذا الجذر هو Root Directory المختار لتطبيق Vercel.

## 1. القائمة الحالية الدقيقة

كل الملفات التالية **PNG حقيقية**. مسار الإنترنت هو مسار الملف مع إزالة كلمة `public` فقط.

| الاستعمال | مسار الملف في المستودع | المقاس الحالي | رابط الملف على نفس النطاق |
| --- | --- | --- | --- |
| شعار تسجيل الدخول والقائمة والخلفية | `public/logo.png` | 1254×1254 | `/logo.png` |
| أيقونة PWA العادية الصغيرة | `public/icons/app-white-v3-192.png` | 192×192 | `/icons/app-white-v3-192.png` |
| أيقونة PWA العادية الكبيرة | `public/icons/app-white-v3-512.png` | 512×512 | `/icons/app-white-v3-512.png` |
| أيقونة أندرويد التكيفية الصغيرة | `public/icons/app-white-v3-maskable-192.png` | 192×192 | `/icons/app-white-v3-maskable-192.png` |
| أيقونة أندرويد التكيفية الكبيرة | `public/icons/app-white-v3-maskable-512.png` | 512×512 | `/icons/app-white-v3-maskable-512.png` |
| أيقونة iPhone / iPad | `public/icons/apple-touch-white-v3-180.png` | 180×180 | `/icons/apple-touch-white-v3-180.png` |
| أيقونة تبويب المتصفح | `public/icons/favicon-white-v3-64.png` | 64×64 | `/icons/favicon-white-v3-64.png` |
| الشعار داخل إشعار النظام | `public/icons/notification-white-v3-192.png` | 192×192 | `/icons/notification-white-v3-192.png` |
| رمز شريط الإشعارات | `public/icons/notification-badge-v3-96.png` | 96×96 | `/icons/notification-badge-v3-96.png` |

يمكن استبدال `logo.png` بشعار مربع 512×512 أو أكبر؛ 1254×1254 هو المقاس الحالي وليس شرطاً ثابتاً للشعار. **مقاسات الأيقونات داخل manifest يجب أن تطابق أبعادها الفعلية بالضبط.**

### ملفات المنصات الموجودة

| المنصة | مسار المستودع | المقاس الحالي | الرابط |
| --- | --- | --- | --- |
| Netflix | `public/platforms/netflix.png` | 1254×1254 PNG | `/platforms/netflix.png` |
| Shahid | `public/platforms/shahid.png` | 1254×1254 PNG | `/platforms/shahid.png` |
| Disney | `public/platforms/disney.png` | 1254×1254 PNG | `/platforms/disney.png` |
| YouTube | `public/platforms/youtube.png` | 1254×1254 PNG | `/platforms/youtube.png` |
| OSN | `public/platforms/osn.png` | 1254×1254 PNG | `/platforms/osn.png` |
| TOD | `public/platforms/tod.png` | 1254×1254 PNG | `/platforms/tod.png` |

الصور التي ترفعها يدوياً من إعدادات المنصات قد تكون محفوظة في قاعدة البيانات؛ الجدول أعلاه يخص الصور المحلية التي تضبطها التهيئة الأساسية.

### استثناء مهم خارج public

`src/app/icon.png` مقاسه **64×64 PNG** ويجب أن يطابق `public/icons/favicon-white-v3-64.png`.
Next.js يكتشف هذا الملف تلقائياً، وقد يعطيه أولوية على تعريف الأيقونة في metadata. لذلك لا تترك فيه شعاراً قديماً أو ملفاً فارغاً.

### مصادر توليد الأيقونات (ليست روابط تستخدمها شاشة الدخول)

- `public/notify-icon.png`: مصدر الشعار المبسّط للأيقونات، **1254×1254 PNG**.
- `public/icons/notification-badge-v2.svg`: رسم المفتاح الأبيض الشفاف، **viewBox 96×96**، لتوليد PNG الخاص بالشريط.
- `scripts/generate-brand-icons.mjs`: يولّد الأيقونات الحالية من المصدرين أعلاه.

لتوليد المقاسات مجدداً:

```sh
node scripts/generate-brand-icons.mjs
```

هذا لا يغير `public/logo.png` أو واجهات التطبيق. لا يلزم رفع ملفات `*-v2-*.png` القديمة أو الأسماء البديلة في جذر public لإصلاح النسخة الحالية، طالما كل المراجع هي الأسماء v3 أعلاه.

## 2. أين يستدعي الكود كل صورة؟

- `src/app/login/page.tsx` و`src/components/BrandLogo.tsx` و`src/components/Shell.tsx`: يستدعون `/logo.png`.
- `src/app/layout.tsx`: يربط `/manifest.json`، وأيقونة المتصفح 64، وApple touch 180.
- `public/manifest.json`: يربط أيقونات PWA الأربع (192 و512 للعادية والتكيفية).
- `public/sw.js` و`src/components/AlertWatcher.tsx`: يستخدمان أيقونة الإشعار 192 وbadge 96.
- `src/lib/seed.ts`: يحدد الصور الافتراضية للمنصات المحلية.

رابط الصورة **ليس** `/public/logo.png`، ولا `/src/app/logo.png`. الرابط الصحيح `/logo.png`.
`Logo.PNG` و`logo.png` ليسا نفس الاسم على خادم النشر؛ استعمل الأسماء الصغيرة كما هي.
لا يكفي تغيير امتداد JPEG إلى PNG؛ يجب أن تكون محتويات الملف PNG فعلية.

## 3. التحقق من manifest.json

الملف الحالي موجود في `public/manifest.json`، ويُعرض في الإنترنت على `/manifest.json`:

- `id`: `/` — هوية التطبيق ثابتة.
- `start_url`: `/sale`.
- `scope`: `/`.
- `display`: `standalone`.
- `background_color` و`theme_color`: `#050914` (يبقى شكل التطبيق غامقاً).
- الأيقونتان `app-white-v3-192.png` و`app-white-v3-512.png`: `purpose=any`.
- الأيقونتان اللتان تحتوي أسماؤهما `maskable`: `purpose=maskable`.
- `sizes` لكل أيقونة يساوي أبعاد PNG الحقيقية، و`type=image/png` للجميع.
- كل `src` يبدأ `/icons/`؛ لا يحتوي `/public` أو نطاق المعاينة القديم.
- أيقونة Apple touch وnotification ليستا بديلاً لأيقونات manifest؛ يجب رفعهما أيضاً.

أيقونة `maskable` لها خلفية كاملة، والشعار داخل المساحة الآمنة حتى لا يقصّه نظام الهاتف.
رمز إشعارات أندرويد `notification-badge-v3-96.png` **مفتاح أبيض على خلفية شفافة**؛ لا تضع خلفية بيضاء معتمة خلفه، وإلا سيبدو مربعاً أبيض فارغاً في الشريط.

## 4. فحص النسخة المنشورة على Vercel

1. من **Settings → Build and Deployment** تأكد:
   - Framework Preset: **Next.js**.
   - Root Directory: المجلد الذي يحتوي `package.json` و`public` معاً.
   - Build Command: `npm run build`.
   - لا تضبط Output Directory على `public` أو `out` لهذا التطبيق الكامل. اترك إعداد Next.js الافتراضي.
2. تأكد أن ملفات الصور نفسها موجودة في Commit على GitHub، لا فقط على جهازك، ولا ملفات Git LFS النصية بدلاً منها.
3. أكمل Deploy للإصدار الذي يحتوي الصور والكود الحالي. **هذه المعاينة لا تعدّل Vercel نيابة عنك.**
4. افتح من نطاق الإنتاج نفسه، بدون تسجيل دخول:
   - `/logo.png`.
   - `/manifest.json`.
   - `/icons/app-white-v3-512.png`.
   - `/icons/notification-white-v3-192.png`.
5. افتح أدوات المتصفح **Network**:
   - الصورة يجب أن ترجع **200** و`Content-Type: image/png` ومحتوى صورة صالح.
   - إذا رجعت 404: الاسم/المجلد/الرفع/الجذر غير صحيح.
   - إذا رجعت 307 أو صفحة دخول: يوجد Middleware/Redirect في نسختك يحمي الصور بالخطأ.
   - إذا رجعت 200 ولكن `text/html`: توجد إعادة كتابة إلى صفحة، أو تحاول عرض خطأ/دخول كأنه صورة.
   - إذا رجعت 401/403 من Vercel نفسه: راجع Deployment Protection للنسخة التي تختبرها.
6. من **Application → Manifest** تأكد أن المعاينة تعرض الأيقونات الأربع بلا أخطاء تنزيل أو مقاسات.
7. من **Application → Service Workers** حدّث Worker أو ألغِ تسجيل النسخة القديمة للاختبار، ثم أعد فتح الموقع.
8. إذا كانت الصور تظهر في المتصفح وما زالت أيقونة الهاتف قديمة، انتظر تحديث التطبيق المثبّت أو أزله وأعد تثبيته **من نطاق الإنتاج نفسه**. تحديث PWA والذاكرة ليس مضموناً خلال دقيقة.

## 5. الفحص الذي أُضيف للمشروع

```sh
npx --no-install tsx scripts/verify-public-assets.ts
```

يعمل الفحص نفسه تلقائياً عند `npm run build` عبر `next.config.ts`.
يرفض البناء برسالة واضحة عند غياب صورة أو اختلاف اسمها أو مقاس الأيقونة أو وجود Git LFS pointer بدلاً من PNG، ويطابق مراجع manifest والإشعارات وfavicon.
بهذا لن يُعلن البناء نجاحه مع غياب ملفات العلامة المطلوبة.

## 6. حزمة جاهزة للرفع

الحزمة `public/downloads/maestro-key-vercel-assets.zip` تحتوي الصور الحالية وملف manifest وfavicon ومصدري توليد الأيقونات، بنفس مجلداتها.
افتح ZIP على جهازك وانسخ المجلدات إلى **جذر تطبيق Next.js** في المستودع.
**لا ترفع ملف ZIP وحده وتتوقع أن Vercel يفكّه. يجب رفع الملفات المستخرجة.**
الحزمة لا تحتوي `.env` أو كلمات مرور أو نسخة بيانات المتجر.
تأكد أن Commit الذي تنشره يحتوي أيضاً تعديلات `next.config.ts` وفحص الأصول إن أردت تفعيل منع الملفات الناقصة تلقائياً.

## مراجع

- [Next.js public folder](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder)
- [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build)
- [PWA web app manifest](https://web.dev/learn/pwa/web-app-manifest)
- [Notification badge requirements](https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge)
