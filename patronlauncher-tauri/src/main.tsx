import { createRoot } from "react-dom/client";
import App from "./App";
import { AppearanceProvider } from "./appearance";
import "./styles/prototype.css";
import "./styles/window.css";
import "./styles/brand.css";
createRoot(document.getElementById("root")!).render(<AppearanceProvider><App /></AppearanceProvider>);

import "./styles/integration.css";
import "./styles/profiles.css";

import "./styles/themes.css";
import "./styles/redesign.css";
import "./styles/home.css";
import "./styles/curseforge.css";
import "./styles/polish.css";
import "./styles/music.css";
import "./styles/java.css";
import "./styles/pclient.css";
import "./styles/selection.css";

// Sağ tık menüsü (Kopyala, Yenile, İncele…) yalnızca yazı kutularında ve sohbet mesajlarında açılır.
const SELECTABLE = "input, textarea, [contenteditable=true], .so-msg p, .pa-code, .selectable";
document.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest(SELECTABLE)) e.preventDefault();
});
// Arayüz öğeleri (görsel, bağlantı, düğme) fareyle sürüklenmez.
document.addEventListener("dragstart", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest(SELECTABLE)) e.preventDefault();
});
