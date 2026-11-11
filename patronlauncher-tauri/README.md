# PatronLauncher
Independent Tauri 2 + React + Vite + TypeScript project. React screens use the validated Rust commands and live state/progress events. No production mock records or simulated launch timers remain.

The supplied HTML is preserved in reference/patronlauncher-prototype.html. Its CSS declarations and animation timings are unchanged in src/styles/prototype.css; its original :root variables are in variables.css. Layout corrections and native control/form sizing are isolated in integration.css; prototype palette and animation declarations are unchanged. Native chrome uses a separate window.css; browser previews have no native titlebar.

Commands:
- npm ci
- npm run dev (browser preview: http://127.0.0.1:1420)
- npm run desktop:dev (frameless native window)
- npm run build (typecheck and frontend build)
- npm run desktop:build (native executable)
- cargo test --manifest-path src-tauri/Cargo.toml

Capabilities permit the explicitly listed launcher commands, state-event subscriptions, and local window minimize, maximize/restore, close and drag. No filesystem, shell or remote-origin permissions.

`./Start-Tauri.ps1` uses the existing local Rust toolchain, when present. `npm run desktop:preview` builds an embedded, standalone debug preview without an installer. `npm test` runs CSS parity, layout, IPC-flow and titlebar routing browser checks.

Validation: `npm test` checks unchanged prototype CSS, responsive folder layout, command/event flows and window-command routing. `npm run test:native` launches its own release preview with a temporary localhost WebView2 debugging port, tests real window controls and closes only that process. It does not connect to your launcher or game data.

## Rust core migration

`src-tauri/src/core/app.rs` holds the extracted business state machine. It has no Tauri imports. `core/mod.rs` serializes commands on an actor thread, keeps the existing mpsc worker event flow and hands typed notifications to the Tauri adapter in `main.rs`. Tauri commands never accept raw account/profile objects, arbitrary download URLs, a caller-selected data root or generic shell/filesystem operations.

The default data root is `%APPDATA%\PatronLauncher` (the existing `PATRONLAUNCHER_DATA_DIR` development override remains). `settings.json`, `settings.json.bak`, `instances/<UUID>`, backups, shared Minecraft files, runtimes and `launcher.lock` are unchanged. `auth.rs` uses `PatronLauncher.Microsoft` with the account UUID as the keyring entry. Tokens are not serialized in command responses or events. Settings are loaded without rewriting them. Corrupt state or a held lock prevents mutation; the current status and `load_failed` explain why.

`src/types/core.ts` documents every command argument, response and event payload. All commands return `{state, news}`; most return `news: null`. Long operations return an accepted `busy`/`news_loading` snapshot, then report completion/failure through `patronlauncher://core-event` and `patronlauncher://state`. Events keep the original Status, Versions, Account, Finished, JavaChecked, JavaInstalled and News variants (snake_case over IPC). Numeric download counts are exposed as optional progress. `get_state` recovers state if an event was missed. Profile backup/restore operates on the selected profile; restore requires `confirmed: true`. Account/profile removal changes saved lists and credentials as before; profile worlds stay on disk. Cancellation preserves the existing semantics: it stops preparation/auth/download/install work cooperatively, and does not terminate a running Minecraft JVM.

`--install-java <major>` and `--smoke-launch <version>` run before initializing Tauri and share the same lock. CLI argument validation can fail without creating a webview or touching saved data.

The local main window has an explicit app-command permission, event listen/unlisten and the four window controls. There is no shell/fs plugin. Production CSP disallows remote scripts and connections; the development policy additionally allows only the loopback Vite server. Navigation stays on the local application origin, new webview windows are denied, and approved external HTTPS domains must go through `open_external`. A custom Java executable path is validated on settings updates; existing saved values are read unchanged. Hash, archive-path and backup validation in the copied modules remains intact.

News: decoded 640×360 PNG thumbnails cross IPC as data URLs. No image widget handles or game/session tokens reach the frontend. Discord presence starts with the saved/default application ID only when the core owns its lock.

Validation commands:
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`
- `npm run desktop:build` (frontend production build + Rust release build)
- `npm run test:core-native` (real release IPC against temporary legacy-format data, event delivery, settings/account commands, input rejection, second-process lock and headless CLI validation)

No test logs into Microsoft or downloads/runs Java/Minecraft against real user data. Business tests live in `core/app.rs`.

For an embedded standalone binary from Cargo directly, use `cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml --locked`. The Tauri CLI sets this feature during `npm run desktop:build`. A plain Cargo build without that feature is useful for checking the Rust shell, but it uses the development URL.



## Sürümler kataloğu

Sidebar'daki Sürümler, Mojang manifest önbelleğinin tamamını `list_version_catalog`
komutuyla arka plan işçisinde okur. Ön bellek yoksa mevcut `game::versions` indirme
ve geri dönüş yolunu kullanır. Hesap/profil formatı, başlatılabilir sürüm filtresi
ve indirme doğrulamaları değişmez. Modern kararlı sürümler için mevcut
`create_profile` komutu kullanılır; başarılı kayıt Ana sayfa'ya yönlendirir.
Snapshot ve alpha/beta sürümleri incelenebilir; mevcut çekirdeğin desteklemediği
sürümler için profil oluşturma kapalıdır ve nedeni panelde gösterilir.

Aile kuralı yalnızca `src/versions.ts` içindeki `versionFamily` fonksiyonundadır.
Haftalık snapshot adlarında hedef sürüm bilgisi bulunmadığı için bu sürümler
Snapshot ailesinde toplanır; hedef yama tahmin edilmez. Popüler sıralaması önerilen
bir aile sırasıdır, oyuncu kullanım istatistiği değildir.

Kapak manifesti `src/assets/versions/versions-art.json`; 480×640 WebP dosyalarını
aynı klasöre, manifestteki adlarıyla ekleyip yeniden derleyin. Eksik/bozuk kapak
büyük aile numarası ve deterministik gradient ile gösterilir. Görsel dosyaları
HTML/JS içine gömülmez; özetli yerel URL'ler, lazy loading ve tarayıcı önbelleği
kullanılır. Kartların boyutunu 3:4 çerçeve belirler, görselin doğal boyutu değil.

Kurulu rozeti ortak versions klasöründeki sürüm JAR'ı ve JSON'unun varlığına
bakar; tam kurulum veya bütünlük doğrulaması iddiası değildir. Tüm gerekli dosyalar
oyun başlatma akışında mevcut yöntemle kontrol edilir. Boyut aralığı tahminidir;
Java ve kullanıcı dünyalarını kapsamaz.

## Fabric çekirdeği

Profiller `loader: "Vanilla" | "Fabric"` ve `loader_version: string | null`
alanlarını taşır. Alanları olmayan eski settings/metadata kayıtları Vanilla
olarak okunur; null/None da Vanilla kabul edilir. Dosya konumları değişmez.

- `list_loader_versions({ minecraftVersion: "1.21.11" })` →
  `{ versions: [{ version, stable }], default_version }`.
- `set_profile_loader({ id, loader: "Fabric", loaderVersion: null })` en yeni
  kararlı sürümü çözüp profile sabitler. Belirli sürüm için loaderVersion verilir.
- `set_profile_loader({ id, loader: "Vanilla", loaderVersion: null })` loader'ı
  kaldırır. Dünyalar, mods ve oyun ayarları silinmez.

Uyumluluk Fabric Meta'nın Minecraft sürümüne ait loader listesinden doğrulanır.
Ağ işlemleri arka plandadır; profil sürümü/busy durumu kayıt öncesi yeniden kontrol
edilir. MainClass, JVM/oyun argümanları ve ek Maven kütüphaneleri birleştirilir;
aynı group/artifact/classifier için Fabric sürümü önceliklidir. Vanilla'nın client
JAR'ı, assetIndex'i, native akışı ve javaVersion gereksinimi korunur. Fabric kendi
profil klasörünün mods dizinini ve oyun çalışma klasörünü kullanır. Fabric API veya
başka modlar otomatik indirilmez.

Fabric istekleri yalnızca HTTPS meta.fabricmc.net / maven.fabricmc.net adreslerine
ve bunlar arasındaki sınırlı yönlendirmelere izin verir. Maven yolu koordinattan
üretilir, safe_join ile kontrol edilir. Tüm Fabric JAR'ları net::download ile SHA-1
kontrolünden geçer. Profil JSON'unda SHA-1 yoksa aynı Maven kaynağının .sha1 yan
dosyası alınır; eksik/bozuk özetle indirme kabul edilmez. Mevcut zip-slip koruması
korunur. Doğrulanan loader metadata'sı minecraft/fabric altında önbelleğe alınır.

Başlatma testi (mevcut profil/hesap listesini değiştirmeyen geçici test profili):

`PatronLauncher.exe --smoke-launch 1.21.11 --fabric`

Belirli loader için sona sürüm ekleyin: `--fabric 0.18.4`. Vanilla için eski
`--smoke-launch 1.21.11` ve `--install-java` kullanımları değişmedi. CLI aynı veri
kilidini kullanır ve gerekli Java kurulu olmalıdır. İzole test için
PATRONLAUNCHER_DATA_DIR ayrı bir klasöre ayarlanabilir.

Ağlı kütüphane testi ayrıca çalıştırılabilir (Minecraft/JVM çalıştırmaz):
`cargo test --manifest-path src-tauri/Cargo.toml --locked fabric_live_metadata_and_checked_libraries -- --ignored --nocapture`

Resmî API tanımı: https://github.com/FabricMC/fabric-meta#v2


## Onaylı performans paketi

Sürümler sağ paneli Vanilla/Fabric seçimi ve uyumlu loader sürümlerini kullanır.
Fabric için en yeni kararlı loader varsayılandır. API hatası veya desteklenmeyen
sürümde gerekçe gösterilir ve Fabric seçimi kapatılır; Vanilla seçeneği korunur.
OptiFine/CurseForge butonları yalnızca doğrulanmış resmî siteyi açar.

Performans anahtarı Sodium, Lithium, FerriteCore ve gerekli Modrinth
bağımlılıkları için metadata planı üretir. Seçilen Minecraft sürümü ve Fabric
etiketi tekrar doğrulanır. Uyumsuz/missing required bağımlılıklar ve sabit sürüm
çakışmaları hata verir; optional bağımlılıklar indirilmez. Uyumlu kararlı kök
mod bulunamazsa nedeni onay listesinde gösterilir. Kaynak modrinth API ve tüm
isteklerde PatronLauncher User-Agent'idir.

`preview_performance_pack({ minecraftVersion })` yalnızca metadata alır; JAR
indirmez. Dönen liste, toplam boyut ve uyarılar kullanıcıya native dialog ile
sunulur. Plan Rust belleğinde tutulur, 15 dakika geçerlidir ve tek kullanımlıktır.
`create_configured_profile({name, versionId, loader, loaderVersion, planId,
confirmed})`, paket varsa açık onay ve sürüm eşleşmesi ister. Tarayıcıdan URL,
dosya yolu veya mod listesi kabul edilmez. Plan olmadan Fabric profili oluşturmak
için `planId:null, confirmed:false` kullanılır.

Onaydan sonra worker thread dosyaları geçici staging klasörüne indirir. Sadece
HTTPS cdn.modrinth.com ve aynı host içindeki sınırlı yönlendirmeler kabul edilir.
SHA-1 ve/veya SHA-512, dosya boyutu ve Windows dosya adı kontrolleri uygulanır.
Byte ilerlemesi mevcut core-event kanalıyla en fazla yaklaşık 10 Hz bildirilir.
Doğrulamalar bitince klasör taşınır, profil/loader ayarları kaydedilir ve Ana
sayfa açılır. İptal/hata durumunda yeni profil yayınlanmaz; mevcut profiller ve
dünyalar değişmez. İndirilen dosyaların listesi `.patronlauncher-mods.json` içinde de
saklanır. Minecraft/Java veya Fabric API, yalnızca bu performans seçeneği nedeniyle
ayrıca indirilmez; Fabric API ancak zorunlu mod bağımlılığı olarak listede yer
alırsa onay kapsamına girer.

Doğrulama: `cargo test --locked` birim testleri consent/version binding, required
bağımlılıklar, çakışma, unsafe yol/URL, SHA-512 ve iptal geri almayı kapsar.
`cargo test --locked modrinth_live_plan_and_verified_download -- --ignored --nocapture`
resmî API/CDN'den geçici klasöre gerçek paketi indirip doğrular. `npm test` onaydan
önce indirme komutu verilmemesini ve ilerleme olaylarını; `npm run test:core-native`
geçici legacy verilerle gerçek masaüstü onay/indirme/kayıt akışını kontrol eder.


## İlk açılışta veri ve kimlik bilgisi göçü

Yeni varsayılan veri klasörü `%APPDATA%\PatronLauncher`, Credential Manager servis
adı `PatronLauncher.Microsoft` ve geliştirme ortam değişkeni
`PATRONLAUNCHER_DATA_DIR` şeklindedir. Eski tanımlayıcılar yalnızca
`src-tauri/src/migration.rs` uyumluluk sabitlerinde tutulur. Eski klasör ve eski kimlik
bilgileri üretim göçü sırasında hiçbir zaman silinmez.

Eski kaynak kilitliyken göç yapılmaz. Dosyalar ayrı staging klasörüne kopyalanır;
kaynak/staging SHA-256 ağaçları ve kaynak tekrar doğrulanır. Bağlantı/reparse point,
hedef çakışması veya kimlik bilgisi yazma/doğrulama hatasında yeni veri klasörü
başarılı sayılmaz. Kimlik bilgileri yalnızca kayıtlı Microsoft hesap UUID'leri
üzerinden kopyalanır ve yeni kayıt geri okunarak doğrulanır. Daha yeni bir hedef
kimlik bilgisi varsa ezilmez. Başarılı göç için `.patronlauncher-migration-v1.json`
kaydı yazılır; sonraki açılışlar eski klasörü tekrar kopyalamaz.

Eski profil metadata ve ZIP yedek başlıkları okunmaya devam eder; yeni kayıtlar
PatronLauncher adlarını kullanır. Geliştirme/test veri klasörü açıkça verilmişse
kişisel varsayılan veri klasöründen otomatik içe aktarma yapılmaz.

`npm run test:migration-native` geçici APPDATA kullanarak ilk açılışı ve veri
kimliklerinin/ham dosyaların korunmasını sınar. Credential Manager testi gerçek
kasada yalnızca rastgele kimlikli sentetik test kayıtları kullanır:
`cargo test --manifest-path src-tauri/Cargo.toml --locked windows_credential_copy_is_verified_and_keeps_original -- --ignored`

Logo dosyaları değiştirilmedi. Discord uygulama kimliği korundu; Discord'daki
uygulama başlığı dış hizmetteki Developer Portal kaydından yönetilir. Presence
ayrıntısı yeni marka adını kullanır.

## Sunucu listesi

Ana sayfanın sağındaki liste sırasıyla şu kaynaklardan okunur: `src-tauri/src/servers.rs`
içindeki `REMOTE_URL` (boşsa atlanır) → `%APPDATA%\PatronLauncher\servers-cache.json`
→ derlemeye gömülü `src-tauri/servers.json`. Uzak listeyi kendin barındırmak için
`servers.json` biçimindeki dosyayı örneğin GitHub'a yükle ve ham (raw) HTTPS adresini
`REMOTE_URL` sabitine yaz; sonraki açılışlarda yeni build gerekmeden güncellenir.

```json
{"version": 1, "servers": [{
  "id": "ornek", "name": "Örnek Ağ", "address": "play.ornek.net", "port": null,
  "region": "tr", "languages": ["tr"], "tags": ["SMP", "SkyBlock"],
  "description": {"tr": "Kısa açıklama", "en": "Short description"},
  "versions": "1.20–26.3", "website": "https://ornek.net/", "discord": null,
  "sponsored": false, "featured": false
}]}
```

`region`: tr, eu, na, sa, asia, oce, global. `sponsored: true` sunucuyu en üstte
SPONSOR rozetiyle gösterir. Geçersiz kayıtlar (adres, bölge, http bağlantı vb.) sessizce
atlanır. Oyuncu sayısı ve MOTD, Minecraft Server List Ping ile canlı alınır (SRV kaydı
desteklenir). "Katıl" düğmesi seçili oyunu açar ve 1.20+ sürümlerde Quick Play, eskilerde
`--server/--port` ile sunucuya bağlanır; adres yalnızca doğrulanmış listeden alınır.

## Yükleyiciler

Vanilla, Fabric, Quilt, NeoForge, Forge ve OptiFine `src-tauri/src/loaders.rs` üzerinden kurulur.
Fabric/Quilt profil JSON'ları resmî Meta servislerinden okunur. NeoForge/Forge için resmî Maven'deki
kurulum programı SHA-1 ile doğrulanarak indirilir; istemci tarafı işlemcileri (binary patch vb.)
oyunun Java sürümüyle çalıştırılır ve çıktılar varsa özetleriyle denetlenir. OptiFine'ın resmî
API'si olmadığından sürümler ve dosyalar BMCLAPI aynasından (bmclapi2.bangbang93.com) alınır;
aynanın özet bilgisi yoktur, bu yüzden dosyanın yapısı denetlenir ve SHA-1'i kaydedilir.

Komut satırı testleri (ağ ve Java gerektirir, `PATRONLAUNCHER_DATA_DIR` ile izole çalıştırın):
`--smoke-install <Minecraft> <fabric|quilt|neoforge|forge|optifine> [sürüm]` yalnızca kurar,
`--smoke-loader ...` aynı profille oyunu başlatır.

## Müzik çalar ve Spotify

- Launcher müzikleri `src/assets/music/` içindedir ve uygulamaya gömülür. Yeni parça eklemek için dosyayı bu klasöre koyup `src/music.ts` içindeki `tracks` listesine ekleyin.
- Spotify bağlantısı PKCE ile yapılır; **istemci sırrı (Client Secret) kullanılmaz ve uygulamaya gömülmez.** Client ID `src-tauri/src/spotify.rs` içinde varsayılan olarak durur; derleme sırasında `PATRONLAUNCHER_SPOTIFY_CLIENT_ID` ortam değişkeniyle değiştirilebilir.
- Spotify Developer Dashboard'da uygulamanın **Redirect URIs** listesine tam olarak `http://127.0.0.1:43821/callback` eklenmelidir. Uygulama "Development mode"dayken yalnızca dashboard'da *User Management* altına eklenen hesaplar bağlanabilir.
- Çalan şarkı herkes için görünür; oynat/duraklat/atla/ses kontrolü Spotify Premium gerektirir. Yenileme anahtarı Windows Kimlik Bilgisi Yöneticisi'nde (`PatronLauncher.Spotify`) saklanır.
