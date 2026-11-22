# PatronLauncher

Windows için Rust tabanlı Minecraft Java Edition launcher'ı. Uygulama
`patronlauncher-tauri/` altındadır: Tauri 2 + React + Vite + TypeScript arayüzü ve
`src-tauri/` içindeki Rust çekirdeği. Ayrıntılar için
[patronlauncher-tauri/README.md](patronlauncher-tauri/README.md).

## Sürümler / Versions

Bu depoda iki ayrı ürün vardır ve **sürüm numaraları birbirinden bağımsızdır**:

| Ürün | Ne | Güncel sürüm | Nerede görünür |
| --- | --- | --- | --- |
| **PatronLauncher** | Windows launcher'ı (`patronlauncher-tauri/`) | 1.0.3 | Launcher ayarları, kurulum dosyası adı |
| **PClient** | Oyun içi istemci, Fabric modu (`pclient-fabric/`) | 1.1.0 (Minecraft 26.3) | Oyun içi ana menü ve PClient ayarları |

- PClient ayrı indirilmez; PatronLauncher'ın içinde gelir ve launcher güncellenince o da güncellenir.
- Bu yüzden GitHub'daki her sürüm bir **PatronLauncher** sürümü olarak yayımlanır (ör. `v1.0.3`).
  Sürüm notlarında iki ayrı başlık bulunur: *PatronLauncher* değişiklikleri ve o sürümle gelen
  *PClient x.y.z* değişiklikleri. PClient o sürümde değişmediyse bu belirtilir.
- PClient yalnızca kendi kodu değiştiğinde yeni sürüm numarası alır; launcher güncellemesi tek başına
  PClient sürümünü değiştirmez.

There are two products in this repository with **independent version numbers**: the
**PatronLauncher** Windows launcher and the **PClient** in-game client (a Fabric mod). PClient ships
inside the launcher, so every GitHub release is a PatronLauncher release (e.g. `v1.0.3`); its notes have
a separate *PClient* section that names the bundled PClient version and lists its own changes.

| PatronLauncher | PClient bundled |
| --- | --- |
| 1.0.0 – 1.0.2 | 1.0.0 (before separate versioning) |
| 1.0.3 | 1.1.0 |

## Derleme

Proje kökünden `./build.ps1` çalıştırın. Script arayüzü derler, Rust testlerini
çalıştırır, release EXE'yi üretir ve:

- `dist/PatronLauncher-latest.exe` dosyasını en son başarılı build ile günceller,
- `dist/archive/PatronLauncher-<sürüm>-<yyyy-MM-dd-HHmm>.exe` olarak arşivler
  (Europe/Istanbul saati, son 5 build tutulur),
- oyunculara dağıtılacak kurulum sihirbazını `dist/PatronLauncher-<sürüm>-setup.exe` olarak
  üretir (NSIS, kullanıcı başına kurulum, yönetici izni gerekmez).

Rust araçları `.tools/` altındaki yerel kurulumdan kullanılır; genel PATH değişmez.

PClient (oyun içi istemci, `pclient-fabric/`) Gradle 9.8+ ve JDK 25 varsa derlemede yeniden
üretilip launcher'a gömülür; yoksa `src-tauri/resources/pclient/PClient.jar` kullanılır.

### Derlemeye gömülen bilgiler

Depoya girmeyen `.secrets/` klasöründen okunur; dosya yoksa ilgili özellik kapalı kalır:

| Dosya | Ne için |
| --- | --- |
| `.secrets/microsoft-client-id` | Microsoft girişi için Azure uygulama kimliği (GUID). |
| `.secrets/curseforge.key` | CurseForge içerik araması için API anahtarı. |
| `.secrets/contact` | Modrinth'e gönderilen User-Agent iletişim bilgisi. |

Microsoft girişi için Azure'da "Mobile and desktop applications" platformlu, yönlendirme adresi
`http://localhost` olan, kişisel Microsoft hesaplarına açık bir uygulama kaydı gerekir. Minecraft
API erişimi için uygulama kimliği Mojang'a ayrıca onaylatılmalıdır.

## Veriler

1.0 sürümünde tüm ayarlar, profiller, yedekler ve hesaplar oyuncunun kendi bilgisayarında
(`%APPDATA%\#PatronLauncher`) tutulur; PatronLauncher sunucusu yoktur. Microsoft oturumları
Windows Kimlik Bilgisi Yöneticisi'nde saklanır.

## Lisans

Kaynak kod [GNU AGPL v3.0](LICENSE) ile lisanslanmıştır. Logolar, sürüm kapakları ve müzikler
AGPL kapsamında değildir; ayrıntılar ve "resmi değildir" bildirimi için [NOTICE.md](NOTICE.md).

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
