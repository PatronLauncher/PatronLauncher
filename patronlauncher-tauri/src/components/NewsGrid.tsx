import { t } from "../i18n";
import type { Article, Snapshot } from "../types/core";
import type { Run } from "../backend";
import type { CSSProperties } from "react";
export default function NewsGrid({
  articles,
  s,
  run,
}: {
  articles: Article[];
  s: Snapshot;
  run: Run;
}) {
  return (
    <>
      <h3>
        {t("Son haberler")}
        {articles.length > 0 && <small className="lbl">({articles.length})</small>}
      </h3>
      <div className="lbl">{t("Resmi Minecraft duyuruları · Haberler kaynak dilinde gösterilir")}</div>
      {articles.length === 0 ? (
        <div className="empty">
          {s.news_loading
            ? t("Haberler getiriliyor…")
            : s.news_error
              ? t("Haberlere şu anda ulaşılamıyor. İnternet bağlantını kontrol edip yeniden dene.")
              : t("Henüz gösterilecek haber yok.")}
          <button
            className="btn"
            disabled={s.news_loading}
            onClick={() => void run("get_news", { refresh: true })}
          >{t("Yenile")}</button>
        </div>
      ) : (
        <div className="news">
          {articles.slice(0, 6).map((n, i) => (
            <article
              className="nc"
              key={n.url}
              style={{ "--i": i } as CSSProperties}
              tabIndex={0}
              role="link"
              onClick={() => void run("open_external", { url: n.url })}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  void run("open_external", { url: n.url });
              }}
            >
              <div className="art">
                {n.image ? (
                  <i
                    style={{
                      backgroundImage: `url("${n.image}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <i />
                )}
              </div>
              <div className="nb">
                <div className="r">
                  <b>MINECRAFT</b>
                  <span>{n.date}</span>
                </div>
                <h4>{n.title}</h4>
                <span>{t("Haberi oku →")}</span>
              </div>
            </article>
          ))}
        </div>
      )}
      {s.news_error && articles.length > 0 && (
        <div className="lbl">{t("Haberler yenilenemedi; mevcut liste gösteriliyor.")}</div>
      )}
    </>
  );
}
