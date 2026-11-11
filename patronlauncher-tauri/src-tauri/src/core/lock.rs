use std::{
    fs::{File, OpenOptions},
    path::Path,
};
pub fn acquire(root: &Path) -> anyhow::Result<File> {
    std::fs::create_dir_all(root)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("launcher.lock"))?;
    file.try_lock().map_err(|_| {
        anyhow::anyhow!("PatronLauncher bu veri klasörüyle zaten açık. Diğer pencereyi kapatın.")
    })?;
    Ok(file)
}
