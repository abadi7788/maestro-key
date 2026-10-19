"use client";

let registration: Promise<ServiceWorkerRegistration | null> | undefined;

/** Register on login as well as app pages, independently of Push permission. */
export function registerPwaWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!registration) {
    registration = navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).then(async () => navigator.serviceWorker.ready).catch(() => {
      registration = undefined;
      return null;
    });
  }
  return registration;
}
