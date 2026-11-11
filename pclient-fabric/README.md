# PClient (Fabric)

PatronLauncher'ın oyun içi istemcisi. Minecraft **26.3** için Fabric modu; yalnızca Fabric Loader gerektirir (Fabric API'ye bağımlı değil), tek jar olarak çalışır.

## Derleme

Gereken: JDK 25 ve Gradle 9.8 veya üstü (Loom 1.19 bunu ister).

```powershell
cd pclient-fabric
gradle build          # çıktı: build/libs/PClient-<sürüm>.jar
gradle runClient      # geliştirme istemcisi (run/ klasörü)
gradle runClient -Pdevshots=<klasör>   # ekranları sırayla açıp görüntü alır, sonra kapanır
```

## Yapı

- `module/`: modül sistemi (`Module`, `HudModule`) ve ayar türleri (aç/kapa, kaydırıcı, renk, seçenek, tuş).
- `modules/`: çalışan modüller (HUD, performans, sohbet, görsel ayarlar, kamera) ve "Yakında" kartları. Modül kapalıyken kare ve tik başına iş yapılmaz: `ModuleManager` yalnızca etkin modülleri dolaşır; dünyayı okuyan HUD öğeleri değerlerini tikte günceller.
- `gui/`: PClient menüleri. Ana menü (Sağ Shift), modül listesi, modül ayarları, HUD düzenleyici, "Yakında" sayfaları.
- `mixin/`: oyuna bağlanma noktaları (tuş, fare, HUD çizimi, görüş alanı, ışık haritası, tik).
- `config/`: `config/pclient.json` okuma/yazma. Bozuk dosya yedeklenip varsayılanlarla devam edilir.

Dil dosyaları `assets/pclient/lang` altında (`tr_tr`, `en_us`).

## Launcher köprüsü

Oyun içi hesap menüsü ve Spotify, launcher'ın `pclient_bridge.rs` kanalını kullanır (`bridge/` paketi). Launcher yalnızca 127.0.0.1'de dinler ve her açılışta oyun klasörüne `pclient/bridge.json` (port ve parola) yazar. Microsoft ve Spotify yenileme anahtarları launcher'dan çıkmaz; launcher kapalıysa bu iki özellik uyarı gösterir, oyunun geri kalanı çalışır.

## İsteğe bağlı performans modları

Oyuncu onay verirse launcher şu açık kaynak modları Minecraft sürümüne özel olarak doğrudan Modrinth'ten indirir (SHA-512 doğrulamalı); bunlar PClient jar'ına gömülmez: [Sodium](https://modrinth.com/mod/sodium), [Lithium](https://modrinth.com/mod/lithium), [FerriteCore](https://modrinth.com/mod/ferrite-core), [ImmediatelyFast](https://modrinth.com/mod/immediatelyfast), [Krypton](https://modrinth.com/mod/krypton), [BadOptimizations](https://modrinth.com/mod/badoptimizations).

## Sunucu uyumu

Tüm modüller yalnızca istemci tarafında çalışır ve sunucuya vanilla dışında paket göndermez. Haksız avantaj sağlayan özellik (otomatik tıklama, ışınlanma, otomatik inşa vb.) eklenmez. Yapı Atölyesi'nde otomatik inşa yalnızca tek oyunculu dünyalarda ve izin veren sunucularda açılacak.
