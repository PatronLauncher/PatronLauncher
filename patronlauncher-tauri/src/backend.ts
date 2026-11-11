import { msg } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import type { CommandName, CommandArgs, Reply, Snapshot } from "./types/core";
export type Run = <K extends CommandName>(
  command: K,
  args: CommandArgs[K],
) => Promise<Reply | undefined>;
export const call = <K extends CommandName>(command: K, args: CommandArgs[K]) =>
  invoke<Reply>(command, args);
export function playLabel(s: Snapshot): string {
  if (s.running) return msg("OYUN ÇALIŞIYOR");
  if (s.busy) {
    if (
      s.status.startsWith("Minecraft başlatılıyor") ||
      s.status === "Profil ayarları yedeklendi."
    )
      return msg("BAŞLATILIYOR");
    if (
      s.status.startsWith("Kütüphaneler:") ||
      s.status.startsWith("Oyun kaynakları:") ||
      (s.status.startsWith("Minecraft ") && s.status.includes("indiriliyor"))
    )
      return msg("İNDİRİLİYOR");
    return msg("HAZIRLANIYOR");
  }
  if (!s.accounts.some((a) => a.id === s.selected_account)) return msg("HESAP EKLE");
  if (!s.quick_profile && !s.profiles.some((p) => p.id === s.selected_profile))
    return msg("PROFİL OLUŞTUR");
  return msg("OYUNA GİR");
}
