import { msg } from "./i18n";
export type Page =
  | "home"
  | "versions"
  | "mods"
  | "profiles"
  | "account"
  | "folder"
  | "activity"
  | "settings"
  /** Yalnızca PClient arayüzünde: oyun içi modül vitrini. */
  | "modules"
  /** Yalnızca PClient arayüzünde: sunucu listesi. */
  | "servers"
  /** Yalnızca PClient arayüzünde: PClient'ın Minecraft sürümleri. */
  | "editions";
export const items: [Page, string][] = [
  ["home", msg("Ana sayfa")],
  ["versions", msg("Sürümler")],
  ["mods", msg("Keşfet")],
  ["profiles", msg("Profiller")],
  ["account", msg("Hesaplar")],
  ["folder", msg("Oyun dosyaları")],
];
export const items2: [Page, string][] = [
  ["activity", msg("İşlem geçmişi")],
  ["settings", msg("Ayarlar")],
];
export const titles: Record<Page, [string, string]> = {
  home: [msg("Ana sayfa"), msg("Minecraft, sana ait bir alanda.")],
  mods: [msg("Keşfet"), msg("Modrinth ve CurseForge içeriklerini keşfet, tek tıkla kur.")],
  versions: [msg("Sürümler"), msg("Bir sürüm ailesi seç, kendi maceranı oluştur.")],
  profiles: [msg("Oyun profilleri"), msg("Her dünyaya ayrı bir başlangıç.")],
  account: [msg("Hesapların"), msg("Oyuncunu seç, macerana devam et.")],
  folder: [msg("Oyun dosyaları"), msg("Dünyaların, paketlerin ve ayarların bir arada.")],
  activity: [msg("İşlem geçmişi"), msg("Bu oturumda olan biten her şey.")],
  settings: [msg("Launcher ayarları"), msg("Deneyimini sana göre düzenle.")],
  modules: [msg("Modüller"), msg("PClient'ın oyun içi modülleri.")],
  servers: [msg("Sunucular"), msg("Bir sunucu seç, PClient ile doğrudan bağlan.")],
  editions: [msg("PClient sürümleri"), msg("PClient'ı oynamak istediğin Minecraft sürümüyle kur.")],
};
