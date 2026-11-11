# Mod backend contract (UI integration deferred)

Reviewed against https://docs.modrinth.com/api/ on 2026-11-03.
No React screen is connected to these commands yet.

- `mods_search(search)`: query, sort (`relevance/downloads/follows/updated/newest`), category, loader, game_version, environment (`client/server`), offset, limit (1–100). Optional fields accept null. Environment uses the documented environment facet, not deprecated side facets.
- `mods_project(project)`: project body, description, gallery, tags, team creators and full version/changelog metadata.
- `mods_versions(id, project, includeIncompatible)`: compatible versions in release/beta/alpha preference order, recommended version id, optionally incompatible versions.
- `mods_plan(id, projects)`: server-owned, ten-minute, single-use installation plan. Includes dependencies, warnings, filenames, hashes and total bytes. Does not download JARs.
- `mods_install(id, planId, confirmed)`: explicit consent required; schedules a cancellable core worker. Use existing `cancel_operation` to cancel. Profile/version and manifest snapshot are rechecked.
- `mods_list(id)`: managed entries and external filenames. External files cannot be removed/renamed through these commands.
- `mods_removal_plan(id, project)`: target and exclusively owned dependency candidates; show this before asking the user whether dependencies should also be removed.
- `mods_remove(id, project, removeDependencies, confirmed)`: schedules removal; false keeps dependencies. Required dependencies of other mods cannot be removed.
- `mods_set_enabled(id, project, enabled)`: schedules verified .jar/.jar.disabled transition. Active dependents block disabling a dependency.
- `mods_check_updates(id)`: returns newer compatible recommendations; does not install updates. Replacing an already managed project with another version is intentionally rejected by installation; removal followed by a freshly approved installation is required.
- `mods_create_fabric_profile(name, versionId, projects)`: reuses profile wizard creation, returns a plan for the new Custom Fabric profile. Install only after explicit approval with mods_install. If metadata planning fails, the valid empty profile is retained and its id is included in the error for retry.

`id` means profile UUID. All commands have explicit main-window permissions. Vanilla receives an actionable Fabric-profile error. Quick entries may also be targeted when selected and exposed by the core snapshot.

Progress event: `patronlauncher://mods-progress` with profile_id, filename, file_bytes, file_total, completed_bytes, total_bytes. Existing core events carry operation status and Finished. Writes reserve the core busy state so game launch/profile mutation cannot overlap.

Persistence: profile directory / mods.lock.json. Records include stable project/version ids, filename, hashes, installation Unix timestamp, selection provenance, enabled state, dependency edges and incompatibilities. Plan approval revalidates existing managed-file hashes. External mod compatibility cannot be inferred and is explicitly warned about.

Limits: 128 MiB per file, 512 MiB per plan, 64 resolved new projects, 256 managed entries, 8 MiB API responses, 120-second bounded metadata cache. HTTP 429 and exhausted response headers establish a global cooldown; retries are caller-driven after that time. API redirects are rejected. CDN redirects can only stay on HTTPS cdn.modrinth.com. Files are hash-checked outside mods, linked into place atomically without overwriting existing files, and rolled back if installation/manifest publication fails.

User-Agent contact comes from PATRONLAUNCHER_CONTACT at compile time (build.ps1 reads .secrets/contact, which is not committed).

Network-free tests inject fake metadata sources and download streams. Existing performance download tests cover SHA1/SHA512 streaming, size limits and cancellation. No live user profile is used by these tests.
