# إنشاء جداول مايسترو كي على Neon

## ملف SQL الجاهز

الملف: **`public/downloads/maestro-key-neon-schema.sql`**.
يمكن تنزيله من `/downloads/maestro-key-neon-schema.sql` في رابط التطبيق.

الملف مطابق للسكيما والترحيلات الحالية. يحتوي 14 جدولاً للتطبيق، وعلاقاتها وفهارسها، وجدولاً داخلياً لسجل ترحيلات Drizzle.
لا يتضمن أي كلمة مرور أو كود بريد أو بيانات عميل أو مبيعات تجريبية.

## اللصق في Neon

1. افتح مشروعك في [Neon Console](https://console.neon.tech/).
2. اختر الفرع وقاعدة البيانات **الجديدة الفارغة** التي ستستخدمها للمتجر.
3. افتح **SQL Editor**.
4. افتح ملف SQL أعلاه، وانسخ **محتواه كاملاً** إلى المحرر.
5. اضغط **Run** على كامل الملف مرة واحدة؛ لا تشغّل أجزاءه منفصلة.
6. آخر نتيجة يجب أن تعرض `application_tables = 14` ورسالة نجاح.

الجداول:
- `users`: المدير والموظفون.
- `platforms`: المنصات وصورها.
- `accounts`: مخزون الحسابات المشفّر والأسعار والحذف الناعم.
- `profiles`: الملفات / البروفايلات.
- `customers`: العملاء.
- `rentals`: الاشتراكات والمدد والتواريخ.
- `payment_methods`: البنوك ووسائل الدفع.
- `payments`: السندات وحالة مراجعتها والتجديدات.
- `alerts`: إشعارات المستخدمين.
- `push_subscriptions`: اشتراكات Push للأجهزة.
- `email_codes`: أكواد التحقق بالبريد (مجزأة).
- `audit_logs`: سجل العمليات.
- `settings`: إعدادات المتجر.
- `whatsapp_logs`: سجل رسائل واتساب.

**إذا وجدت جداول سابقة يتوقف الملف دون حذف شيء.** عند ظهور رسالة `Maestro Key tables already exist` لا تحذفها أو تفرغها؛ اختر قاعدة جديدة أو استخدم الترحيلات المعتادة بعد التحقق من مطابقة المخطط.

## بعد إنشاء الجداول

إنشاء الجداول وحده **لا ينقل بيانات المتجر القديمة ولا ينشر رابط التطبيق**.

- من **Connect** في Neon، انسخ اتصال القاعدة الذي يحتوي `sslmode=require` إلى أسرار استضافة التطبيق باسم `DATABASE_URL`.
- استخدم الاتصال المباشر (أوقف Connection pooling) في `DATABASE_URL_UNPOOLED` لترحيلات Drizzle والنسخ الاحتياطية. يمكن للتطبيق استخدام الاتصال pooled.
- لا تضع رابط الاتصال في ملفات `public/` أو المحادثة أو أي `NEXT_PUBLIC_*`.
- إعداد الإنتاج يدعم `DATABASE_URL_UNPOOLED` تلقائياً، ويعود إلى `DATABASE_URL` إذا لم يتوفر.
- إذا استخدمت `render.yaml` السابق، فهو ينشئ Render PostgreSQL افتراضياً؛ لا تترك مرجع `fromDatabase` إذا اخترت Neon. استبدل هذا المرجع بسر `DATABASE_URL` الخاص بـ Neon قبل النشر، ولا تنشئ قاعدة Render إضافية بلا حاجة.

### تريد نقل بيانات المتجر الحالي؟

1. أبقِ `STORE_INITIALIZATION=restore` قبل بدء التطبيق على Neon حتى لا يضيف مستخدماً أو قوائم افتراضية قبل الاستيراد.
2. انقل بياناتك من النسخة السابقة باستخدام النسخ/الاستعادة الموضحة في `DEPLOYMENT.md`.
3. احتفظ بنفس `ACCOUNT_ENCRYPTION_KEY` و`SESSION_SECRET` عند النقل حتى تبقى كلمات مرور الحسابات وSMTP قابلة للقراءة.
4. بعد الاستيراد فعّل التشغيل العادي. التهيئة لا تغيّر مستخدمين موجودين.

### تريد متجراً جديداً فارغاً؟

اضبط `ADMIN_INITIAL_PASSWORD` بكلمة قوية (12 حرفاً على الأقل) و`STORE_INITIALIZATION=create` على الخادم.
عند أول تشغيل ناجح يهيئ التطبيق حساب المدير والقوائم الأساسية فقط. لا يوجد باسورد مدير تجريبي داخل SQL.

## توافق تحديثات Drizzle

الملف يسجّل hash وتاريخ الترحيل الأول في `drizzle.__drizzle_migrations` بنفس تنسيق Drizzle.
لذلك فإن `drizzle-kit migrate --config=drizzle.production.config.ts` لن يعيد إنشاء الجداول التي أنشأتها بملف Neon، بل سيطبق التحديثات الجديدة فقط.

لإعادة توليد الملف بعد تعديل السكيما والترحيلات:

```sh
node scripts/export-neon-schema.mjs
node scripts/export-neon-schema.mjs --check
```

## مراجع

- [SQL Editor في Neon](https://neon.com/docs/get-started/query-with-neon-sql-editor)
- [الاتصال المباشر وConnection pooling](https://neon.com/docs/connect/connection-pooling)
