"use client";
import { useEffect, useState } from "react";
import RentalsList from "@/components/RentalsList";
import { fetchMe } from "@/lib/client";
import { isAdminRole } from "@/lib/roles";

export default function RenewalsPage() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetchMe().then((u) => {
      if (u && isAdminRole(u.role)) setIsAdmin(true);
    });
  }, []);

  return (
    <RentalsList
      view="renewals"
      adminControls={isAdmin}
      title="🔄 تجديدات مستحقة"
      subtitle="اشتراكات تنتهي خلال يومين أو انتهت ولم تُغلق بعد — اضغط «تجديد» لتمديد الاشتراك على نفس الحساب تلقائياً."
    />
  );
}
