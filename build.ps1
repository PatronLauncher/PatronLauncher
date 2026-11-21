$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$appRoot = Join-Path $projectRoot 'patronlauncher-tauri'
$manifestPath = Join-Path $appRoot 'src-tauri/Cargo.toml'
# PowerShell 5.1, yönlendirilmiş stderr satırlarını hata kaydına çevirir; native
# araçların başarısı yalnızca çıkış koduyla değerlendirilir.
function Invoke-Native([string]$Command, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    & $Command @Arguments 2>&1 | ForEach-Object { "$_" }
}
Push-Location -LiteralPath $appRoot
try {
    $localCargo = Join-Path $projectRoot '.tools/cargo/bin/cargo.exe'
    if (Test-Path -LiteralPath $localCargo -PathType Leaf) {
        $env:CARGO_HOME = Join-Path $projectRoot '.tools/cargo'
        $env:RUSTUP_HOME = Join-Path $projectRoot '.tools/rustup'
        $env:PATH = "$(Split-Path -Parent $localCargo);$env:PATH"
    }
    # CurseForge anahtarı git dışındaki dosyadan derlemeye gömülür; dosya yoksa atlanır.
    $curseForgeKey = Join-Path $projectRoot '.secrets/curseforge.key'
    if (Test-Path -LiteralPath $curseForgeKey -PathType Leaf) {
        $env:PATRONLAUNCHER_CURSEFORGE_KEY = (Get-Content -LiteralPath $curseForgeKey -Raw).Trim()
    }
    # Modrinth'e gönderilen User-Agent iletişim bilgisi; kaynak kodda kişisel adres tutulmaz.
    $contact = Join-Path $projectRoot '.secrets/contact'
    if (Test-Path -LiteralPath $contact -PathType Leaf) {
        $env:PATRONLAUNCHER_CONTACT = (Get-Content -LiteralPath $contact -Raw).Trim()
    }
    # Microsoft (Azure) uygulama kimliği; yoksa Microsoft girişi "etkin değil" mesajı verir.
    $microsoftId = Join-Path $projectRoot '.secrets/microsoft-client-id'
    if (Test-Path -LiteralPath $microsoftId -PathType Leaf) {
        $env:PATRON_MICROSOFT_CLIENT_ID = (Get-Content -LiteralPath $microsoftId -Raw).Trim()
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Rust/Cargo bulunamadı.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Node.js/npm bulunamadı.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules') -PathType Container)) {
        Invoke-Native 'npm.cmd' @('ci')
        if ($LASTEXITCODE -ne 0) { throw "npm ci başarısız: $LASTEXITCODE" }
    }
    # PClient (Fabric modu) launcher'a gömülür. Gradle 9.8+ ve JDK 25 varsa mod yeniden
    # derlenip kopyalanır; yoksa son derlenmiş jar (src-tauri/resources/pclient) kullanılır.
    $pclientRoot = Join-Path $projectRoot 'pclient-fabric'
    $pclientJar = Join-Path $appRoot 'src-tauri/resources/pclient/PClient.jar'
    $gradle = @($env:PATRON_GRADLE, (Join-Path $env:LOCALAPPDATA 'PatronDev/gradle/gradle-9.8.2/bin/gradle.bat')) |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    $jdk = 'C:\Program Files\Java\jdk-25.0.4'
    if ((Test-Path -LiteralPath $pclientRoot -PathType Container) -and $gradle) {
        # JAVA_HOME geçerli bir JDK'yı göstermiyorsa (ör. sonu \bin) yalnızca bu işlem için düzeltilir.
        $validHome = $env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/javac.exe') -PathType Leaf)
        if (-not $validHome -and (Test-Path -LiteralPath $jdk -PathType Container)) { $env:JAVA_HOME = $jdk }
        Push-Location -LiteralPath $pclientRoot
        try {
            Invoke-Native $gradle @('build', '--console=plain', '-q')
            if ($LASTEXITCODE -ne 0) { throw "PClient derlemesi başarısız: $LASTEXITCODE" }
        } finally { Pop-Location }
        $built = Get-ChildItem -LiteralPath (Join-Path $pclientRoot 'build/libs') -Filter 'PClient-*.jar' |
            Where-Object { $_.Name -notmatch '-sources\.jar$' } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if (-not $built) { throw 'PClient jar çıktısı bulunamadı.' }
        Copy-Item -LiteralPath $built.FullName -Destination $pclientJar -Force
    } elseif (-not (Test-Path -LiteralPath $pclientJar -PathType Leaf)) {
        throw 'PClient jar yok ve Gradle bulunamadı.'
    } else {
        Write-Output 'Gradle bulunamadı; son derlenen PClient jar kullanılıyor.'
    }
    # Arayüz derlemesi Rust tarafına gömüldüğü için Cargo adımlarından önce yapılır.
    Invoke-Native 'npm.cmd' @('run', 'build')
    if ($LASTEXITCODE -ne 0) { throw "Arayüz derlemesi başarısız: $LASTEXITCODE" }
    Invoke-Native 'cargo' @('test', '--locked', '--manifest-path', $manifestPath)
    if ($LASTEXITCODE -ne 0) { throw "cargo test başarısız: $LASTEXITCODE" }
    Invoke-Native 'cargo' @('build', '--release', '--locked', '--manifest-path', $manifestPath)
    if ($LASTEXITCODE -ne 0) { throw "cargo build --release başarısız: $LASTEXITCODE" }

    $metadataJson = & cargo metadata --no-deps --format-version 1 --locked --manifest-path $manifestPath
    if ($LASTEXITCODE -ne 0) { throw 'Cargo metadata okunamadı.' }
    $metadata = $metadataJson | ConvertFrom-Json
    $package = @($metadata.packages | Where-Object {
        [System.IO.Path]::GetFullPath($_.manifest_path) -eq [System.IO.Path]::GetFullPath($manifestPath)
    })
    if ($package.Count -ne 1) { throw 'Proje paket bilgisi bulunamadı.' }
    $version = $package[0].version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
        throw 'Paket sürümü geçerli değil.'
    }
    $artifactPath = Join-Path $metadata.target_directory "release/$($package[0].name).exe"
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw 'Release çıktısı bulunamadı.' }
    # Otomatik güncelleme imzası: anahtar git dışındaki .secrets klasöründedir. Anahtar yoksa
    # kurulum imzasız kalır ve yüklü launcher'lar bu sürümü güncelleme olarak kabul etmez.
    $updaterKey = Join-Path $projectRoot '.secrets/updater.key'
    $updaterPassword = Join-Path $projectRoot '.secrets/updater.key.password'
    if (-not (Test-Path -LiteralPath $updaterKey -PathType Leaf)) {
        throw 'Güncelleme imza anahtarı (.secrets/updater.key) yok; kurulum imzalanamaz.'
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $updaterKey -Raw).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = if (Test-Path -LiteralPath $updaterPassword -PathType Leaf) {
        (Get-Content -LiteralPath $updaterPassword -Raw).Trim()
    } else { '' }
    # Oyunculara dağıtılan kurulum sihirbazı (NSIS); derlenmiş EXE yeniden derlenmeden paketlenir.
    Invoke-Native 'npx.cmd' @('tauri', 'bundle', '--bundles', 'nsis')
    if ($LASTEXITCODE -ne 0) { throw "Kurulum paketi oluşturulamadı: $LASTEXITCODE" }
    $setupBuilt = Join-Path $metadata.target_directory "release/bundle/nsis/PatronLauncher_$($version)_x64-setup.exe"
    if (-not (Test-Path -LiteralPath $setupBuilt -PathType Leaf)) { throw 'Kurulum dosyası bulunamadı.' }
    $signatureBuilt = "$setupBuilt.sig"
    if (-not (Test-Path -LiteralPath $signatureBuilt -PathType Leaf)) { throw 'Kurulum imzası (.sig) oluşturulamadı.' }
    $distRoot = Join-Path $projectRoot 'dist'
    New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
    $setupName = "PatronLauncher-$version-setup.exe"
    Copy-Item -LiteralPath $setupBuilt -Destination (Join-Path $distRoot $setupName) -Force
    # GitHub sürümüne kurulum dosyasıyla birlikte yüklenecek güncelleme bildirimi. Yüklü
    # launcher'lar releases/latest/download/latest.json adresini okur.
    $manifest = [ordered]@{
        version   = $version
        notes     = "PatronLauncher $version"
        pub_date  = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                signature = (Get-Content -LiteralPath $signatureBuilt -Raw).Trim()
                url       = "https://github.com/PatronLauncher/PatronLauncher/releases/download/v$version/$setupName"
            }
        }
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $distRoot 'latest.json'), ($manifest | ConvertTo-Json -Depth 5), $utf8)
    $archiveRoot = Join-Path $distRoot 'archive'
    New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
    $latestPath = Join-Path $distRoot 'PatronLauncher-latest.exe'
    $istanbulZone = [TimeZoneInfo]::FindSystemTimeZoneById('Turkey Standard Time')
    $buildTime = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $istanbulZone)
    $archivePath = Join-Path $archiveRoot "PatronLauncher-$version-$($buildTime.ToString('yyyy-MM-dd-HHmm')).exe"
    try {
        Copy-Item -LiteralPath $artifactPath -Destination $latestPath -Force
    } catch {
        throw "Son sürüm dosyası güncellenemedi. Açıksa PatronLauncher-latest.exe uygulamasını kapatıp yeniden deneyin. $($_.Exception.Message)"
    }
    Copy-Item -LiteralPath $latestPath -Destination $archivePath -Force
    (Get-Item -LiteralPath $archivePath).LastWriteTimeUtc = [DateTime]::UtcNow

    $resolvedArchiveRoot = (Resolve-Path -LiteralPath $archiveRoot).Path
    $oldArchives = Get-ChildItem -LiteralPath $resolvedArchiveRoot -File |
        Where-Object { $_.Name -match '^PatronLauncher-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{5})?\.exe$' } |
        Sort-Object LastWriteTimeUtc, Name -Descending |
        Select-Object -Skip 5
    foreach ($oldArchive in $oldArchives) {
        $resolvedFile = (Resolve-Path -LiteralPath $oldArchive.FullName).Path
        if ([System.IO.Path]::GetDirectoryName($resolvedFile) -ne $resolvedArchiveRoot) {
            throw 'Arşiv temizleme yolu doğrulanamadı.'
        }
        Remove-Item -LiteralPath $resolvedFile
    }
    Write-Output "Son sürüm: $latestPath"
} finally {
    Pop-Location
}
