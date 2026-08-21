// Symbol-only branded loading motion, built from the actual Flow:er mark's
// geometry: four rounded squares that hold the twisted connecting band
// (the ribbon crossing through the center) only once they've drawn
// together. Structured as the mark's real geometric units -- four squares
// + the center band -- animating apart and back together, not an
// unrelated spinner.
//
// Motion: squares ease apart <-> together on a shared cubic-bezier (no
// bounce/spring), holding briefly at full merge with the band visible,
// then separating again. animation-direction: alternate means the same
// keyframe list plays forward (separate -> merge) then reverse
// (merge -> separate), so there's only one set of keyframes to keep in
// sync per element, and a user landing here via prefers-reduced-motion /
// the app's own Reduce Motion setting (see globals.css's
// [data-reduce-motion="true"] rule, which forces every animation to a
// single, near-instant iteration) settles on the COMPLETE merged symbol
// rather than scattered pieces.
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const HALF_CYCLE_S = 1.8; // full separate-merge-separate loop is 2x this

export function FlowerLoader({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`} role="status">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        className="text-foreground"
      >
        <g style={{ animation: `flower-loader-tl ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <rect x="6" y="6" width="40" height="40" rx="9" fill="currentColor" />
        </g>
        <g style={{ animation: `flower-loader-tr ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <rect x="54" y="6" width="40" height="40" rx="9" fill="currentColor" />
        </g>
        <g style={{ animation: `flower-loader-bl ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <rect x="6" y="54" width="40" height="40" rx="9" fill="currentColor" />
        </g>
        <g style={{ animation: `flower-loader-br ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <rect x="54" y="54" width="40" height="40" rx="9" fill="currentColor" />
        </g>
        {/* The connecting band -- two mirrored S-curves crossing through the
            center, the same twist the real mark's waist makes between
            diagonally opposite squares. Only ever visible once the squares
            have actually arrived at the merged position (see the opacity
            keyframes), so it never appears disconnected from the shapes it
            joins. */}
        <g style={{ animation: `flower-loader-band ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <path
            d="M 36,36 C 58,36 42,64 64,64"
            stroke="currentColor"
            strokeWidth="15"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M 64,36 C 42,36 58,64 36,64"
            stroke="currentColor"
            strokeWidth="15"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      </svg>
      <span className="sr-only">Loading</span>
      <style>{`
        @keyframes flower-loader-tl {
          0% { transform: translate(-18px, -18px); }
          70% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-tr {
          0% { transform: translate(18px, -18px); }
          70% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-bl {
          0% { transform: translate(-18px, 18px); }
          70% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-br {
          0% { transform: translate(18px, 18px); }
          70% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-band {
          0% { opacity: 0; }
          55% { opacity: 0; }
          70% { opacity: 1; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
