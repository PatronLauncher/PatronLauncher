# PatronLauncher çalışma kuralları

- İşlev kodlarına (oyun başlatma, hesap, indirme, profil, ayar kaydetme) dokunma.
- Tek uygulama `patronlauncher-tauri/` altındaki Tauri 2 + React projesidir (Rust çekirdek `src-tauri/`). Eski Iced projesi kaldırıldı; geri getirme.
- Her görev sonunda proje kökünden `./build.ps1` çalıştır. Script sırasıyla `npm run build`, `cargo test --locked` ve `cargo build --release --locked` (`src-tauri/Cargo.toml`) çalıştırır. Hata olursa dağıtımı güncellemeden durur.
- Başarılı build çıktısı `dist/PatronLauncher-latest.exe` yoluna yerleştirilir; bu dosya her zaman en son başarılı build ile üzerine yazılır.
- Aynı çıktı `dist/archive/PatronLauncher-<sürüm>-<yyyy-MM-dd-HHmm>.exe` olarak arşivlenir. Tarih/saat Europe/Istanbul'a göredir. Aynı dakika ve sürüm için yeniden build alınırsa aynı arşiv dosyası güncellenir.
- Arşivde son 5 build kalsın; fazlası yalnızca `dist/archive` içinden silinsin. Proje kökündeki veya diğer klasörlerdeki önceki EXE dosyalarını silme.
- Son yanıtın son satırında yalnızca `Son sürüm: <tam yol>` yaz. Başarısız build için başarı veya güncel çıktı iddiasında bulunma.
- Değişen dosyaların tam halini yazdırma ve ZIP üretme; değişiklikleri doğrudan projeye uygula.

