export async function listMicrophones(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `마이크 ${i + 1}` }));
}

export function onDevicesChanged(cb: () => void): () => void {
  const md = navigator.mediaDevices;
  if (!md) return () => undefined;
  md.addEventListener("devicechange", cb);
  return () => md.removeEventListener("devicechange", cb);
}
