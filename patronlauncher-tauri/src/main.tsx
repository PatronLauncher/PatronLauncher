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
import "./styles/pclient.css";
