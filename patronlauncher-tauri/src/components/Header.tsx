import { useState } from "react";
import Modal from "./Modal";
import { Select } from "./Controls";
import { titles, type Page } from "../navigation";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { useAppearance } from "../appearance";
import Icon from "./Icon";
import { t as tr } from "../i18n";
export default function Header({
  page,
  s,
  run,
  go,
}: {
  page: Page;
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
}) {
  const t = titles[page];
  const [menu, setMenu] = useState(false),
    [logout, setLogout] = useState(false);
  const selected = s.accounts.find((a) => a.id === s.selected_account);
  const appearance = useAppearance();
  const enabled = !s.busy && !s.load_failed;
  return (
    <div className="top">
      {menu && (
        <Modal title={tr("Hesaplar")} close={() => setMenu(false)}>
          <p>{selected?.name}</p>
          <button
            className="btn"
            onClick={() => {
              go("account");
              setMenu(false);
            }}
          >
            {tr("Hesap değiştir / yönet")}
          </button>
          <button
            className="btn"
            disabled={!selected || s.busy}
            onClick={() => setLogout(true)}
          >
            {tr("Çıkış yap")}
          </button>
          {logout && (
            <div>
              <p>{tr("Seçili hesabın launcher oturumunu kaldırmak istiyor musun?")}</p>
              <button
                className="btn"
                onClick={async () => {
                  if (selected)
                    await run("remove_account", { id: selected.id });
                  setMenu(false);
                }}
              >
                {tr("Çıkışı onayla")}
              </button>
            </div>
          )}
          <button className="btn" disabled>
            {tr("PatronLauncher hesabı · Yakında")}
          </button>
        </Modal>
      )}
      <div className="top-title" key={page}>
        <h1>{tr(t[0])}</h1>
        <p>{tr(t[1])}</p>
      </div>
      <div className="top-actions">
      <button
        className={`btn ${s.busy && !s.running ? "spin" : ""}`}
        id="rf"
        title={tr("Yenile")}
        disabled={!enabled}
        onClick={() => void run("list_versions", { refresh: true })}
      >
        <Icon name="refresh" />
      </button>
      <button
        className="btn"
        title={tr("Oyun klasörünü aç")}
        disabled={s.busy || s.load_failed || !s.selected_profile}
        onClick={() => void run("open_folder", { target: "profile" })}
      >
        <Icon name="folder" />
      </button>
      <button
        className="btn appearance-open"
        onClick={appearance.open}
        aria-label={tr("Görünüm")}
        title={tr("Görünüm")}
      >
        <Icon name="palette" />
      </button>
      {selected?.kind === "Microsoft" ? (
        <button
          className="btn account-avatar"
          aria-label={tr("Hesap menüsü")}
          onClick={() => setMenu(true)}
        >
          <span>{selected.name.slice(0, 2).toLocaleUpperCase("tr")}</span>
          {selected.name}
        </button>
      ) : (
        <button
          className="btn top-ms"
          disabled={!enabled}
          aria-label={tr("Microsoft hesabını bağla")}
          onClick={() => {go("account");void run("microsoft_login",{});}}
        >
          <Icon name="account" /> <span>{tr("Microsoft ile giriş yap")}</span>
        </button>
      )}
      {s.accounts.length > 0 ? (
        <Select
          icon={
            <span>
              {selected?.name.slice(0, 2).toLocaleUpperCase("tr") ?? "◇"}
            </span>
          }
          className="account-picker"
          disabled={!enabled}
          aria-label={tr("Hesap seç")}
          value={s.selected_account ?? ""}
          onChange={(e) => void run("select_account", { id: e.target.value })}
        >
          <option value="" disabled>
            {tr("Hesap seç")}
          </option>
          {s.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.kind === "Local" ? tr("Yerel") : "Microsoft"}
            </option>
          ))}
        </Select>
      ) : (
        <button className="btn" onClick={() => go("account")}>
          {tr("Hesap ekle")}
        </button>
      )}
      </div>
    </div>
  );
}
