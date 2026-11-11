use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .https_only(true)
        .build()?)
}
pub fn json(client: &Client, url: &str) -> Result<serde_json::Value> {
    Ok(client.get(url).send()?.error_for_status()?.json()?)
}
pub fn digest_file(path: &Path, sha256: bool) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut a = Sha1::new();
    let mut b = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        if sha256 {
            b.update(&buf[..n]);
        } else {
            a.update(&buf[..n]);
        }
    }
    Ok(if sha256 {
        format!("{:x}", b.finalize())
    } else {
        format!("{:x}", a.finalize())
    })
}
pub fn download(client: &Client, url: &str, path: &Path, hash: &str, sha256: bool) -> Result<()> {
    download_cancellable(
        client,
        url,
        path,
        hash,
        sha256,
        &std::sync::atomic::AtomicBool::new(false),
    )
}
pub fn download_cancellable(
    client: &Client,
    url: &str,
    path: &Path,
    hash: &str,
    sha256: bool,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<()> {
    use std::sync::atomic::Ordering;
    if cancel.load(Ordering::Relaxed) {
        bail!("İşlem iptal edildi.")
    }
    if path.is_file() {
        // Daha önce doğrulanıp değişmemiş dosya yeniden okunmaz (bkz. verified.rs).
        if crate::verified::is_verified(path, hash) {
            return Ok(());
        }
        if digest_file(path, sha256)? == hash {
            crate::verified::remember(path, hash);
            return Ok(());
        }
    }
    fs::create_dir_all(path.parent().context("Dosya klasörü yok")?)?;
    let part = path.with_extension("part");
    let offset = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
    }
    let mut response = request.send()?;
    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        if part.is_file() && digest_file(&part, sha256)? == hash {
            fs::rename(&part, path)?;
            crate::verified::remember(path, hash);
            return Ok(());
        }
        let _ = fs::remove_file(&part);
        response = client.get(url).send()?;
    }
    let mut response = response.error_for_status()?;
    let append = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if append {
        let prefix = format!("bytes {offset}-");
        if !response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with(&prefix))
        {
            bail!("Geçersiz devam yanıtı.")
        }
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&part)?;
    let mut buffer = [0u8; 65536];
    loop {
        if cancel.load(Ordering::Relaxed) {
            file.flush()?;
            bail!("İşlem iptal edildi.")
        }
        let len = response.read(&mut buffer)?;
        if len == 0 {
            break;
        }
        file.write_all(&buffer[..len])?;
    }
    file.flush()?;
    file.sync_all()?;
    drop(file);
    if digest_file(&part, sha256)? != hash {
        let _ = fs::remove_file(&part);
        bail!("İndirilen dosyanın bütünlük kontrolü başarısız.")
    }
    fs::rename(&part, path)?;
    crate::verified::remember(path, hash);
    Ok(())
}
pub fn safe_join(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if relative.contains('\\')
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        || path.is_absolute()
        || relative.contains(':')
    {
        bail!("Geçersiz indirme yolu");
    }
    Ok(root.join(path))
}
pub fn extract(archive: &Path, root: &Path, excludes: &[String]) -> Result<()> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        if excludes.iter().any(|p| entry.name().starts_with(p)) {
            continue;
        }
        let name = entry.enclosed_name().context("Arşivde geçersiz yol")?;
        let path = root.join(name);
        if entry.is_dir() {
            fs::create_dir_all(path)?;
        } else {
            fs::create_dir_all(path.parent().unwrap())?;
            std::io::copy(&mut entry, &mut fs::File::create(path)?)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_download_resumes_range_and_cancel_keeps_partial_bytes() {
        use std::{net::TcpListener, sync::atomic::AtomicBool};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for second in [false, true] {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = vec![];
                loop {
                    let mut b = [0u8; 1];
                    socket.read_exact(&mut b).unwrap();
                    request.push(b[0]);
                    if request.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                if second {
                    assert!(
                        String::from_utf8(request)
                            .unwrap()
                            .to_ascii_lowercase()
                            .contains("range: bytes=3-")
                    );
                    socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef").unwrap();
                } else {
                    socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc",
                        )
                        .unwrap();
                }
            }
        });
        let root = std::env::temp_dir().join(format!("resume-test-{}", uuid::Uuid::new_v4()));
        let path = root.join("file.jar");
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let url = format!("http://{address}/file");
        let hash = format!("{:x}", Sha1::digest(b"abcdef"));
        assert!(
            download_cancellable(&client, &url, &path, &hash, false, &AtomicBool::new(false))
                .is_err()
        );
        assert_eq!(fs::read(path.with_extension("part")).unwrap(), b"abc");
        assert!(
            download_cancellable(&client, &url, &path, &hash, false, &AtomicBool::new(true))
                .is_err()
        );
        download_cancellable(&client, &url, &path, &hash, false, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(path).unwrap(), b"abcdef");
        server.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reject_unsafe_paths() {
        let root = Path::new("cache");
        for p in ["../escape", "/absolute", "C:/escape", "a\\..\\escape"] {
            assert!(safe_join(root, p).is_err());
        }
        assert_eq!(
            safe_join(root, "org/example/file.jar").unwrap(),
            root.join("org/example/file.jar")
        );
    }

    #[test]
    fn checksum_cache_and_archive_boundaries() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-net-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("cached.bin");
        fs::write(&file, b"abc").unwrap();
        let expected = "a9993e364706816aba3e25717850c26c9cd0d89d";
        assert_eq!(digest_file(&file, false).unwrap(), expected);
        assert_eq!(
            digest_file(&file, true).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // A verified cache hit must not attempt any network request.
        download(
            &client().unwrap(),
            "https://invalid.invalid/",
            &file,
            expected,
            false,
        )
        .unwrap();
        let archive = root.join("test.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        writer
            .start_file("../escape.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"must stay in archive").unwrap();
        writer.finish().unwrap();
        assert!(extract(&archive, &root.join("output"), &[]).is_err());
        assert!(!root.join("escape.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
