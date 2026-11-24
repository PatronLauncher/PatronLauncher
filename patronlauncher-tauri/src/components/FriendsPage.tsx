import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, msg, locale } from "../i18n";
import { usePatronAccount } from "../patronAccount";
import PatronAccountCard from "./PatronAccountCard";
import "../styles/social.css";

type Presence = { online: boolean; playing: { version: string | null; server: string | null; since: number } | null } | null;
type Person = { id: string; username: string; displayUsername: string };
type Friend = Person & { since: number; presence: Presence };
type Msg = { id: number; from: string; body: string; at: number };
type Conv = Person & { last: Msg | null; unread: number };
type Privacy = { dmPolicy: string; presencePolicy: string; friendPolicy: string };

/** Sitenin sosyal uçlarına launcher üzerinden istek (oturum anahtarı Rust'ta kalır). */
const api = <T,>(method: "GET" | "POST", path: string, body?: unknown) =>
  invoke<T>("social_api", { method, path, body: body ?? null });

const ERR: Record<string, string> = {
  NOT_FOUND: msg("Bu kullanıcı adıyla bir oyuncu yok."),
  SELF: msg("Bu sensin!"),
  BLOCKED: msg("Bu oyuncuyla bunu yapamazsın."),
  ALREADY_FRIENDS: msg("Zaten arkadaşsınız."),
  REQUESTS_CLOSED: msg("Bu oyuncu arkadaşlık isteği kabul etmiyor."),
  DM_CLOSED: msg("Bu oyuncu senden mesaj kabul etmiyor."),
  RATE_LIMITED: msg("Biraz yavaşla ve yeniden dene."),
};
const errText = (e: unknown) => {
  const code = String(e).replace(/^Error:\s*/, "");
  return code in ERR ? t(ERR[code]) : t("Bir şeyler ters gitti. Yeniden dene.");
};

function status(p: Presence): { text: string; playing: boolean } {
  if (!p) return { text: t("Çevrimdışı"), playing: false };
  if (p.playing)
    return {
      text: p.playing.server ? t("{server} sunucusunda", { server: p.playing.server }) : t("Minecraft {version} oynuyor", { version: p.playing.version ?? "" }),
      playing: true,
    };
  return { text: p.online ? t("Çevrimiçi") : t("Çevrimdışı"), playing: false };
}

function Avatar({ p, presence }: { p: Person; presence?: Presence }) {
  return (
    <span className="so-avatar">
      {(p.displayUsername || p.username).slice(0, 1).toUpperCase()}
      {presence !== undefined && <i className={`so-dot ${presence?.playing ? "playing" : presence?.online ? "online" : ""}`} />}
    </span>
  );
}

/**
 * Arkadaşlar ve mesajlar (klasik ve PClient arayüzlerinde aynı). Veriler sitedendir; anlık olaylar launcher'ın
 * açık tuttuğu bağlantıdan gelir (social::EVENT). Site ve oyun içiyle aynı kutu: bir yerde okunan her yerde okunur.
 */
export default function FriendsPage({ variant }: { variant: "classic" | "pclient" }) {
  const { account } = usePatronAccount();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<(Person & { at: number })[]>([]);
  const [outgoing, setOutgoing] = useState<(Person & { at: number })[]>([]);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [chats, setChats] = useState<Conv[]>([]);
  const [tab, setTab] = useState<"friends" | "requests" | "blocked" | "privacy">("friends");
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [header, setHeader] = useState<Person | null>(null);
  const [draft, setDraft] = useState("");
  const [addName, setAddName] = useState("");
  const [note, setNote] = useState("");
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [live, setLive] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const box = useRef<HTMLOListElement>(null);
  const signedIn = account.state === "signed_in";

  const loadFriends = useCallback(async () => {
    try {
      const r = await api<{ friends: Friend[]; incoming: (Person & { at: number })[]; outgoing: (Person & { at: number })[]; blocked: Person[] }>("GET", "/api/social/friends");
      setFriends(r.friends);
      setIncoming(r.incoming);
      setOutgoing(r.outgoing);
      setBlocked(r.blocked);
    } catch {
      /* çevrimdışı: son liste kalır */
    }
  }, []);
  const loadChats = useCallback(async () => {
    try {
      setChats((await api<{ conversations: Conv[] }>("GET", "/api/social/conversations")).conversations);
    } catch {
      /* son liste kalır */
    }
  }, []);
  const openChat = useCallback(async (username: string) => {
    setActive(username);
    try {
      const r = await api<{ with: Omit<Person, "id">; messages: Msg[]; canSend: boolean }>("GET", `/api/social/messages?with=${encodeURIComponent(username)}`);
      setHeader({ ...r.with, id: "" });
      setMessages(r.messages);
      setCanSend(r.canSend);
      await api("POST", "/api/social/read", { with: username });
      setChats((old) => old.map((c) => (c.username === username ? { ...c, unread: 0 } : c)));
    } catch (e) {
      setNote(errText(e));
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void loadFriends();
    void loadChats();
    void api<Privacy>("GET", "/api/social/privacy").then(setPrivacy).catch(() => {});
    void invoke<{ connected: boolean }>("social_status").then((s) => setLive(s.connected)).catch(() => {});
  }, [signedIn, loadFriends, loadChats]);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void listen<{ type: string; [k: string]: unknown }>("patronlauncher://social", (e) => {
      const ev = e.payload;
      if (ev.type === "connection") {
        setLive(ev.online === true);
        if (ev.online) {
          void loadFriends();
          void loadChats();
        }
      } else if (ev.type === "message") {
        const w = ev.with as string;
        const m = ev.message as Msg;
        if (w === activeRef.current) {
          setMessages((old) => (old.some((x) => x.id === m.id) ? old : [...old, m]));
          if (m.from !== "me") void api("POST", "/api/social/read", { with: w });
        }
        void loadChats();
      } else if (ev.type === "read") void loadChats();
      else if (ev.type === "friends") void loadFriends();
      else if (ev.type === "privacy") void api<Privacy>("GET", "/api/social/privacy").then(setPrivacy).catch(() => {});
      else if (ev.type === "presence") {
        const presence: Presence = { online: ev.online === true, playing: (ev.playing ?? null) as NonNullable<Presence>["playing"] };
        setFriends((old) => old.map((f) => (f.id === ev.user ? { ...f, presence } : f)));
      }
    }).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, [loadFriends, loadChats]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages]);

  const act = async (action: string, username: string) => {
    setNote("");
    try {
      const r = await api<{ result: string }>("POST", "/api/social/friends", { action, username });
      if (action === "request") setNote(r.result === "friends" ? t("Artık arkadaşsınız!") : t("İstek gönderildi"));
    } catch (e) {
      setNote(errText(e));
    }
    await loadFriends();
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !active) return;
    setDraft("");
    try {
      const r = await api<{ message: Msg }>("POST", "/api/social/messages", { to: active, body });
      setMessages((old) => (old.some((x) => x.id === r.message.id) ? old : [...old, r.message]));
    } catch (e) {
      setDraft(body);
      setNote(errText(e));
    }
  };

  const savePrivacy = async (key: keyof Privacy, value: string) => {
    try {
      const r = await api<Privacy>("POST", "/api/social/privacy", { [key]: value });
      setPrivacy({ dmPolicy: r.dmPolicy, presencePolicy: r.presencePolicy, friendPolicy: r.friendPolicy });
      setNote(t("Kaydedildi"));
    } catch (e) {
      setNote(errText(e));
    }
  };

  if (!signedIn)
    return (
      <div className={`so-page so-${variant} so-signin`}>
        <p className="so-intro">{t("Arkadaşlar ve mesajlar için PatronLauncher hesabınla giriş yap.")}</p>
        <PatronAccountCard variant={variant} />
      </div>
    );

  const rank = (f: Friend) => (f.presence?.playing ? 2 : f.presence?.online ? 1 : 0);
  const time = new Intl.DateTimeFormat(locale(), { timeStyle: "short" });
  const policies: [string, string][] = [
    ["everyone", t("Herkes")],
    ["friends", t("Yalnızca arkadaşlar")],
    ["nobody", t("Kimse")],
  ];
  const tabs: ["friends" | "requests" | "blocked" | "privacy", string, number][] = [
    ["friends", t("Arkadaşlar"), friends.length],
    ["requests", t("İstekler"), incoming.length],
    ["blocked", t("Engellenenler"), 0],
    ["privacy", t("Gizlilik"), 0],
  ];

  return (
    <div className={`so-page so-${variant}`}>
      <aside className="so-side">
        <form
          className="so-add"
          onSubmit={(e) => {
            e.preventDefault();
            const name = addName.trim();
            if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return setNote(t(ERR.NOT_FOUND));
            setAddName("");
            void act("request", name);
          }}
        >
          <input className="so-field" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={t("PatronLauncher kullanıcı adı")} maxLength={16} aria-label={t("Arkadaş ekle")} />
          <button className="so-btn primary">{t("Arkadaş ekle")}</button>
        </form>
        {note && (
          <p className="so-note" role="status">
            {note}
          </p>
        )}
        <div className="so-tabs" role="tablist">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
              {n > 0 && <span className={k === "requests" ? "hot" : ""}>{n}</span>}
            </button>
          ))}
        </div>
        <ul className="so-list">
          {tab === "friends" &&
            (friends.length ? (
              [...friends]
                .sort((a, b) => rank(b) - rank(a) || a.username.localeCompare(b.username))
                .map((f) => {
                  const s = status(f.presence);
                  return (
                    <li key={f.id} className="so-row">
                      <Avatar p={f} presence={f.presence} />
                      <span className="so-meta">
                        <b>{f.displayUsername}</b>
                        <small className={s.playing ? "playing" : ""}>{s.text}</small>
                      </span>
                      <button className="so-icon" title={t("Mesaj gönder")} aria-label={t("Mesaj gönder")} onClick={() => void openChat(f.username)}>
                        ✉
                      </button>
                      <button
                        className="so-icon no"
                        title={t("Arkadaşlıktan çıkar")}
                        aria-label={t("Arkadaşlıktan çıkar")}
                        onClick={() => {
                          if (confirm(t("{name} arkadaşlarından çıkarılsın mı?", { name: f.displayUsername }))) void act("remove", f.username);
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })
            ) : (
              <li className="so-empty">{t("Henüz arkadaşın yok. Kullanıcı adıyla birini ekle.")}</li>
            ))}
          {tab === "requests" && (
            <>
              {incoming.map((p) => (
                <li key={p.id} className="so-row">
                  <Avatar p={p} />
                  <span className="so-meta">
                    <b>{p.displayUsername}</b>
                    <small>{t("Arkadaşın olmak istiyor")}</small>
                  </span>
                  <button className="so-icon ok" title={t("Kabul et")} aria-label={t("Kabul et")} onClick={() => void act("accept", p.username)}>
                    ✓
                  </button>
                  <button className="so-icon no" title={t("Reddet")} aria-label={t("Reddet")} onClick={() => void act("decline", p.username)}>
                    ✕
                  </button>
                  <button
                    className="so-icon no"
                    title={t("Engelle")}
                    aria-label={t("Engelle")}
                    onClick={() => {
                      if (confirm(t("{name} engellensin mi?", { name: p.displayUsername }))) void act("block", p.username);
                    }}
                  >
                    ⦸
                  </button>
                </li>
              ))}
              {outgoing.map((p) => (
                <li key={p.id} className="so-row">
                  <Avatar p={p} />
                  <span className="so-meta">
                    <b>{p.displayUsername}</b>
                    <small>{t("İstek gönderildi")}</small>
                  </span>
                  <button className="so-icon no" title={t("İsteği geri al")} aria-label={t("İsteği geri al")} onClick={() => void act("cancel", p.username)}>
                    ✕
                  </button>
                </li>
              ))}
              {!incoming.length && !outgoing.length && <li className="so-empty">{t("İstek yok.")}</li>}
            </>
          )}
          {tab === "blocked" &&
            (blocked.length ? (
              blocked.map((p) => (
                <li key={p.id} className="so-row">
                  <Avatar p={p} />
                  <span className="so-meta">
                    <b>{p.displayUsername}</b>
                  </span>
                  <button className="so-btn" onClick={() => void act("unblock", p.username)}>
                    {t("Engeli kaldır")}
                  </button>
                </li>
              ))
            ) : (
              <li className="so-empty">{t("Engellenen kimse yok.")}</li>
            ))}
          {tab === "privacy" && privacy && (
            <li className="so-privacy">
              <p className="so-muted">{t("Sitede, launcher'da ve oyun içinde geçerlidir. Engellediğin oyuncular hiçbir şey göremez.")}</p>
              <label>
                {t("Kim mesaj atabilir")}
                <select className="so-field" value={privacy.dmPolicy} onChange={(e) => void savePrivacy("dmPolicy", e.target.value)}>
                  {policies.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Çevrimiçi / oynadığımı kim görür")}
                <select className="so-field" value={privacy.presencePolicy} onChange={(e) => void savePrivacy("presencePolicy", e.target.value)}>
                  {policies.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Kim arkadaşlık isteği gönderebilir")}
                <select className="so-field" value={privacy.friendPolicy} onChange={(e) => void savePrivacy("friendPolicy", e.target.value)}>
                  <option value="everyone">{t("Herkes")}</option>
                  <option value="nobody">{t("Kimse")}</option>
                </select>
              </label>
            </li>
          )}
        </ul>
      </aside>

      <section className="so-chat">
        <div className="so-chats">
          <p className="so-label">
            {t("Sohbetler")} <i className={`so-live ${live ? "on" : ""}`} title={live ? t("Canlı") : t("Bağlanıyor…")} />
          </p>
          <ul className="so-list">
            {chats.length ? (
              chats.map((c) => {
                const f = friends.find((x) => x.username === c.username);
                return (
                  <li key={c.username} className={`so-row click ${c.username === active ? "on" : ""}`} onClick={() => void openChat(c.username)}>
                    <Avatar p={c} presence={f ? f.presence : undefined} />
                    <span className="so-meta">
                      <b>{c.displayUsername}</b>
                      <small>{c.last ? `${c.last.from === "me" ? `${t("Sen")}: ` : ""}${c.last.body}` : ""}</small>
                    </span>
                    {c.unread > 0 && c.username !== active && <span className="so-unread">{c.unread}</span>}
                  </li>
                );
              })
            ) : (
              <li className="so-empty">{t("Henüz sohbet yok.")}</li>
            )}
          </ul>
        </div>
        <div className="so-thread">
          <header>
            {header ? (
              <>
                <Avatar p={header} presence={friends.find((f) => f.username === header.username)?.presence ?? null} />
                <b>{header.displayUsername}</b>
              </>
            ) : (
              <span className="so-muted">{t("Sohbete başlamak için bir arkadaş seç.")}</span>
            )}
          </header>
          <ol ref={box} className="so-messages">
            {messages.map((m) => (
              <li key={m.id} className={`so-msg ${m.from === "me" ? "me" : ""}`}>
                <p>{m.body}</p>
                <time>{time.format(new Date(m.at * 1000))}</time>
              </li>
            ))}
          </ol>
          {active &&
            (canSend ? (
              <form
                className="so-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  className="so-field"
                  rows={1}
                  maxLength={2000}
                  value={draft}
                  placeholder={t("Bir mesaj yaz…")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="so-btn primary">{t("Gönder")}</button>
              </form>
            ) : (
              <p className="so-muted so-cannot">{t("Bu oyuncu yalnızca belirli kişilerden mesaj kabul ediyor.")}</p>
            ))}
        </div>
      </section>
    </div>
  );
}
