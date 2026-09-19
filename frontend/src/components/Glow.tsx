interface GlowProps {
  colorFrom: string;
  colorTo: string;
  className?: string;
  delaySeconds?: number;
}

/**
 * One large soft blurred gradient blob — pure CSS (radial-gradient + blur +
 * screen blend), never a raster asset. `className` positions/sizes it;
 * `.mirror-glow` (src/index.css) handles the blur/blend/pulse.
 */
export function Glow({ colorFrom, colorTo, className = "", delaySeconds = 0 }: GlowProps) {
  return (
    <div
      aria-hidden="true"
      className={`mirror-glow ${className}`}
      style={{
        background: `radial-gradient(circle at 40% 40%, ${colorFrom}, ${colorTo} 70%)`,
        animationDelay: `${delaySeconds}s`,
      }}
    />
  );
}
