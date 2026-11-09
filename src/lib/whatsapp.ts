import { getSetting } from "./engine";
import { renderTemplate, formatDate } from "./constants";

export interface MessagePayload {
  customerName: string;
  customerPhone?: string;
  platformId: number;
  platformName: string;
  accountType?: "FULL" | "PROFILE" | string | null;
  accountDeliveryKind?: "CREDENTIALS" | "INVITE_LINK" | "LICENSE_KEY" | string | null;
  email?: string | null;
  password?: string | null;
  profileName?: string | null;
  profileNo?: number | null;
  pin?: string | null;
  link?: string | null;
  licenseKey?: string | null;
  note?: string | null;
  endDate?: Date | string | null;
  isLifetime?: boolean;
  days?: number;
  templateType?: "SALE" | "ACTIVATION" | "RENEWAL" | "EXPIRY";
}

/**
 * منشئ رسائل الواتساب الذكي — Maestro Key
 * 1) يميز تلقائياً بين الحساب الكامل وبروفايل الشاشة:
 *    - الحساب الكامل: يحجب سطر الـ PIN نهائياً ويكتب "نوع الحساب: حساب كامل خاص" ويمنع "PIN: حساب كامل".
 *    - البروفايل: يُظهر اسم البروفايل والرمز الرقمي الخاص به فقط.
 * 2) يميز الاشتراكات الدائمة والمفاتيح الرقمية:
 *    - استبدال "صالح حتى" بـ "اشتراك دائم / مدى الحياة" أو "مفتاح تفعيل رقمي".
 * 3) يدعم قالباً مخصصاً لكل منصة بشكل مستقل عبر whatsapp_platform_template_{id}
 * 4) يعبئ جميع المتغيرات بدقة: {{name}}, {{platform}}, {{credentials}}, {{end_date}}, {{profile}}, {{email}}, {{password}}, {{pin}}
 */
export async function buildWhatsAppMessage(payload: MessagePayload): Promise<string> {
  const {
    customerName,
    platformId,
    platformName,
    accountType = "PROFILE",
    accountDeliveryKind = "CREDENTIALS",
    email,
    password,
    profileName,
    profileNo,
    pin,
    link,
    licenseKey,
    note,
    endDate,
    isLifetime,
    days = 30,
    templateType = "SALE",
  } = payload;

  const isFull = accountType === "FULL";
  const isKey = accountDeliveryKind === "LICENSE_KEY";
  
  let endLabel = "";
  if (isLifetime) {
    endLabel = "اشتراك دائم / مدى الحياة ♾️";
  } else if (isKey) {
    endLabel = "مفتاح تفعيل رقمي دائم (استخدام لمرة واحدة) 🔑";
  } else if (endDate) {
    endLabel = formatDate(endDate);
  } else {
    endLabel = "اشتراك دائم ♾️";
  }

  // 1) فحص وجود قالب مخصص للمنصة المحددة
  let customTpl = await getSetting(`whatsapp_platform_template_${platformId}`, "");
  if (!customTpl || !customTpl.trim()) {
    if (templateType === "ACTIVATION") {
      customTpl = await getSetting("whatsapp_activation_template", "");
    } else if (templateType === "RENEWAL") {
      customTpl = await getSetting("whatsapp_renewal_template", "");
    } else if (templateType === "EXPIRY") {
      customTpl = await getSetting("whatsapp_expiry_template", "");
    } else {
      customTpl = await getSetting("whatsapp_sale_template", "");
    }
  }

  // 2) تجهيز كتلة بيانات الدخول الذكية {{credentials}}
  let credentialsBlock = "";
  if (accountDeliveryKind === "INVITE_LINK" || link) {
    credentialsBlock = `🔗 رابط التفعيل / الدعوة:\n${link || ""}${note ? `\n📝 ملاحظة: ${note}` : ""}`;
  } else if (accountDeliveryKind === "LICENSE_KEY" || licenseKey) {
    credentialsBlock = `🎟️ كود التفعيل الرقمي:\n${licenseKey || ""}${note ? `\n📝 ملاحظة: ${note}` : ""}`;
  } else {
    const lines: string[] = [];
    if (email) lines.push(`📧 الإيميل: ${email}`);
    if (password) lines.push(`🔑 كلمة المرور: ${password}`);

    if (isFull) {
      lines.push(`👑 نوع الاشتراك: حساب كامل خاص (لك بالكامل)`);
      // منع ظهور الـ PIN تماماً للحساب الكامل
    } else {
      const profTitle = profileName || (profileNo ? `بروفايل ${profileNo}` : "بروفايلك الخاص");
      lines.push(`👤 البروفايل: ${profTitle}`);
      if (pin && String(pin).trim() && String(pin).trim() !== "حساب كامل") {
        lines.push(`🔒 رمز الدخول (PIN): ${String(pin).trim()}`);
      }
    }
    if (note) lines.push(`📝 ملاحظة: ${note}`);
    credentialsBlock = lines.join("\n");
  }

  // 3) صياغة متغير {{profile}} لمنع ظهور "PIN: حساب كامل"
  let profileVar = "";
  if (isFull) {
    profileVar = "حساب كامل خاص";
  } else {
    const profTitle = profileName || (profileNo ? `بروفايل ${profileNo}` : "بروفايلك الخاص");
    profileVar = pin && String(pin).trim() && String(pin).trim() !== "حساب كامل" ? `${profTitle} (PIN: ${String(pin).trim()})` : profTitle;
  }

  // القالب الافتراضي إذا لم يكن محفوظاً
  let template = customTpl?.trim();
  if (!template) {
    if (templateType === "ACTIVATION") {
      template = "مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n\n{{credentials}}\n\n⏳ الصلاحية: {{end_date}}\nمشاهدة سعيدة! إذا احتجت أي مساعدة تواصل معنا.";
    } else if (templateType === "RENEWAL") {
      template = "مرحباً {{name}} ✅\nتم تجديد اشتراك {{platform}} بنجاح.\n\n{{credentials}}\n\n⏳ الصلاحية حتى: {{end_date}}\nشكراً لثقتك الدائمة بنا!";
    } else {
      template = "مرحباً {{name}} 🎉\nتم تفعيل اشتراك {{platform}} بنجاح من متجر مايسترو كي 🔑\n\n{{credentials}}\n\n⏳ الصلاحية: {{end_date}}\nمشاهدة سعيدة! لا تشارك البيانات مع أحد.";
    }
  }

  // تنظيف القالب القديم عند الحساب الكامل لمنع ظهور "PIN: حساب كامل"
  if (isFull) {
    template = template
      .replace(/👤\s*البروفايل\s*\/\s*PIN:\s*\{\{profile\}\}/g, "👑 نوع الاشتراك: حساب كامل خاص")
      .replace(/PIN:\s*\{\{profile\}\}/g, "👑 نوع الاشتراك: حساب كامل خاص")
      .replace(/PIN:\s*حساب كامل/g, "نوع الاشتراك: حساب كامل خاص")
      .replace(/الرمز السري:\s*\{\{profile\}\}/g, "👑 نوع الاشتراك: حساب كامل خاص");
  }

  return renderTemplate(template, {
    name: customerName || "العميل",
    platform: platformName,
    email: email || "",
    password: password || "",
    link: link || "",
    licenseKey: licenseKey || "",
    profile: profileVar,
    profile_name: isFull ? "حساب كامل خاص" : (profileName || (profileNo ? `بروفايل ${profileNo}` : "")),
    pin: isFull ? "" : (pin && pin !== "حساب كامل" ? pin : ""),
    account_type: isFull ? "حساب كامل خاص" : "بروفايل / شاشة",
    credentials: credentialsBlock,
    end_date: endLabel,
    days: String(days || ""),
    note: note || "",
  });
}

/**
 * تجهيز رسالة الاعتذار والتعويض بالبيانات الجديدة بضغطة زر
 */
export async function buildReplacementMessage(payload: MessagePayload & { reason?: string }): Promise<string> {
  const isFull = payload.accountType === "FULL";
  const endLabel = payload.isLifetime 
    ? "اشتراك دائم / مدى الحياة ♾️" 
    : payload.endDate 
    ? formatDate(payload.endDate) 
    : "اشتراك دائم ♾️";

  let creds = "";
  if (payload.accountDeliveryKind === "INVITE_LINK" || payload.link) {
    creds = `🔗 رابط التفعيل الجديد:\n${payload.link}`;
  } else if (payload.accountDeliveryKind === "LICENSE_KEY" || payload.licenseKey) {
    creds = `🎟️ كود التفعيل الرقمي الجديد:\n${payload.licenseKey}`;
  } else {
    const lines = [];
    if (payload.email) lines.push(`📧 الإيميل: ${payload.email}`);
    if (payload.password) lines.push(`🔑 كلمة المرور: ${payload.password}`);
    if (!isFull) {
      const prof = payload.profileName || (payload.profileNo ? `بروفايل ${payload.profileNo}` : "بروفايلك الخاص");
      lines.push(`👤 البروفايل: ${prof}`);
      if (payload.pin && String(payload.pin).trim() && String(payload.pin).trim() !== "حساب كامل") {
        lines.push(`🔒 رمز الدخول (PIN): ${String(payload.pin).trim()}`);
      }
    } else {
      lines.push(`👑 نوع الاشتراك: حساب كامل خاص`);
    }
    creds = lines.join("\n");
  }

  return `مرحباً ${payload.customerName} 🌸
نعتذر منك بشدة عن أي توقف أو إزعاج في الخدمة 🙏
تم تعويضك ببيانات اشتراك جديدة فوراً لـ *${payload.platformName}*:

${creds}

⏳ الصلاحية حتى: ${endLabel}

✨ نحن دائماً في خدمتك ونتمنى لك تجربة ممتعة ومميزة!`;
}
