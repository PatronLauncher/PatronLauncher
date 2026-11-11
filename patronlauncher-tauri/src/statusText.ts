// Çekirdek durum mesajlarını Türkçe üretir. Burada bilinen kalıplar eşleştirilip seçili dile
// çevrilir; tanınmayan mesaj (ör. ham hata metni) olduğu gibi gösterilir.
import { msg, t } from "./i18n";

// Sıra önemlidir: daha özel kalıp, onu kapsayan genel kalıptan önce gelir.
const templates = [
  msg("Ayarlar kaydedildi."),
  msg("Bu yerel hesap zaten var."),
  msg("Yerel hesap eklendi."),
  msg("Microsoft hesabı eklendi."),
  msg("Microsoft giriş sayfası açılıyor…"),
  msg("Microsoft giriş sayfası tarayıcıda açıldı. Girişi orada tamamla."),
  msg("Microsoft girişi bu derlemede henüz etkin değil: PatronLauncher uygulama kimliği eksik."),
  msg("Minecraft hesabı doğrulanıyor…"),
  msg("Giriş iptal edildi."),
  msg("Oturum hazırlanıyor…"),
  msg("Oturum kaldırılamadı: {error}"),
  msg("Oyun hazırlanıyor… İlk indirme biraz zaman alabilir."),
  msg("Kütüphaneler: {done} / {total}"),
  msg("Oyun kaynakları: {done} / {total}"),
  msg("Modlar: {done} / {total}"),
  msg("Profil ayarları yedeklendi."),
  msg("Profil ayarları yedeklendi. Son 10 farklı ayar yedeği saklanır."),
  msg("Minecraft başlatılıyor…"),
  msg("Minecraft çalışıyor · işlem {pid}"),
  msg("Minecraft açıldı. İyi oyunlar!"),
  msg("Oyun kapandı. Yeniden oynamaya hazır."),
  msg("İptal isteniyor; devam eden indirme tamamlanınca duracak."),
  msg("Java arşivi doğrulandı; kurulum hazırlanıyor…"),
  msg("Java {major} zaten PatronLauncher içinde kurulu."),
  msg("Mod işlemi başlatıldı…"),
  msg("Mod indiriliyor: {name}"),
  msg("CurseForge'dan indiriliyor: {name}"),
  msg("OptiFine istemciye uygulanıyor…"),
  msg("PClient {version} kuruldu. Oyuna Gir ile hemen başlayabilirsin."),
  msg("Profil dosyaları indirildi ve doğrulandı."),
  msg("Profil dosyaları kopyalanıyor…"),
  msg("Profil indiriliyor ve doğrulanıyor…"),
  msg("Profil ve yükleyici hazırlanıyor…"),
  msg("Profil yeniden adlandırıldı."),
  msg("Profil yükleyicisi güncellendi."),
  msg("Sürüm listesi ve profil klasörleri hazır. Seçimleriniz korundu."),
  msg("Sürüm listesi yenileniyor…"),
  msg("Sürüm ortak depoya indiriliyor…"),
  msg("Önce bir hesap ekleyip seçin."),
  msg("Önce bir hesap ve oyun profili oluşturup seçin."),
  msg("Önce bir sürüm seçin."),
  msg("Önce bir Minecraft sürümü seçin."),
  msg("Bir sürüm seçin."),
  msg("Bir oyun profili seçin."),
  msg("Kaydedilemedi: {error}"),
  msg("Klasör açılamadı: {error}"),
  msg("Klasör açıldı: {path}"),
  msg("{name} hazırlanıyor: adım {step} / {total}"),
  msg("{name} kütüphaneleri: {done} / {total}"),
  msg("{name} kütüphaneleri indiriliyor…"),
  msg("{name} kurulum programı indiriliyor…"),
  msg("{name} hazırlanıyor…"),
  msg("{name} indiriliyor…"),
];

const patterns = templates.map((template) => {
  const names: string[] = [];
  const source = template
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return "(.+?)";
    });
  return { template, names, regex: new RegExp(`^${source}$`, "s") };
});

/** Çekirdekten gelen durum satırını seçili dilde döndürür. */
export function statusText(status: string | undefined | null): string {
  if (!status) return "";
  for (const { template, names, regex } of patterns) {
    const match = regex.exec(status);
    if (match) return t(template, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return status;
}
