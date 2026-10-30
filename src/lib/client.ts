import type { PermissionKey } from "@/lib/permissions";

export async function api<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "حدث خطأ"), { status: res.status, data });
  return data as T;
}

export type Me = {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE" | string;
  walletBalance: number;
  permissions?: Record<PermissionKey, boolean>;
};

export async function fetchMe(): Promise<Me | null> {
  try { const d = await api<{ user: Me }>("/api/auth"); return d.user; } catch { return null; }
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v); if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-YE", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v); if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-YE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function daysLeft(end: string) { return Math.ceil((new Date(end).getTime() - Date.now()) / 86400000); }
export function money(n: number) { return (n || 0).toLocaleString("ar-YE") + " ر.ي"; }

export function waLink(phone: string, message: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length === 9 && p.startsWith("7")) p = "967" + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

export function openWhatsapp(phone: string, message: string) {
  if (typeof window === "undefined") return;
  window.open(waLink(phone, message), "_blank", "noopener,noreferrer");
}

/** Compress an image file to a JPEG data URL (max 1100px) to keep receipts light. */
export function fileToDataUrl(file: File, maxDim = 1100, asPng = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(asPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => resolve(String(reader.result));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة"));
    reader.readAsDataURL(file);
  });
}

export function compressImage(file: File): Promise<string> {
  return fileToDataUrl(file, 1100, false);
}

export function compressLogo(file: File): Promise<string> {
  const keepPng = file.type === "image/png" || file.type === "image/webp";
  return fileToDataUrl(file, 512, keepPng);
}
