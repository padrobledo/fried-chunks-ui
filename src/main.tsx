import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import App from "./App";
import "./styles.css";

let pwaRegistration: ServiceWorkerRegistration | undefined;

registerSW({
  immediate: true,
  onRegisteredSW(_serviceWorkerUrl, registration) {
    pwaRegistration = registration;
  },
});

function checkForPwaUpdate() {
  void pwaRegistration?.update();
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) checkForPwaUpdate();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForPwaUpdate();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
