/** PClient başlatma bildirimi: düğmeler başlatmayı duyurur, PClientShell bekleme penceresini gösterir. */
export type LaunchKind = "play" | "install";

const EVENT = "pclient-launch";

export function announceLaunch(kind: LaunchKind) {
  window.dispatchEvent(new CustomEvent<LaunchKind>(EVENT, { detail: kind }));
}

export function onLaunch(listener: (kind: LaunchKind) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<LaunchKind>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
