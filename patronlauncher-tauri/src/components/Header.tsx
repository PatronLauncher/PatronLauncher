import AccountSwitcher from "./AccountSwitcher";
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
  const appearance = useAppearance();
  const enabled = !s.busy && !s.load_failed;
  return (
    <div className="top">
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
      <AccountSwitcher s={s} run={run} manage={() => go("account")} />
      </div>
    </div>
  );
}
