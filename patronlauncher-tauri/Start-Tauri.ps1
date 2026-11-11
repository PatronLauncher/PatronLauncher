$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $toolRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.tools'
    if (Test-Path -LiteralPath "$toolRoot/cargo/bin/cargo.exe") {
        $env:CARGO_HOME = "$toolRoot/cargo"
        $env:RUSTUP_HOME = "$toolRoot/rustup"
        $env:PATH = "$toolRoot/cargo/bin;$env:PATH"
    }
    npm run desktop:dev
    if ($LASTEXITCODE -ne 0) { throw 'Tauri başlatılamadı.' }
} finally { Pop-Location }
