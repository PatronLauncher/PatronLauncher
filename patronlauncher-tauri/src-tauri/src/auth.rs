use crate::{
    model::{Account, AccountKind},
    net,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const DEFAULT_CLIENT_ID: &str = match option_env!("PATRON_MICROSOFT_CLIENT_ID") {
    Some(id) => id,
    None => "",
};
const OAUTH: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE: &str = "XboxLive.signin offline_access";
pub struct Session {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    pub xuid: String,
}

fn field(value: &Value, key: &str) -> Result<String> {
    Ok(value[key]
        .as_str()
        .with_context(|| format!("Giriş yanıtında {key} alanı eksik."))?
        .to_owned())
}
fn form(
    client: &reqwest::blocking::Client,
    endpoint: &str,
    fields: &[(&str, &str)],
) -> Result<Value> {
    let response = client
        .post(format!("{OAUTH}/{endpoint}"))
        .form(fields)
        .send()?;
    let status = response.status();
    let body: Value = response.json()?;
    if !status.is_success()
        && body["error"] != "authorization_pending"
        && body["error"] != "slow_down"
    {
        // error_description "AADSTS…" koduyla başlar; teşhis için ilk satırı yeterli.
        let detail = body["error_description"]
            .as_str()
            .and_then(|d| d.lines().next())
            .unwrap_or("");
        bail!(
            "Microsoft girişi başarısız ({}). {detail}",
            body["error"].as_str().unwrap_or("bilinmeyen hata")
        );
    }
    Ok(body)
}
fn post(client: &reqwest::blocking::Client, url: &str, body: Value) -> Result<Value> {
    let response = client.post(url).json(&body).send()?;
    let status = response.status();
    if !status.is_success() {
        bail!(
            "Hesap doğrulama başarısız ({status}). Xbox profili, hesap kısıtlamaları ve PatronLauncher uygulamasının Minecraft API erişimini kontrol edin."
        );
    }
    Ok(response.json()?)
}
/// Mojang yeni uygulama kimliklerini onaylayana kadar bu adım 403 döner.
fn post_minecraft(client: &reqwest::blocking::Client, url: &str, body: Value) -> Result<Value> {
    let response = client.post(url).json(&body).send()?;
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        bail!(
            "Minecraft girişi reddedildi: PatronLauncher uygulamasının Minecraft API erişimi henüz onaylanmamış."
        );
    }
    if !response.status().is_success() {
        bail!("Minecraft girişi başarısız ({}).", response.status());
    }
    Ok(response.json()?)
}
fn minecraft(ms_token: &str) -> Result<Session> {
    let client = net::client()?;
    let xbox = post(
        &client,
        "https://user.auth.xboxlive.com/user/authenticate",
        json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_token}") },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"
        }),
    )?;
    let xsts = post(
        &client,
        "https://xsts.auth.xboxlive.com/xsts/authorize",
        json!({
            "Properties": {"SandboxId": "RETAIL", "UserTokens": [field(&xbox, "Token")?]},
            "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"
        }),
    )?;
    let claims = &xsts["DisplayClaims"]["xui"][0];
    let uhs = field(claims, "uhs")?;
    let login = post_minecraft(
        &client,
        "https://api.minecraftservices.com/authentication/login_with_xbox",
        json!({
            "identityToken": format!("XBL3.0 x={uhs};{}", field(&xsts, "Token")?)
        }),
    )?;
    let access_token = field(&login, "access_token")?;
    let profile_response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&access_token)
        .send()?;
    if !profile_response.status().is_success() {
        bail!(
            "Minecraft Java profili bulunamadı. Hesabın oyuna sahip olduğunu ve profil oluşturduğunu kontrol edin."
        );
    }
    let profile: Value = profile_response.json()?;
    let uuid = field(&profile, "id")?;
    Uuid::parse_str(&uuid).context("Minecraft profil kimliği geçersiz")?;
    Ok(Session {
        name: field(&profile, "name")?,
        uuid,
        access_token,
        xuid: claims["xid"].as_str().unwrap_or("").into(),
    })
}
fn entry(account: &Account) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(
        crate::migration::CREDENTIAL_SERVICE,
        &account.id.to_string(),
    )?)
}

/// Ayarlardaki kimlik boşsa derlemeye gömülü PatronLauncher kimliği kullanılır.
pub fn client_id(configured: &str) -> Option<String> {
    let id = match configured.trim() {
        "" => DEFAULT_CLIENT_ID.trim(),
        id => id,
    };
    Uuid::parse_str(id).ok().map(|_| id.to_owned())
}

const MISSING_CLIENT_ID: &str =
    "Microsoft girişi bu derlemede henüz etkin değil: PatronLauncher uygulama kimliği eksik.";
const PAGE: &str = "<!doctype html><meta charset=utf-8><title>PatronLauncher</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0a0b10;color:#fff;font-family:Segoe UI,sans-serif\"><div style=\"text-align:center\"><h1 style=\"color:#ff2a3d\">PatronLauncher</h1><p>{text}</p></div>";

fn reply(stream: &mut TcpStream, status: &str, text: &str) {
    let body = PAGE.replace("{text}", text);
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Tarayıcı doğrudan Microsoft giriş sayfasını açar; giriş bitince kod yerel adrese döner (PKCE).
fn authorize(
    client_id: &str,
    cancelled: &AtomicBool,
    notify: &impl Fn(String),
) -> Result<(String, String, String)> {
    let listener =
        TcpListener::bind("127.0.0.1:0").context("Giriş için yerel bağlantı açılamadı.")?;
    listener.set_nonblocking(true)?;
    let redirect = format!("http://localhost:{}", listener.local_addr()?.port());
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = Uuid::new_v4().simple().to_string();
    let url = reqwest::Url::parse_with_params(
        &format!("{OAUTH}/authorize"),
        &[
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", redirect.as_str()),
            ("scope", SCOPE),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ],
    )?;
    notify("Microsoft giriş sayfası tarayıcıda açıldı. Girişi orada tamamla.".into());
    webbrowser::open(url.as_str()).context("Tarayıcı açılamadı.")?;
    let deadline = Instant::now() + Duration::from_secs(600);
    while Instant::now() < deadline {
        if cancelled.load(Ordering::Relaxed) {
            bail!("Giriş iptal edildi.");
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line)?;
        let path = line.split_whitespace().nth(1).unwrap_or("/");
        let query = reqwest::Url::parse(&format!("http://localhost{path}"))?;
        let get = |key: &str| {
            query
                .query_pairs()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned())
        };
        if get("code").is_none() && get("error").is_none() {
            reply(&mut stream, "404 Not Found", "");
            continue;
        }
        if get("state").as_deref() != Some(state.as_str()) {
            reply(&mut stream, "400 Bad Request", "Geçersiz giriş isteği. / Invalid sign-in request.");
            bail!("Microsoft girişi doğrulanamadı; yeniden deneyin.");
        }
        if let Some(error) = get("error") {
            reply(&mut stream, "200 OK", "Giriş iptal edildi. / Sign-in cancelled.");
            bail!("Microsoft girişi tamamlanmadı ({error}).");
        }
        reply(
            &mut stream,
            "200 OK",
            "Giriş tamamlandı, bu sekmeyi kapatabilirsin. / Signed in, you can close this tab.",
        );
        return Ok((get("code").unwrap_or_default(), verifier, redirect));
    }
    bail!("Giriş süresi doldu. Yeniden deneyin.")
}

pub fn login(
    client_id: &str,
    cancelled: Arc<AtomicBool>,
    notify: impl Fn(String),
) -> Result<Account> {
    let client_id = self::client_id(client_id).context(MISSING_CLIENT_ID)?;
    let (code, verifier, redirect) = authorize(&client_id, &cancelled, &notify)?;
    let token = form(
        &net::client()?,
        "token",
        &[
            ("client_id", client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", SCOPE),
        ],
    )?;
    notify("Minecraft hesabı doğrulanıyor…".into());
    let session = minecraft(&field(&token, "access_token")?)?;
    let account = Account {
        id: Uuid::new_v4(),
        name: session.name,
        uuid: session.uuid,
        kind: AccountKind::Microsoft,
    };
    entry(&account)?
        .set_password(&field(&token, "refresh_token")?)
        .context("Oturum Windows Kimlik Bilgisi Yöneticisi'ne kaydedilemedi.")?;
    Ok(account)
}
pub fn session(account: &Account, client_id: &str) -> Result<Session> {
    if account.kind == AccountKind::Local {
        return Ok(Session {
            name: account.name.clone(),
            uuid: account.uuid.clone(),
            access_token: "0".into(),
            xuid: String::new(),
        });
    }
    let client_id = self::client_id(client_id).context(MISSING_CLIENT_ID)?;
    let saved = crate::migration::refresh_token(account.id)?;
    let token = form(
        &net::client()?,
        "token",
        &[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", &saved),
            ("scope", SCOPE),
        ],
    )?;
    let session = minecraft(&field(&token, "access_token")?)?;
    if session.uuid != account.uuid {
        bail!("Oturum farklı bir Minecraft profiline ait. Yeniden giriş yapın.");
    }
    if let Some(refresh) = token["refresh_token"].as_str() {
        entry(account)?.set_password(refresh)?;
    }
    Ok(session)
}
pub fn forget(account: &Account) -> Result<()> {
    if account.kind == AccountKind::Microsoft {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
