//! Regression guard: mocked browser invokes cannot detect a missing native ACL entry.
#[test]
fn every_registered_command_has_a_manifest_entry_and_main_window_permission() {
    use std::collections::BTreeSet;
    let main = include_str!("main.rs");
    let registered: BTreeSet<_> = main
        .split("commands::")
        .skip(1)
        .map(|part| {
            part.split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .next()
                .unwrap()
        })
        .collect();
    fn quoted(s: &str) -> BTreeSet<&str> {
        s.split('"')
            .enumerate()
            .filter(|(i, _)| i % 2 == 1)
            .map(|(_, s)| s)
            .collect()
    }
    let manifest = quoted(
        include_str!("../build.rs")
            .split("commands(&[")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap(),
    );
    let permission = include_str!("../permissions/core.toml");
    let allowed = quoted(
        permission
            .split("commands.allow = [")
            .nth(1)
            .unwrap()
            .split(']')
            .next()
            .unwrap(),
    );
    assert_eq!(registered, manifest);
    assert_eq!(registered, allowed);
    assert!(
        allowed
            .iter()
            .all(|c| !c.contains('*') && !c.contains("allow-all"))
    );
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert!(
        capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "allow-launcher-core")
    );
}
