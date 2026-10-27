"use client";

/**
 * شعار مايسترو كي — Maestro Key Brand Mark.
 * يُستخدم في الهيدر والشريط الجانبي وشاشة الدخول وشاشة التحميل.
 * يدعم الأحجام المختلفة: xs | sm | md | lg | xl
 */
export default function BrandLogo({
  size = "md",
  rounded = true,
  glow = true,
  className = "",
}: {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  rounded?: boolean;
  glow?: boolean;
  className?: string;
}) {
  const sizes: Record<string, string> = {
    xs: "h-7 w-7",
    sm: "h-9 w-9",
    md: "h-11 w-11",
    lg: "h-14 w-14",
    xl: "h-28 w-28",
    "xl+": "h-40 w-40",
  };
  const numeric = typeof size === "number";
  const shadow = glow
    ? "shadow-[0_0_28px_rgba(20,99,255,.4),0_0_48px_rgba(255,36,56,.16)]"
    : "";

  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-white/15 ${shadow} ${className}`}
      style={numeric ? { width: size, height: size } : undefined}
    >
      <img
        src="/logo.png"
        alt="Maestro Key"
        className={`${numeric ? "h-full w-full" : sizes[size] || sizes.md} object-cover`}
      />
    </span>
  );
}
