import { MIRROR_DATA_URL } from "./config";
import { useMirrorData } from "./hooks/useMirrorData";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { GraphBackground } from "./components/GraphBackground";
import { VerdictTable } from "./components/VerdictTable";
import { BedrockBanner } from "./components/BedrockBanner";
import { LoadingState } from "./components/LoadingState";
import { ErrorState } from "./components/ErrorState";
import { PlaceholderState } from "./components/PlaceholderState";

export default function App() {
  const { status, data, error } = useMirrorData(MIRROR_DATA_URL);

  if (status === "placeholder") return <PlaceholderState />;
  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message={error ?? "unknown error"} />;

  const results = data?.results ?? [];

  return (
    <div className="relative min-h-screen">
      <GraphBackground results={results} />
      <Nav />
      <Hero />
      {data?.bedrock_summary && <BedrockBanner summary={data.bedrock_summary} />}
      <VerdictTable results={results} />
    </div>
  );
}
