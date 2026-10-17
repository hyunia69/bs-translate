function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

export function vibrateStart(): void {
  vibrate(40);
}

export function vibrateStop(): void {
  vibrate([30, 60, 30]);
}

export function vibrateError(): void {
  vibrate([100, 50, 100]);
}
