let active = false;

export function isActive(): boolean {
  return active;
}

export function keepScreenOn(): { release(): void } {
  if (!("wakeLock" in navigator)) {
    console.warn("Screen Wake Lock is not supported");
    return { release() {} };
  }
  let wanted = true;
  let sentinel: WakeLockSentinel | null = null;

  const request = async () => {
    if (!wanted || sentinel) return;
    try {
      const s = await navigator.wakeLock.request("screen");
      if (!wanted) {
        void s.release();
        return;
      }
      sentinel = s;
      active = true;
      s.addEventListener("release", () => {
        if (sentinel === s) sentinel = null;
        active = false;
        if (wanted && document.visibilityState === "visible") void request();
      });
    } catch (err) {
      console.warn("Wake lock request failed", err);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void request();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void request();

  return {
    release() {
      wanted = false;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      active = false;
      if (s) void s.release().catch(() => undefined);
    },
  };
}
