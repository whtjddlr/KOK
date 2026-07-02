
  import { lazy, Suspense } from "react";
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  const LandingPage = lazy(() =>
    import("./app/components/LandingPage.tsx").then((module) => ({
      default: module.LandingPage,
    })),
  );
  const InvitePage = lazy(() =>
    import("./app/components/InvitePage.tsx").then((module) => ({
      default: module.InvitePage,
    })),
  );

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

  function getRootComponent() {
    const path = window.location.pathname.replace(/\/+$/, "");

    if (path === "/landing" || path === "/about") {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-[#f8fbf7] text-[#17233c]">
              <div className="kok-route-loader">
                <span />
              </div>
            </div>
          }
        >
          <LandingPage />
        </Suspense>
      );
    }

    if (path === "/invite") {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-[#f8fbf7] text-[#17233c]">
              <div className="kok-route-loader">
                <span />
              </div>
            </div>
          }
        >
          <InvitePage />
        </Suspense>
      );
    }

    return <App />;
  }

  registerServiceWorker();
  createRoot(document.getElementById("root")!).render(getRootComponent());
