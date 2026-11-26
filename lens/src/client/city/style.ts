// The map's own styles, scoped under .lens-city. Colours come from the shell's tokens when it sets them
// (docs/design/lens.md section 4), with the brief's values as the fallback.
export const CITY_CSS = `
.lens-city {
  --lc-ink: var(--ink, #0b0f17); --lc-panel: var(--panel, #111723); --lc-panel2: var(--panel-2, #161d2b);
  --lc-hair: var(--line, #ffffff14); --lc-text: var(--text, #e8e6e1); --lc-muted: var(--muted, #9aa3b2);
  --lc-seat: #f2b44b; --lc-flag: #f0647a;
  --lc-ui: var(--font-sans, "Inter Variable", Inter, system-ui, -apple-system, sans-serif);
  --lc-serif: var(--font-serif, "Fraunces Variable", Fraunces, Georgia, serif);
  --lc-mono: var(--font-mono, "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace);
  position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--lc-ink); color: var(--lc-text);
  font-family: var(--lc-ui); font-size: 12.5px; font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased;
}
.lens-city * { box-sizing: border-box; }
.lens-city .lc-wrap { position: absolute; inset: 0; transition: background 1.2s linear; }
.lens-city .lc-haze { position: absolute; inset: 0; pointer-events: none; transition: opacity .3s; }
.lens-city .lc-follow { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); border: 1px solid var(--lc-hair);
  background: color-mix(in srgb, var(--lc-panel) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  color: var(--lc-text); font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 16px; cursor: pointer; z-index: 3; }
.lens-city .lc-follow.on { border-color: color-mix(in srgb, var(--lc-seat) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lc-seat) 14%, transparent); }
.lens-city .lc-vignette { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(5,7,12,.55) 100%); }
.lens-city .lc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 12px;
  color: var(--lc-muted); font-family: var(--lc-serif); font-size: 18px; letter-spacing: .01em; }
.lens-city .lc-err { color: var(--lc-flag); font-family: var(--lc-ui); font-size: 13px; }
.lens-city .lc-spin { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--lc-hair); border-top-color: var(--lc-seat); animation: lc-spin 1s linear infinite; }
@keyframes lc-spin { to { transform: rotate(360deg); } }

.lens-city .lc-clock { position: absolute; top: 12px; left: 12px; pointer-events: none; z-index: 2; padding: 10px 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--lc-ink) 62%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--lc-hair); color: var(--lc-text); }
.lens-city .lc-wrap.light .lc-clock { background: color-mix(in srgb, var(--panel, #f3f0e8) 78%, transparent); text-shadow: none; }
.lens-city .lc-clock-time { font-family: var(--lc-serif); font-size: 34px; line-height: 1; font-weight: 400; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.lens-city .lc-clock-sub { display: flex; align-items: center; gap: 8px; margin-top: 6px; color: var(--lc-muted); font-size: 12px; }
.lens-city .lc-clock-place { margin-top: 2px; color: var(--lc-muted); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .7; }
.lens-city .lc-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--lc-muted); opacity: .6; }

.lens-city .lc-panel { position: absolute; right: 14px; top: 14px; width: 292px; max-height: calc(100% - 28px); display: flex; flex-direction: column;
  background: color-mix(in srgb, var(--lc-panel) 86%, transparent); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid var(--lc-hair); border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.35); overflow: hidden; }
.lens-city .lc-panel.closed { width: auto; }
.lens-city .lc-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 6px 6px 8px; gap: 6px; }
.lens-city .lc-panel.closed .lc-panel-head { padding: 4px; }
.lens-city .lc-panel-body { overflow-y: auto; padding: 0 14px 12px; }
.lens-city .lc-ghost { background: none; border: 0; color: var(--lc-text); font: inherit; font-weight: 550; padding: 6px 8px; border-radius: 7px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.lens-city .lc-ghost:hover { background: #ffffff0d; }
.lens-city .lc-ghost + .lc-ghost { color: var(--lc-muted); font-weight: 450; }
.lens-city .lc-chev { color: var(--lc-muted); font-size: 10px; }
.lens-city .lc-section { border-top: 1px solid var(--lc-hair); padding: 10px 0 10px; }
.lens-city .lc-section.off .lc-sec-title { color: var(--lc-muted); }
.lens-city .lc-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lens-city .lc-sec-title { font-weight: 560; letter-spacing: .005em; }
.lens-city .lc-legend { margin-top: 8px; display: grid; gap: 4px; }
.lens-city .lc-legend.cols { grid-template-columns: 1fr 1fr; column-gap: 10px; }
.lens-city .lc-row { display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 8px; color: var(--lc-text); text-transform: none; }
.lens-city .lc-legend.cols .lc-row { grid-template-columns: 14px 1fr; text-transform: capitalize; }
.lens-city .lc-row.muted, .lens-city .muted { color: var(--lc-muted); }
.lens-city .lc-num { font-family: var(--lc-mono); font-size: 11.5px; color: var(--lc-muted); }
.lens-city .lc-sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: transparent; flex: none; }
.lens-city .lc-sw.dot { width: 7px; height: 7px; border-radius: 50%; margin-left: 1.5px; }
.lens-city .lc-sw.line { height: 3px; width: 14px; border-radius: 2px; }
.lens-city .lc-note { margin-top: 8px; color: var(--lc-muted); font-size: 11.5px; line-height: 1.45; }
.lens-city .lc-note.rose { color: var(--lc-flag); }
.lens-city .lc-switch { width: 28px; height: 16px; border-radius: 9px; border: 0; padding: 0; background: #ffffff1f; position: relative; cursor: pointer; transition: background .2s; flex: none; }
.lens-city .lc-switch span { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #cfd3da; transition: transform .2s, background .2s; }
.lens-city .lc-switch.on { background: color-mix(in srgb, var(--lc-seat) 55%, #2a2f3a); }
.lens-city .lc-switch.on span { transform: translateX(12px); background: #fff7e6; }
.lens-city .lc-seg { display: inline-flex; background: #ffffff0d; border-radius: 7px; padding: 2px; }
.lens-city .lc-seg button { border: 0; background: none; color: var(--lc-muted); font: inherit; font-size: 11.5px; padding: 3px 8px; border-radius: 5px; cursor: pointer; }
.lens-city .lc-seg button.on { background: #ffffff1a; color: var(--lc-text); }
.lens-city .lc-ramp { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #7e8fa6, #d9c08a, #d0603a); }
.lens-city .lc-ramp-l { display: flex; justify-content: space-between; gap: 8px; color: var(--lc-muted); font-size: 11px; }
.lens-city .lc-ramp-l span:nth-child(2) { text-align: center; }
.lens-city code { font-family: var(--lc-mono); font-size: 10.5px; }
.lens-city .lc-check { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--lc-hair); padding-top: 10px; color: var(--lc-muted); cursor: pointer; }
.lens-city .lc-check input { accent-color: var(--lc-seat); }

.lens-city .lc-tip, .lens-city .lc-card { background: color-mix(in srgb, var(--lc-panel2) 94%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--lc-hair); border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,.45); padding: 11px 13px; }
.lens-city .lc-tip { position: absolute; pointer-events: none; max-width: 300px; z-index: 5; }
.lens-city .lc-card { position: absolute; left: 16px; bottom: 16px; width: 330px; max-width: calc(100% - 32px); max-height: 46%; overflow-y: auto; border-color: color-mix(in srgb, var(--lc-seat) 30%, transparent); }
.lens-city .lc-x { position: absolute; top: 6px; right: 8px; border: 0; background: none; color: var(--lc-muted); font-size: 18px; cursor: pointer; }
.lens-city .lc-tip-title { font-family: var(--lc-serif); font-size: 16px; line-height: 1.2; font-weight: 500; padding-right: 14px; }
.lens-city .lc-tip-sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; color: var(--lc-muted); font-size: 11.5px; text-transform: none; }
.lens-city .lc-mono { font-family: var(--lc-mono); font-size: 10.5px; color: var(--lc-muted); margin-left: auto; }
.lens-city .lc-dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 9px 0 0; font-size: 12px; }
.lens-city .lc-dl dt { color: var(--lc-muted); }
.lens-city .lc-dl dd { margin: 0; }
.lens-city .lc-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.lens-city .lc-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 5px; border-radius: 10px; background: #ffffff0d; font-family: var(--lc-mono); font-size: 10.5px; }
.lens-city .lc-pill { margin-left: 6px; padding: 1px 6px; border-radius: 8px; font-size: 10.5px; background: #ffffff12; }
.lens-city .lc-pill.applied { color: #9fe0b0; } .lens-city .lc-pill.refused { color: var(--lc-flag); }
.lens-city .lc-quote { margin-top: 8px; padding-left: 9px; border-left: 2px solid color-mix(in srgb, var(--lc-seat) 60%, transparent); color: #d9d6cf; font-size: 12px; line-height: 1.45; white-space: pre-line; max-height: 9em; overflow: hidden; }

.lens-city .lc-short { display: none; }
.lens-city .lc-rowbtn { width: 100%; border: 0; background: none; font: inherit; text-align: left; padding: 1px 0; cursor: pointer; }
.lens-city .lc-rowbtn.off { color: var(--lc-muted); }
.lens-city .lc-tour { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(620px, calc(100% - 32px)); z-index: 4;
  background: color-mix(in srgb, var(--lc-panel) 90%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--lc-hair); border-top: 2px solid var(--lc-seat); border-radius: 14px; padding: 16px 20px 12px; box-shadow: 0 18px 50px rgba(0,0,0,.45);
  animation: lc-rise .5s ease-out; }
.lens-city .lc-tour.tone-flag { border-top-color: var(--lc-flag); }
.lens-city .lc-tour.tone-election { border-top-color: #b48cf2; }
@keyframes lc-rise { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
.lens-city .lc-tour-kicker { display: flex; gap: 8px; align-items: center; color: var(--lc-muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.lens-city .lc-tour-title { font-family: var(--lc-serif); font-size: 20px; line-height: 1.25; margin-top: 6px; }
.lens-city .lc-tour-words { font-family: var(--lc-serif); font-style: italic; font-size: 14.5px; line-height: 1.5; margin-top: 8px; color: color-mix(in srgb, var(--lc-text) 88%, transparent); max-height: 7.5em; overflow: hidden; }
.lens-city .lc-tour-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px; }
.lens-city .lc-tour-dots { display: flex; gap: 5px; flex-wrap: wrap; }
.lens-city .lc-tour-dots button { width: 7px; height: 7px; border-radius: 50%; border: 0; padding: 0; background: #ffffff2a; cursor: pointer; }
.lens-city .lc-tour-dots button.on { background: var(--lc-seat); transform: scale(1.3); }
.lens-city .lc-tour-dots button.tone-flag.on { background: var(--lc-flag); }
.lens-city .lc-tour-ctl { display: flex; gap: 4px; }
.lens-city .lc-tour-ctl button { border: 1px solid var(--lc-hair); background: #ffffff0a; color: var(--lc-text); font: inherit; font-size: 12px; border-radius: 7px; padding: 3px 10px; cursor: pointer; }
.lens-city .lc-wrap.light .lc-tour { background: color-mix(in srgb, var(--panel, #f3f0e8) 92%, transparent); }
.lens-city .lc-pane-label { position: absolute; top: 112px; left: 12px; z-index: 3; padding: 5px 12px; border-radius: 14px;
  background: color-mix(in srgb, var(--lc-panel) 84%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--lc-hair);
  font-family: var(--lc-serif); font-size: 14px; pointer-events: none; white-space: nowrap; }
.lens-city .lc-pane-label.bare { top: 12px; }
.lens-city .lc-diff { position: absolute; left: 12px; bottom: 12px; z-index: 3; display: grid; gap: 3px; padding: 9px 12px; border-radius: 10px; font-size: 11.5px;
  background: color-mix(in srgb, var(--lc-panel) 88%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--lc-hair); color: var(--lc-text); }
.lens-city .lc-diff b { font-weight: 600; margin-bottom: 2px; }
.lens-city .lc-diff span { display: flex; align-items: center; gap: 7px; color: var(--lc-muted); }
.lens-city .lc-diff .sw { display: inline-block; width: 12px; height: 8px; }
.lens-city .lc-diff .sw.arc { border-top: 2px solid #bea0ff; border-radius: 8px 8px 0 0; }
.lens-city .lc-diff .sw.dot { width: 8px; border-radius: 50%; background: #e8c46a; border: 1px solid #fff; }
.lens-city .lc-diff .sw.ring { width: 8px; border-radius: 50%; border: 1.5px solid #e8c46a; }
.lens-city .lc-mini { position: absolute; right: 14px; bottom: 14px; z-index: 3; border-radius: 8px; border: 1px solid var(--lc-hair);
  box-shadow: 0 8px 24px rgba(0,0,0,.4); cursor: crosshair; touch-action: none; }
.lens-city.lc-insp { position: static; height: auto; background: transparent; overflow: visible; }
.lens-city .lc-today { display: grid; gap: 3px; margin-top: 4px; }
.lens-city .lc-today .lc-row { font-size: 12px; }
@media (max-width: 640px) {
  .lens-city { font-size: 13.5px; }
  .lens-city .lc-clock { top: 8px; left: 8px; padding: 7px 10px; }
  .lens-city .lc-clock-time { font-size: 24px; }
  .lens-city .lc-clock-place { display: none; }
  .lens-city .lc-clock-sub { font-size: 11.5px; margin-top: 4px; }
  /* Layers: a pill at the top right; open, a bottom sheet. */
  .lens-city .lc-panel.closed { right: 8px; top: 8px; }
  .lens-city .lc-long { display: none; }
  .lens-city .lc-short { display: inline; }
  .lens-city .lc-panel.closed .lc-ghost { padding: 7px 7px; }
  .lens-city .lc-panel:not(.closed) { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 64%; border-radius: 16px 16px 0 0; z-index: 6;
    border-bottom: 0; box-shadow: 0 -12px 40px rgba(0,0,0,.45); padding-bottom: env(safe-area-inset-bottom); }
  .lens-city .lc-panel:not(.closed) .lc-panel-head::before { content: ""; position: absolute; left: 50%; top: 6px; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--lc-hair); }
  .lens-city .lc-panel:not(.closed) .lc-panel-head { position: relative; padding-top: 14px; }
  .lens-city .lc-panel-body { padding: 0 16px 16px; }
  .lens-city .lc-ghost { padding: 9px 10px; }
  .lens-city .lc-row { padding: 3px 0; font-size: 13.5px; }
  .lens-city .lc-num { font-size: 12.5px; }
  .lens-city .lc-note { font-size: 12.5px; }
  .lens-city .lc-switch { width: 36px; height: 21px; border-radius: 11px; }
  .lens-city .lc-switch span { width: 17px; height: 17px; }
  .lens-city .lc-switch.on span { transform: translateX(15px); }
  .lens-city .lc-seg button { padding: 6px 10px; font-size: 12.5px; }
  .lens-city .lc-card { left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 52%; }
  .lens-city .lc-tip { display: none; }
  .lens-city .lc-mini { top: 56px; bottom: auto; right: 8px; }
  .lens-city .lc-pane-label { top: 74px; left: 8px; font-size: 12.5px; padding: 4px 10px; }
  .lens-city .lc-pane-label.bare { top: 8px; }
  .lens-city .lc-follow { top: auto; bottom: 14px; }
  .lens-city .lc-diff { font-size: 11px; left: 8px; bottom: 8px; padding: 7px 9px; }
  .lens-city .lc-tour { bottom: 8px; padding: 12px 14px 10px; }
  .lens-city .lc-tour-title { font-size: 17px; }
  .lens-city .lc-tour-words { font-size: 13px; max-height: 6em; }
}
/* Light: the shell's tokens carry the panels; the map keeps its own ground and loses the dark edge. */
.lens-city .lc-wrap.light .lc-vignette { background: radial-gradient(120% 90% at 50% 45%, transparent 62%, rgba(120,110,90,.18) 100%); }
.lens-city .lc-wrap.light .lc-clock { text-shadow: 0 1px 10px rgba(246,243,236,.8); color: var(--text, #22252c); }
.lens-city .lc-wrap.light .lc-clock-sub, .lens-city .lc-wrap.light .lc-clock-place { color: var(--muted, #5d6470); }
.lens-city .lc-wrap.light .lc-panel { box-shadow: 0 10px 30px rgba(40,30,10,.12); }
.lens-city .lc-wrap.light .lc-chip, .lens-city .lc-wrap.light .lc-seg { background: #0000000d; }
.lens-city .lc-wrap.light .lc-ghost:hover { background: #0000000a; }
.lens-city .lc-wrap.light .lc-quote { color: inherit; }
`;
