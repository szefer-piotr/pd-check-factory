import { useEffect, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { PipelineJobProvider } from "./jobs/PipelineJobContext";
import { canonicalizeAppHash, parseAppHash, type AppDestination } from "./pipeline/appRoute";
import { HomePage } from "./pages/HomePage";
import { GuidePage } from "./pages/GuidePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PipelineWorkspace } from "./PipelineApp";

function AppInner(): JSX.Element {
  const [destination, setDestination] = useState<AppDestination>(
    () => parseAppHash(window.location.hash).destination
  );

  useEffect(() => {
    const sync = (): void => {
      const canonical = canonicalizeAppHash(window.location.hash);
      if (canonical && window.location.hash !== canonical) {
        window.location.replace(canonical);
        return;
      }
      setDestination(parseAppHash(window.location.hash).destination);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  let content: JSX.Element;
  switch (destination) {
    case "pipeline":
      content = <PipelineWorkspace />;
      break;
    case "guide":
      content = <GuidePage />;
      break;
    case "history":
      content = <HistoryPage />;
      break;
    case "settings":
      content = <SettingsPage />;
      break;
    case "home":
    default:
      content = <HomePage />;
      break;
  }

  return <AppShell destination={destination}>{content}</AppShell>;
}

export default function App(): JSX.Element {
  return (
    <PipelineJobProvider>
      <AppInner />
    </PipelineJobProvider>
  );
}
