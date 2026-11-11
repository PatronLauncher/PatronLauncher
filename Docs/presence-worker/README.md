# PClient varlık servisi

TAB ve sohbetteki PClient rozetinin başka oyuncularda görünmesi için gereken küçük servis.
Oyun her 30 saniyede kendi UUID'sini ve sunucudaki oyuncuların UUID'lerini gönderir; servis
PClient kullananları döner. Sunucu adresi ve kullanıcı adı gönderilmez, hiçbir şey diske yazılmaz.

## Yayınlama

1. Ücretsiz bir Cloudflare hesabı aç.
2. Bu klasörde `npx wrangler login`, ardından `npx wrangler deploy` çalıştır.
3. Verilen `https://...workers.dev` adresini
   `patronlauncher-tauri/src-tauri/resources/pclient/support.json` içindeki `presence` alanına yaz.
4. `./build.ps1` ile yeniden derle.

Adres boşken oyun hiçbir istek yapmaz ve rozeti yalnızca oyuncu kendinde görür.

Bir oyuncu başkasının UUID'siyle bildirim yapabilir. Rozet yalnızca görsel olduğu için bu kabul
edilmiştir; rozete yetki bağlanacaksa önce kimlik doğrulaması eklenmelidir.
