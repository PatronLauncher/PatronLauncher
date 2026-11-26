# PatronLauncher

A Rust-based Minecraft Java Edition launcher for Windows. The app lives in
`patronlauncher-tauri/`: a Tauri 2 + React + Vite + TypeScript interface and the Rust core in
`src-tauri/`. See [patronlauncher-tauri/README.md](patronlauncher-tauri/README.md) for details.

Website: [patronlauncher.net](https://patronlauncher.net)

## Versions

This repository contains two products with **independent version numbers**:

| Product | What | Current version | Where it is shown |
| --- | --- | --- | --- |
| **PatronLauncher** | Windows launcher (`patronlauncher-tauri/`) | 1.1.0 | Launcher settings, installer file name |
| **PClient** | In-game client, a Fabric mod (`pclient-fabric/`) | 1.2.0 (Minecraft 26.3) | In-game main menu and PClient settings |

- PClient is not downloaded separately; it ships inside PatronLauncher and updates with it.
- That is why every GitHub release is a **PatronLauncher** release (e.g. `v1.1.0`). The release notes
  have two sections: the *PatronLauncher* changes and the changes in the bundled *PClient x.y.z*.
  If PClient did not change in a release, the notes say so.
- PClient only gets a new version number when its own code changes; a launcher update alone does
  not change the PClient version.

| PatronLauncher | PClient bundled |
| --- | --- |
| 1.0.0 – 1.0.2 | 1.0.0 (before separate versioning) |
| 1.0.3 | 1.1.0 |
| 1.1.0 | 1.2.0 |

## Building

Run `./build.ps1` from the project root. The script builds the interface, runs the Rust tests,
produces the release EXE and:

- updates `dist/PatronLauncher-latest.exe` with the latest successful build,
- archives it as `dist/archive/PatronLauncher-<version>-<yyyy-MM-dd-HHmm>.exe`
  (Europe/Istanbul time, the last 5 builds are kept),
- produces the installer for players as `dist/PatronLauncher-<version>-setup.exe`
  (NSIS, per-user install, no administrator rights needed).

The Rust toolchain is used from the local install under `.tools/`; the global PATH is not changed.

PClient (the in-game client, `pclient-fabric/`) is rebuilt and embedded in the launcher when
Gradle 9.8+ and JDK 25 are available; otherwise `src-tauri/resources/pclient/PClient.jar` is used.

### Values embedded at build time

They are read from the `.secrets/` folder, which is not in the repository. If a file is missing,
the related feature stays off:

| File | Used for |
| --- | --- |
| `.secrets/microsoft-client-id` | Azure application ID (GUID) for Microsoft sign-in. |
| `.secrets/curseforge.key` | API key for CurseForge content search. |
| `.secrets/contact` | Contact info in the User-Agent sent to Modrinth. |

Microsoft sign-in needs an Azure app registration with the "Mobile and desktop applications"
platform, the redirect URI `http://localhost`, and personal Microsoft accounts enabled. The
application ID must also be approved by Mojang for Minecraft API access.

## Data

Settings, profiles, backups and Minecraft accounts are stored on the player's own computer
(`%APPDATA%\#PatronLauncher`). Microsoft sessions are kept in the Windows Credential Manager.

A **PatronLauncher account** on [patronlauncher.net](https://patronlauncher.net) is optional. It
is only needed for online features such as friends, messages, joining a friend's server and the
public player profile. The launcher keeps only the account's session key, also in the Windows
Credential Manager.

## License

The source code is licensed under the [GNU AGPL v3.0](LICENSE). Logos, version covers and music
are not covered by the AGPL; see [NOTICE.md](NOTICE.md) for details and the "not official" notice.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
