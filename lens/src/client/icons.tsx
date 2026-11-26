// Lens's few icons, drawn in one hand: 1.5 px strokes on a 16 grid, currentColor.
import type { SVGProps } from "react";

const I = (d: string, extra?: (p: SVGProps<SVGSVGElement>) => any) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <path d={d} />
    {extra?.(p)}
  </svg>
);

export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" aria-hidden {...p}>
    <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
  </svg>
);
export const Pause = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" aria-hidden {...p}>
    <rect x="4" y="3" width="2.6" height="10" rx="0.8" fill="currentColor" />
    <rect x="9.4" y="3" width="2.6" height="10" rx="0.8" fill="currentColor" />
  </svg>
);
export const Sun = I("M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1", () => <circle cx="8" cy="8" r="2.8" />);
export const Moon = I("M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z");
export const Back = I("M10 3 5 8l5 5");
export const Close = I("M4 4l8 8M12 4l-8 8");
export const Search = I("M10.6 10.6 14 14", () => <circle cx="7" cy="7" r="4.6" />);
export const Fit = I("M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3");
export const Step = I("M4 3v10M7 8l5-5v10Z");
export const Keyboard = I("M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6");
export const External = I("M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5H3V4h3.5");
export const Mark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden {...p}>
    <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <circle cx="16" cy="16" r="4.2" fill="currentColor" />
  </svg>
);
