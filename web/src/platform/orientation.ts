export async function tryLockPortrait(): Promise<void> {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.("portrait");
  } catch {
    return;
  }
}
