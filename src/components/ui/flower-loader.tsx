// Symbol-only branded loading motion, built from the real Flow:er mark's
// exact vector geometry (extracted from the brand's source SVG). The final
// held state is always the pixel-exact merged mark -- nothing about the
// path data is redrawn or approximated, only clipped/transformed as rigid
// pieces.
//
// The mark's own artwork is three paths, not four independent squares: the
// NW and SE corner shapes are already fused into one continuous outline by
// the connecting band, while NE and SW are separate, freestanding rounded
// squares. To read as "four small fragments organizing into one system,
// with the center connection forming last," the fused NW-band-SE path is
// further split -- via two overlapping SVG clipPath rects, not new
// geometry -- into an NW half and an SE half. Rendered together at rest
// they exactly reconstruct the original unclipped path (the clip rects
// overlap generously through the middle, so there's no seam), which is
// what makes the "held" state pixel-faithful even though it's assembled
// from four animated pieces instead of the source's three static ones.
//
// Choreography (one shared timeline, alternate direction for the loop):
//   0%   fragments -- all four pieces small and pulled apart
//   ~40% the NE/SW squares have already arrived: two of the four main
//        units are in place
//   ~42% the NW/SE ribbon-halves have closed most of the gap but not all
//        of it -- four units are clustered, but not yet one connected
//        shape
//   ~78% the ribbon-halves finish sealing together -- the center
//        connection/curve completes, the mark reads as whole
//   78-100% hold on the exact, complete symbol
// `animation-direction: alternate` then plays this in reverse for the
// release, so there's one keyframe list per element to keep in sync, and
// a user landing here via prefers-reduced-motion / the app's own Reduce
// Motion setting (globals.css's [data-reduce-motion="true"] rule, which
// forces every animation to a single near-instant iteration) settles on
// the complete merged symbol, not scattered fragments.
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const HALF_CYCLE_S = 2.2; // full fragments-merge-fragments loop is 2x this

const RIBBON_PATH_D =
  "M 216.257812 99.144531 C 256.113281 96.21875 303 100.269531 343.949219 100.164062 C 401.03125 100.023438 445.023438 96.085938 479.441406 151.09375 C 514.109375 206.507812 483.933594 323.929688 498.644531 393.183594 C 513.863281 464.8125 573.289062 533.152344 641.503906 559.355469 C 704.421875 583.523438 803.515625 566.828125 872.394531 572.257812 C 920.824219 576.074219 962.382812 619.375 968.347656 666.902344 C 964.957031 724.792969 972.933594 787.933594 968.417969 845.199219 C 964.84375 890.5 928.953125 931.203125 885.070312 941.554688 C 859.101562 947.675781 836.695312 943.949219 811.109375 943.753906 C 770.226562 943.4375 721.378906 947.324219 681.683594 943.789062 C 631.828125 939.347656 590.46875 892.804688 586.949219 843.84375 C 580.210938 750.058594 607.222656 662.785156 553.519531 577.863281 C 522.304688 528.503906 456.953125 478.394531 397.058594 474.269531 C 335.34375 470.023438 266.941406 478.332031 206.496094 472.789062 C 158.484375 468.390625 116.585938 422.832031 111.679688 375.648438 C 115.011719 317.914062 108.558594 254.417969 112.972656 197.351562 C 117.191406 142.800781 163.109375 103.042969 216.257812 99.144531 ";

export function FlowerLoader({ size = 52, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`} role="status">
      <svg
        width={size}
        height={size}
        viewBox="0 0 1080 1080"
        fill="none"
        aria-hidden="true"
        className="text-foreground"
      >
        <defs>
          {/* The two clip rects overlap through the middle (350-730 on both
              axes) so the NW-half and SE-half reconstruct the ribbon path
              with no seam once both are at rest. */}
          <clipPath id="fl-clip-nw" clipPathUnits="userSpaceOnUse">
            <rect x="0" y="0" width="730" height="730" />
          </clipPath>
          <clipPath id="fl-clip-se" clipPathUnits="userSpaceOnUse">
            <rect x="350" y="350" width="730" height="730" />
          </clipPath>
        </defs>

        {/* NW half of the ribbon (the NW corner blob + most of the band). */}
        <g style={{ animation: `flower-loader-nw ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <g clipPath="url(#fl-clip-nw)">
            <path fill="currentColor" d={RIBBON_PATH_D} />
          </g>
        </g>

        {/* SE half of the ribbon (the SE corner blob + the rest of the band). */}
        <g style={{ animation: `flower-loader-se ${HALF_CYCLE_S}s ${EASE} infinite alternate` }}>
          <g clipPath="url(#fl-clip-se)">
            <path fill="currentColor" d={RIBBON_PATH_D} />
          </g>
        </g>

        {/* NE square -- standalone in the real mark. */}
        <g
          style={{
            animation: `flower-loader-ne ${HALF_CYCLE_S}s ${EASE} infinite alternate`,
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        >
          <path
            fill="currentColor"
            d="M 936.5625 129.15625 C 983.03125 173.296875 969.953125 233.902344 969.664062 291.230469 C 969.417969 340.277344 980.082031 385.617188 948.46875 427.910156 C 931.425781 450.710938 901.066406 469.238281 872.324219 471.582031 C 811.5625 476.542969 744.410156 467.875 682.972656 471.65625 C 608.195312 460.34375 584.917969 408.714844 585.585938 338.871094 C 585.992188 296.074219 584.128906 246.121094 586.949219 204.148438 C 590.601562 149.769531 631.71875 106.46875 685.769531 100.121094 C 745.976562 103.039062 809.914062 96.171875 869.679688 100.042969 C 893.304688 101.574219 919.382812 112.839844 936.5625 129.15625 "
          />
        </g>

        {/* SW square -- standalone in the real mark. */}
        <g
          style={{
            animation: `flower-loader-sw ${HALF_CYCLE_S}s ${EASE} infinite alternate`,
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        >
          <path
            fill="currentColor"
            d="M 206.71875 572.703125 C 267.726562 566.496094 337.625 576.375 399.550781 572.480469 C 437.859375 577.105469 473.121094 604.195312 487.253906 639.988281 C 497.292969 665.410156 494.21875 688.332031 494.328125 714.453125 C 494.507812 755.949219 497.96875 807.59375 494.363281 847.851562 C 489.539062 901.726562 442.542969 940.429688 390.179688 943.796875 C 348.1875 946.496094 302.128906 942.058594 259.371094 942.382812 C 208.339844 942.773438 173.25 947.550781 136.839844 904.363281 C 107.5625 869.640625 112.789062 836.382812 113.078125 794.855469 C 113.359375 753.984375 109.839844 706.746094 112.972656 666.835938 C 116.703125 619.253906 159.632812 577.496094 206.71875 572.703125 "
          />
        </g>
      </svg>
      <span className="sr-only">Loading</span>
      <style>{`
        @keyframes flower-loader-nw {
          0% { transform: translate(-56px, -56px); }
          42% { transform: translate(-14px, -14px); }
          78% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-se {
          0% { transform: translate(56px, 56px); }
          42% { transform: translate(14px, 14px); }
          78% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes flower-loader-ne {
          0% { transform: translate(88px, -88px) scale(0.78); }
          40% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes flower-loader-sw {
          0% { transform: translate(-88px, 88px) scale(0.78); }
          40% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(0, 0) scale(1); }
        }
      `}</style>
    </div>
  );
}
