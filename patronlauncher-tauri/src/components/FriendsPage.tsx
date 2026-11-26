import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, msg, locale } from "../i18n";
import { usePatronAccount } from "../patronAccount";
import PatronAccountCard from "./PatronAccountCard";
import "../styles/social.css";

type Presence = { online: boolean; playing: { version: string | null; server: string | null; since: number } | null } | null;
type Person = { id: string; username: string; displayUsername: string };
type Friend = Person & { since: number; presence: Presence; blocked: boolean; muted: boolean };
type Msg = { id: number; from: string; body: string; at: number };
type Conv = Person & { last: Msg | null; unread: number; muted: boolean };
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

/** Küçük çizgi simgeleri (menü, onay penceresi ve gizlilik kartları). */
const PATHS: Record<string, string> = {
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bell: "M9.5 20a2.5 2.5 0 0 0 5 0M6 9a6 6 0 0 1 12 0v3.5l2 3.5H4l2-3.5z",
  bellOff: "M9.5 20a2.5 2.5 0 0 0 5 0M6 8.5a6 6 0 0 1 9.5-4.9M18 9v3.5l2 3.5H8M3 3l18 18",
  close: "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM9.5 9.5l5 5M14.5 9.5l-5 5",
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  block: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.7 5.7l12.6 12.6",
  unblock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.3 2.3 4.7-5",
  removeUser: "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21a7 7 0 0 1 12.5-4.3M16 17h6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  userPlus: "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6",
  check: "M5 12.5l4.2 4.2L19 7",
  join: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H3",
};
function Ico({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="so-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

function Avatar({ p, presence, dim }: { p: Person; presence?: Presence; dim?: boolean }) {
  return (
    <span className={`so-avatar${dim ? " dim" : ""}`}>
      {(p.displayUsername || p.username).slice(0, 1).toUpperCase()}
      {presence !== undefined && <i className={`so-dot ${presence?.playing ? "playing" : presence?.online ? "online" : ""}`} />}
    </span>
  );
}

type MenuItem = { icon: string; label: string; run: () => void; danger?: boolean } | "sep";

/**
 * İmlecin yanında açılan menü; ekrana sığmazsa ters yöne açılır. Sayfa kabı animasyonlu (transform) olduğu için
 * position: fixed orada imleçten kayıyordu; menü bu yüzden <body>'ye taşınır (portal). Dışarı tıklama, Esc ve kaydırma kapatır.
 */
function ContextMenu({ at, items, close, variant }: { at: { x: number; y: number }; items: MenuItem[]; close: () => void; variant: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: at.x, top: at.y, visibility: "hidden" });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const flipX = at.x + 2 + r.width > innerWidth - 8,
      flipY = at.y + 2 + r.height > innerHeight - 8;
    const left = Math.max(8, flipX ? at.x - r.width - 2 : at.x + 2);
    const top = Math.max(8, flipY ? at.y - r.height - 2 : at.y + 2);
    setPos({ left, top, transformOrigin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}` });
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [at.x, at.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const all = [...(ref.current?.querySelectorAll("button") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
        e.preventDefault();
      }
    };
    addEventListener("pointerdown", down, true);
    addEventListener("keydown", key);
    addEventListener("scroll", close, true);
    addEventListener("resize", close);
    addEventListener("blur", close);
    return () => {
      removeEventListener("pointerdown", down, true);
      removeEventListener("keydown", key);
      removeEventListener("scroll", close, true);
      removeEventListener("resize", close);
      removeEventListener("blur", close);
    };
  }, [close]);
  let n = 0;
  return createPortal(
    <div className={`so-layer so-${variant}`}>
    <ul ref={ref} className="so-menu" role="menu" style={pos}>
      {items.map((it, i) =>
        it === "sep" ? (
          <li key={i} className="so-menu-sep" role="separator" />
        ) : (
          <li key={i} style={{ "--k": n++ } as CSSProperties}>
            <button
              role="menuitem"
              className={it.danger ? "danger" : ""}
              onClick={() => {
                close();
                it.run();
              }}
            >
              <Ico name={it.icon} />
              <span>{it.label}</span>
            </button>
          </li>
        ),
      )}
    </ul>
    </div>,
    document.body,
  );
}

type Ask = { icon: string; title: string; text: string; ok: string; run: () => void };

/** Launcher'a uygun onay penceresi (tarayıcının confirm kutusu yerine). */
function ConfirmDialog({ ask, close }: { ask: Ask; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLButtonElement>(".so-btn:not(.danger)")?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="so-dialog"
      aria-labelledby="so-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <span className="so-dialog-icon">
        <Ico name={ask.icon} size={22} />
      </span>
      <h2 id="so-dialog-title">{ask.title}</h2>
      <p>{ask.text}</p>
      <div className="so-dialog-actions">
        <button className="so-btn" onClick={close}>
          {t("Vazgeç")}
        </button>
        <button
          className="so-btn danger"
          onClick={() => {
            close();
            ask.run();
          }}
        >
          {ask.ok}
        </button>
      </div>
    </dialog>
  );
}

/** Kayan vurgulu seçim (Herkes / Arkadaşlar / Kimse). */
function Segmented({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="so-seg" role="radiogroup" aria-label={label} style={{ "--n": options.length, "--i": i } as CSSProperties}>
      <span className="so-seg-thumb" aria-hidden="true" />
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => v !== value && onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function PrivacyCard({ icon, title, text, saved, children }: { icon: string; title: string; text: string; saved: boolean; children: ReactNode }) {
  return (
    <div className={`so-pcard${saved ? " saved" : ""}`}>
      <div className="so-pcard-head">
        <span className="so-pcard-icon">
          <Ico name={icon} size={18} />
        </span>
        <span className="so-pcard-text">
          <b>{title}</b>
          <small>{text}</small>
        </span>
        <span className="so-pcard-ok" aria-hidden={!saved}>
          <Ico name="check" size={14} />
          {t("Kaydedildi")}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Arkadaşlar ve mesajlar (klasik ve PClient arayüzlerinde aynı). Veriler sitedendir; anlık olaylar launcher'ın
 * açık tuttuğu bağlantıdan gelir (social::EVENT). Site ve oyun içiyle aynı kutu: bir yerde okunan her yerde okunur.
 * Discord gibi: satıra sağ tık (ya da "⋯") mesaj, profil, sessize alma, sohbeti kapatma, kopyalama, çıkarma ve engelleme sunar.
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
  const [iBlocked, setIBlocked] = useState(false);
  const [header, setHeader] = useState<Person | null>(null);
  const [draft, setDraft] = useState("");
  const [addName, setAddName] = useState("");
  const [note, setNote] = useState("");
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // Site yanıt vermezse (internet yok, site kapalı) boş liste yerine açık bir uyarı ve "Yeniden dene" gösterilir.
  const [unreachable, setUnreachable] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; person: Person } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
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
      setUnreachable(false);
    } catch {
      setUnreachable(true); /* son liste kalır */
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
      const r = await api<{ with: Omit<Person, "id">; messages: Msg[]; canSend: boolean; iBlocked?: boolean }>("GET", `/api/social/messages?with=${encodeURIComponent(username)}`);
      setHeader({ ...r.with, id: "" });
      setMessages(r.messages);
      setCanSend(r.canSend);
      setIBlocked(r.iBlocked === true);
      await api("POST", "/api/social/read", { with: username });
      setChats((old) => old.map((c) => (c.username === username ? { ...c, unread: 0 } : c)));
      // Kapatılmış bir sohbet açılınca listeye geri döner.
      void loadChats();
    } catch (e) {
      setNote(errText(e));
    }
  }, [loadChats]);

  const loadAll = useCallback(() => {
    void loadFriends();
    void loadChats();
    void api<Privacy>("GET", "/api/social/privacy").then(setPrivacy).catch(() => {});
    void invoke<{ connected: boolean }>("social_status").then((s) => setLive(s.connected)).catch(() => {});
  }, [loadFriends, loadChats]);
  useEffect(() => {
    if (signedIn) loadAll();
  }, [signedIn, loadAll]);
  /** Arkadaş bir sunucudaysa adresi (sürüm uyumunu sunucu kendisi bildirir). */
  const joinInfo = (f: Friend) => {
    const server = f.blocked ? null : f.presence?.playing?.server;
    return server ? { server } : null;
  };
  const join = async (f: Friend) => {
    const info = joinInfo(f);
    if (!info || joining) return;
    setJoining(f.username);
    try {
      await invoke("join_friend", { username: f.username });
      setNote(t("{name} sunucusuna bağlanılıyor…", { name: info.server }));
    } catch (e) {
      const code = String(e).replace(/^Error:\s*/, "");
      if (code === "NOT_ON_SERVER") setNote(t("Arkadaşın şu an bir sunucuda değil."));
      else setNote(code in ERR ? t(ERR[code]) : code);
      void loadFriends();
    } finally {
      setJoining(null);
    }
  };

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
      else if (ev.type === "friends") {
        void loadFriends();
        // Engel ya da çıkarma açık sohbetin yazma durumunu değiştirebilir.
        if (activeRef.current) void openChat(activeRef.current);
      } else if (ev.type === "prefs") {
        void loadFriends();
        void loadChats();
      } else if (ev.type === "privacy") void api<Privacy>("GET", "/api/social/privacy").then(setPrivacy).catch(() => {});
      else if (ev.type === "presence") {
        const presence: Presence = { online: ev.online === true, playing: (ev.playing ?? null) as NonNullable<Presence>["playing"] };
        setFriends((old) => old.map((f) => (f.id === ev.user ? { ...f, presence } : f)));
      }
    }).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, [loadFriends, loadChats, openChat]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages]);

  const act = async (action: string, username: string) => {
    setNote("");
    try {
      const r = await api<{ result: string }>("POST", "/api/social/friends", { action, username });
      if (action === "request") setNote(r.result === "friends" ? t("Artık arkadaşsınız!") : t("İstek gönderildi"));
      if ((action === "block" || action === "unblock" || action === "remove") && username === activeRef.current) void openChat(username);
    } catch (e) {
      setNote(errText(e));
    }
    await loadFriends();
  };

  const setPref = async (username: string, change: { muted?: boolean; closed?: boolean }) => {
    try {
      await api("POST", "/api/social/prefs", { username, ...change });
      if (change.closed && activeRef.current === username) {
        setActive(null);
        setHeader(null);
        setMessages([]);
      }
    } catch (e) {
      setNote(errText(e));
    }
    await Promise.all([loadFriends(), loadChats()]);
  };

  const confirmBlock = (p: Person) =>
    setAsk({
      icon: "block",
      title: t("{name} engellensin mi?", { name: p.displayUsername || p.username }),
      text: t("Sana mesaj gönderemez ve çevrimiçi olduğunu göremez. Arkadaşlığınız sürer; istersen ayrıca arkadaşlıktan çıkarabilirsin."),
      ok: t("Engelle"),
      run: () => void act("block", p.username),
    });
  const confirmRemove = (p: Person) =>
    setAsk({
      icon: "removeUser",
      title: t("{name} arkadaşlarından çıkarılsın mı?", { name: p.displayUsername || p.username }),
      text: t("Arkadaş listenden çıkarılacak. Daha sonra yeniden istek gönderebilirsin."),
      ok: t("Arkadaşlıktan çıkar"),
      run: () => void act("remove", p.username),
    });

  /** Bir oyuncu için Discord tarzı seçenekler (arkadaş satırı, sohbet satırı ve sohbet başlığı ortak). */
  const personMenu = (p: Person): MenuItem[] => {
    const f = friends.find((x) => x.username === p.username);
    const conv = chats.find((x) => x.username === p.username);
    const muted = f?.muted ?? conv?.muted ?? false;
    const isBlocked = f?.blocked ?? blocked.some((b) => b.username === p.username);
    const items: MenuItem[] = [];
    if (!isBlocked) items.push({ icon: "chat", label: t("Mesaj gönder"), run: () => void openChat(p.username) });
    const ji = f ? joinInfo(f) : null;
    if (f && ji) items.push({ icon: "join", label: t("Sunucuya katıl"), run: () => void join(f) });
    items.push({ icon: "user", label: t("Profili görüntüle"), run: () => void invoke("patron_open_player", { username: p.username }).catch((e) => setNote(String(e))) });
    items.push({ icon: muted ? "bell" : "bellOff", label: muted ? t("Bildirimleri aç") : t("Bildirimleri sessize al"), run: () => void setPref(p.username, { muted: !muted }) });
    if (conv) items.push({ icon: "close", label: t("Sohbeti kapat"), run: () => void setPref(p.username, { closed: true }) });
    items.push({
      icon: "copy",
      label: t("Kullanıcı adını kopyala"),
      run: () => void navigator.clipboard?.writeText(p.username).then(() => setNote(t("Kopyalandı: {name}", { name: p.username }))),
    });
    items.push("sep");
    if (f) items.push({ icon: "removeUser", label: t("Arkadaşlıktan çıkar"), danger: true, run: () => confirmRemove(p) });
    items.push(
      isBlocked
        ? { icon: "unblock", label: t("Engeli kaldır"), run: () => void act("unblock", p.username) }
        : { icon: "block", label: t("Engelle"), danger: true, run: () => confirmBlock(p) },
    );
    return items;
  };
  const openMenu = (e: ReactMouseEvent, p: Person) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, person: p });
  };
  const moreButton = (p: Person) => (
    <button
      className="so-icon"
      title={t("Diğer seçenekler")}
      aria-label={t("Diğer seçenekler")}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ at: { x: r.right - 4, y: r.bottom + 2 }, person: p });
      }}
    >
      <Ico name="more" />
    </button>
  );
  const closeMenu = useCallback(() => setMenu(null), []);

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
    if (privacy) setPrivacy({ ...privacy, [key]: value });
    try {
      const r = await api<Privacy>("POST", "/api/social/privacy", { [key]: value });
      setPrivacy({ dmPolicy: r.dmPolicy, presencePolicy: r.presencePolicy, friendPolicy: r.friendPolicy });
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1800);
    } catch (e) {
      setNote(errText(e));
      void api<Privacy>("GET", "/api/social/privacy").then(setPrivacy).catch(() => {});
    }
  };

  if (!signedIn)
    return (
      <div className={`so-page so-${variant} so-signin`}>
        <p className="so-intro">{t("Arkadaşlar ve mesajlar için PatronLauncher hesabınla giriş yap.")}</p>
        <PatronAccountCard variant={variant} />
      </div>
    );

  const rank = (f: Friend) => (f.blocked ? -1 : f.presence?.playing ? 2 : f.presence?.online ? 1 : 0);
  const time = new Intl.DateTimeFormat(locale(), { timeStyle: "short" });
  const policies: [string, string][] = [
    ["everyone", t("Herkes")],
    ["friends", t("Arkadaşlar")],
    ["nobody", t("Kimse")],
  ];
  const tabs: ["friends" | "requests" | "blocked" | "privacy", string, number][] = [
    ["friends", t("Arkadaşlar"), friends.length],
    ["requests", t("İstekler"), incoming.length],
    ["blocked", t("Engellenenler"), 0],
    ["privacy", t("Gizlilik"), 0],
  ];
  const headerFriend = header ? friends.find((f) => f.username === header.username) : undefined;

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
        {unreachable && (
          <div className="so-offline" role="alert">
            <span>{t("PatronLauncher sitesine ulaşılamadı. İnternet bağlantını kontrol et.")}</span>
            <button className="so-btn" onClick={loadAll}>
              {t("Yeniden dene")}
            </button>
          </div>
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
                  const ji = joinInfo(f);
                  return (
                    <li key={f.id} className={`so-row${f.blocked ? " is-blocked" : ""}`} onContextMenu={(e) => openMenu(e, f)}>
                      <Avatar p={f} presence={f.blocked ? undefined : f.presence} dim={f.blocked} />
                      <span className="so-meta">
                        <b>{f.displayUsername}</b>
                        <small className={!f.blocked && s.playing ? "playing" : ""}>{f.blocked ? t("Engellendi") : s.text}</small>
                      </span>
                      {ji && (
                        <button className="so-join" disabled={joining !== null} title={t("{name} sunucusuna katıl", { name: ji.server })} onClick={() => void join(f)}>
                          <Ico name="join" size={14} />
                          {joining === f.username ? t("Bağlanılıyor…") : t("Katıl")}
                        </button>
                      )}
                      {f.blocked && <span className="so-tag blocked">{t("Engellendi")}</span>}
                      {!f.blocked && f.muted && (
                        <span className="so-tag muted" title={t("Sessizde")}>
                          <Ico name="bellOff" size={12} />
                        </span>
                      )}
                      {!f.blocked && (
                        <button className="so-icon" title={t("Mesaj gönder")} aria-label={t("Mesaj gönder")} onClick={() => void openChat(f.username)}>
                          <Ico name="chat" />
                        </button>
                      )}
                      {moreButton(f)}
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
                    <Ico name="check" />
                  </button>
                  <button className="so-icon no" title={t("Reddet")} aria-label={t("Reddet")} onClick={() => void act("decline", p.username)}>
                    ✕
                  </button>
                  <button className="so-icon no" title={t("Engelle")} aria-label={t("Engelle")} onClick={() => confirmBlock(p)}>
                    <Ico name="block" />
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
                <li key={p.id} className="so-row is-blocked" onContextMenu={(e) => openMenu(e, p)}>
                  <Avatar p={p} dim />
                  <span className="so-meta">
                    <b>{p.displayUsername}</b>
                    {friends.some((f) => f.username === p.username) && <small>{t("Arkadaşın")}</small>}
                  </span>
                  <button className="so-btn" onClick={() => void act("unblock", p.username)}>
                    {t("Engeli kaldır")}
                  </button>
                </li>
              ))
            ) : (
              <li className="so-empty">{t("Engellenen kimse yok.")}</li>
            ))}
          {tab === "privacy" && !privacy && <li className="so-empty">{unreachable ? t("PatronLauncher sitesine ulaşılamadı. İnternet bağlantını kontrol et.") : t("Yükleniyor…")}</li>}
          {tab === "privacy" && privacy && (
            <li className="so-privacy">
              <p className="so-muted">{t("Sitede, launcher'da ve oyun içinde geçerlidir. Engellediğin oyuncular hiçbir şey göremez.")}</p>
              <PrivacyCard icon="chat" title={t("Kim mesaj atabilir")} text={t("Sana kimlerin özel mesaj gönderebileceğini seç.")} saved={savedKey === "dmPolicy"}>
                <Segmented label={t("Kim mesaj atabilir")} value={privacy.dmPolicy} options={policies} onChange={(v) => void savePrivacy("dmPolicy", v)} />
              </PrivacyCard>
              <PrivacyCard icon="eye" title={t("Çevrimiçi / oynadığımı kim görür")} text={t("Çevrimiçi olduğunu ve hangi sunucuda oynadığını kimlerin göreceğini seç.")} saved={savedKey === "presencePolicy"}>
                <Segmented label={t("Çevrimiçi / oynadığımı kim görür")} value={privacy.presencePolicy} options={policies} onChange={(v) => void savePrivacy("presencePolicy", v)} />
              </PrivacyCard>
              <PrivacyCard icon="userPlus" title={t("Kim arkadaşlık isteği gönderebilir")} text={t("Sana kimlerin arkadaşlık isteği gönderebileceğini seç.")} saved={savedKey === "friendPolicy"}>
                <Segmented
                  label={t("Kim arkadaşlık isteği gönderebilir")}
                  value={privacy.friendPolicy}
                  options={[
                    ["everyone", t("Herkes")],
                    ["nobody", t("Kimse")],
                  ]}
                  onChange={(v) => void savePrivacy("friendPolicy", v)}
                />
              </PrivacyCard>
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
                  <li key={c.username} className={`so-row click ${c.username === active ? "on" : ""}`} onClick={() => void openChat(c.username)} onContextMenu={(e) => openMenu(e, c)}>
                    <Avatar p={c} presence={f && !f.blocked ? f.presence : undefined} dim={f?.blocked} />
                    <span className="so-meta">
                      <b>{c.displayUsername}</b>
                      <small>{c.last ? `${c.last.from === "me" ? `${t("Sen")}: ` : ""}${c.last.body}` : ""}</small>
                    </span>
                    {c.muted && (
                      <span className="so-tag muted" title={t("Sessizde")}>
                        <Ico name="bellOff" size={12} />
                      </span>
                    )}
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
          <header onContextMenu={(e) => header && openMenu(e, header)}>
            {header ? (
              <>
                <Avatar p={header} presence={headerFriend && !headerFriend.blocked ? headerFriend.presence : undefined} dim={headerFriend?.blocked} />
                <span className="so-meta">
                  <b>{header.displayUsername}</b>
                  {headerFriend && (
                    <small className={!headerFriend.blocked && status(headerFriend.presence).playing ? "playing" : ""}>
                      {headerFriend.blocked ? t("Engellendi") : status(headerFriend.presence).text}
                    </small>
                  )}
                </span>
                {moreButton(header)}
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
            ) : iBlocked ? (
              <div className="so-cannot so-cannot-row">
                <span className="so-muted">{t("Bu oyuncuyu engelledin. Mesaj göndermek için engeli kaldır.")}</span>
                <button className="so-btn" onClick={() => void act("unblock", active)}>
                  {t("Engeli kaldır")}
                </button>
              </div>
            ) : (
              <p className="so-muted so-cannot">{t("Bu oyuncu yalnızca belirli kişilerden mesaj kabul ediyor.")}</p>
            ))}
        </div>
      </section>
      {menu && <ContextMenu at={menu.at} items={personMenu(menu.person)} close={closeMenu} variant={variant} />}
      {ask && <ConfirmDialog ask={ask} close={() => setAsk(null)} />}
    </div>
  );
}
