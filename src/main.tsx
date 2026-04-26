
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.info("KoK service worker registration failed", error);
      });
    });
  }

  registerServiceWorker();
  createRoot(document.getElementById("root")!).render(<App />);
