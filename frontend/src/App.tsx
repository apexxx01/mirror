import { lazy, Suspense } from "react";
import { MIRROR_DATA_URL } from "./config";
import { useMirrorData } from "./hooks/useMirrorData";
import { countByVerdict } from "./lib/statCounts";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { FeatureLegend } from "./components/FeatureLegend";
import { AccountSignals } from "./components/AccountSignals";
import { VerdictTable } from "./components/VerdictTable";
import { BedrockBanner } from "./components/BedrockBanner";
import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { ChatInvite, MirrorChat } from "./components/MirrorChat";
import { Footer } from "./components/Footer";
import { LoadingState } from "./components/LoadingState";
import { ErrorState } from "./components/ErrorState";
import { PlaceholderState } from "./components/PlaceholderState";

// Three.js + @react-three/fiber are not needed to render the hero, nav, or
// verdict table, so GraphBackground (a purely decorative background) is
// split into its own chunk and streamed in after first paint. The Suspense
// fallback matches the plain void div GraphBackground itself renders for the
// no-WebGL case, so there's no visible transition either way.
const GraphBackground = lazy(() =>
  import("./components/GraphBackground").then((m) => ({ default: m.GraphBackground }))
);

export default function App() {
  const { status, data, error } = useMirrorData(MIRROR_DATA_URL);

  if (status === "placeholder") return <PlaceholderState />;
  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message={error ?? "unknown error"} />;

  const results = data?.results ?? [];
  const counts = countByVerdict(results);
  const hasFullStory = Boolean(data?.bedrock_summary);

  return (
    <div className="relative min-h-screen">
      {/*
        Fixed atmosphere, stacked behind everything: the 64px structural
        grid, film grain so no flat black reads as dead, and the halftone
        bloom. All three are decorative, pointer-events:none, and defined
        in index.css.
      */}
      <div className="mirror-grid" />
      <div className="mirror-grain" />
      <div className="mirror-halftone" />
      <Suspense fallback={<div className="fixed inset-0 -z-10 bg-void" />}>
        <GraphBackground results={results} />
      </Suspense>

      <Nav hasFullStory={hasFullStory} />

      {/*
        Composition order is the argument: the claim (Hero), the key that
        makes the claim readable (FeatureLegend), the scale of the account
        (AccountSignals), the one place Mirror hard-stops (KillSwitchBanner —
        the page's single full-bleed detonation, deliberately interrupting the
        hairline rhythm), the model's read of it (BedrockBanner), and then the
        per-resource proof (VerdictTable).
      */}
      <main>
        <Hero counts={counts} total={results.length} />
        <FeatureLegend />
        {/* In-page doorway to MirrorChat (which itself lives in fixed chrome
            below) — the legend teaches the signals, this offers to answer
            questions about them from the same real payload. */}
        <ChatInvite total={results.length} />
        <AccountSignals results={results} />
        <KillSwitchBanner results={results} />
        {data?.bedrock_summary && <BedrockBanner summary={data.bedrock_summary} />}
        <VerdictTable results={results} />
      </main>

      <Footer />
      {data && <MirrorChat payload={data} />}
    </div>
  );
}
