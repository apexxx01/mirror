import { lazy, Suspense } from "react";
import { MIRROR_DATA_URL } from "./config";
import { useMirrorData } from "./hooks/useMirrorData";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { VerdictTable } from "./components/VerdictTable";
import { BedrockBanner } from "./components/BedrockBanner";
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

  return (
    <div className="relative min-h-screen">
      <Suspense fallback={<div className="fixed inset-0 -z-10 bg-void" />}>
        <GraphBackground results={results} />
      </Suspense>
      <Nav />
      <Hero />
      {data?.bedrock_summary && <BedrockBanner summary={data.bedrock_summary} />}
      <VerdictTable results={results} />
    </div>
  );
}
