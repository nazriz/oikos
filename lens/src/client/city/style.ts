// The map's own styles, scoped under .lens-city, after the house style (docs/design/lens-look.md): a surveyor's plan
// by day, the town at night; Overpass for everything Lens says, Source Serif only for words someone in the world wrote;
// square panels separated by a rule; meanings in the colours of the town's own objects. Tokens come from the shell
// when it sets them; these are the fallbacks.
export const CITY_CSS = `
.lens-city {
  --lc-ink: var(--bg, #16212B); --lc-panel: var(--panel, #1E2B37); --lc-panel2: var(--panel-2, #1E2B37);
  --lc-hair: var(--line, #33424F); --lc-text: var(--text, #E4EAEE); --lc-muted: var(--muted, #8FA0AD);
  --lc-seat: #E8B400; --lc-seat-text: #E8B400; --lc-flag: #C8102E; --lc-ballot: #1F5FAD; --lc-inst: #2F7D5B;
  --lc-ui: var(--font-sans, "Overpass Variable", Overpass, system-ui, -apple-system, sans-serif);
  --lc-serif: var(--font-serif, "Source Serif 4 Variable", "Source Serif 4", Georgia, serif);
  --lc-mono: var(--font-mono, ui-monospace, monospace);
  position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--lc-ink); color: var(--lc-text);
  font-family: var(--lc-ui); font-size: 13px; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
.lens-city .lc-wrap.light {
  --lc-ink: var(--bg, #EDF0F2); --lc-panel: var(--panel, #F8F9FA); --lc-panel2: var(--panel, #F8F9FA);
  --lc-hair: var(--line, #C3CCD3); --lc-text: var(--text, #1D2B36); --lc-muted: var(--muted, #5B6B78); --lc-seat-text: #8A6A00;
  color: var(--lc-text);
}
.lens-city * { box-sizing: border-box; }
.lens-city .lc-wrap { position: absolute; inset: 0; }
.lens-city .lc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--lc-muted); font-size: 15px; }
.lens-city .lc-err { color: var(--lc-flag); font-size: 13px; }
.lens-city .lc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--lc-hair); border-top-color: var(--lc-seat); animation: lc-spin 1s linear infinite; }
@keyframes lc-spin { to { transform: rotate(360deg); } }

/* Floating controls on the map: square, solid, one rule, a small shadow (the only shadows Lens uses). */
.lens-city .lc-clock, .lens-city .lc-panel, .lens-city .lc-card, .lens-city .lc-tip, .lens-city .lc-tour, .lens-city .lc-diff, .lens-city .lc-follow, .lens-city .lc-pane-label, .lens-city .lc-hint {
  background: var(--lc-panel); border: 1px solid var(--lc-hair); border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.18); color: var(--lc-text); }
.lens-city .lc-clock { position: absolute; top: 12px; left: 12px; pointer-events: none; z-index: 2; padding: 8px 12px; }
.lens-city .lc-clock-time { font-size: 26px; line-height: 1; font-weight: 800; letter-spacing: -.01em; }
.lens-city .lc-clock-sub { margin-top: 4px; color: var(--lc-muted); font-size: 12.5px; }
.lens-city .lc-follow { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); font: inherit; font-size: 12.5px; padding: 6px 12px; cursor: pointer; z-index: 3; }
.lens-city .lc-follow.on { border-color: var(--lc-seat); }

.lens-city .lc-panel { position: absolute; right: 12px; top: 12px; width: 300px; max-height: calc(100% - 24px); display: flex; flex-direction: column; overflow: hidden; }
.lens-city .lc-panel.closed { width: auto; }
.lens-city .lc-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; gap: 2px; }
.lens-city .lc-panel-body { overflow-y: auto; padding: 0 14px 12px; }
.lens-city .lc-ghost { background: none; border: 0; color: var(--lc-text); font: inherit; font-weight: 700; padding: 6px 8px; border-radius: 2px; cursor: pointer; }
.lens-city .lc-ghost:hover { background: color-mix(in srgb, var(--lc-text) 8%, transparent); }
.lens-city .lc-ghost + .lc-ghost { color: var(--lc-muted); font-weight: 600; }
.lens-city .lc-section { border-top: 1px solid var(--lc-hair); padding: 10px 0; }
.lens-city .lc-section.off .lc-sec-title { color: var(--lc-muted); }
.lens-city .lc-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lens-city .lc-sec-title { font-weight: 800; }
.lens-city .lc-lead { color: var(--lc-text); line-height: 1.4; margin-bottom: 4px; }
.lens-city .lc-legend { margin-top: 8px; display: grid; gap: 4px; }
.lens-city .lc-legend.cols { grid-template-columns: 1fr 1fr; column-gap: 10px; }
.lens-city .lc-row { display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 8px; color: var(--lc-text); }
.lens-city .lc-legend.cols .lc-row { grid-template-columns: 14px 1fr; }
.lens-city .lc-row.muted, .lens-city .muted { color: var(--lc-muted); }
.lens-city .lc-num { font-size: 12px; color: var(--lc-muted); }
.lens-city .lc-sw { display: inline-block; width: 10px; height: 10px; border-radius: 1px; background: transparent; flex: none; }
.lens-city .lc-sw.dot { width: 8px; height: 8px; border-radius: 50%; margin-left: 1px; }
.lens-city .lc-sw.line { height: 3px; width: 14px; border-radius: 0; }
.lens-city .lc-note { margin-top: 8px; color: var(--lc-muted); font-size: 12px; line-height: 1.45; }
.lens-city .lc-note.rose { color: var(--lc-flag); }
.lens-city .lc-more { border-top: 1px solid var(--lc-hair); padding-top: 10px; }
.lens-city .lc-switch { width: 30px; height: 16px; border-radius: 8px; border: 1px solid var(--lc-hair); padding: 0; background: transparent; position: relative; cursor: pointer; flex: none; }
.lens-city .lc-switch span { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--lc-muted); }
.lens-city .lc-switch.on { background: var(--lc-text); border-color: var(--lc-text); }
.lens-city .lc-switch.on span { transform: translateX(14px); background: var(--lc-panel); }
.lens-city .lc-seg { display: inline-flex; border: 1px solid var(--lc-hair); border-radius: 2px; }
.lens-city .lc-seg button { border: 0; background: none; color: var(--lc-muted); font: inherit; font-size: 12px; padding: 3px 8px; cursor: pointer; }
.lens-city .lc-seg button.on { background: var(--lc-text); color: var(--lc-panel); }
.lens-city .lc-ramp { height: 8px; background: linear-gradient(90deg, #8FA0AD, #D9B86A, #B5462C); }
.lens-city .lc-ramp-l { display: flex; justify-content: space-between; gap: 8px; color: var(--lc-muted); font-size: 11.5px; }
.lens-city code { font-family: var(--lc-mono); font-size: 11px; }
.lens-city .lc-check { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--lc-hair); padding-top: 10px; color: var(--lc-muted); cursor: pointer; }
.lens-city .lc-check input { accent-color: var(--lc-text); }

.lens-city .lc-tip { position: absolute; pointer-events: none; max-width: 300px; z-index: 5; padding: 10px 12px; }
.lens-city .lc-card { position: absolute; left: 12px; bottom: 12px; width: 340px; max-width: calc(100% - 24px); max-height: 46%; overflow-y: auto; padding: 12px 14px; }
.lens-city .lc-x { position: absolute; top: 6px; right: 8px; border: 0; background: none; color: var(--lc-muted); font: inherit; font-size: 12px; cursor: pointer; }
.lens-city .lc-tip-title { font-size: 15px; line-height: 1.25; font-weight: 800; padding-right: 40px; }
.lens-city .lc-tip-sub { margin-top: 3px; color: var(--lc-muted); font-size: 12px; }
.lens-city .lc-mono { font-family: var(--lc-mono); font-size: 11px; color: var(--lc-muted); }
.lens-city .lc-dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 9px 0 0; font-size: 12.5px; }
.lens-city .lc-dl dt { color: var(--lc-muted); }
.lens-city .lc-dl dd { margin: 0; }
.lens-city .lc-names { margin-top: 8px; color: var(--lc-text); line-height: 1.5; font-size: 12.5px; }
.lens-city .lc-status.refused { color: var(--lc-flag); }
.lens-city .lc-quote { margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--lc-seat); font-family: var(--lc-serif); font-size: 13.5px; line-height: 1.45; white-space: pre-line; max-height: 9em; overflow: hidden; }

.lens-city .lc-short { display: none; }
.lens-city .lc-ghost { white-space: nowrap; }
.lens-city .lc-menuwrap { position: relative; }
.lens-city .lc-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 8; width: 250px; background: var(--lc-panel); border: 1px solid var(--lc-hair); border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.18); }
.lens-city .lc-menu button { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--lc-hair); background: none; color: var(--lc-text); font: inherit; font-weight: 700; padding: 8px 12px; cursor: pointer; }
.lens-city .lc-menu button:last-child { border-bottom: 0; }
.lens-city .lc-menu button:hover { background: color-mix(in srgb, var(--lc-text) 6%, transparent); }
.lens-city .lc-menu button span { display: block; font-weight: 400; font-size: 12px; color: var(--lc-muted); margin-top: 2px; }
.lens-city .lc-rowbtn { width: 100%; border: 0; background: none; font: inherit; text-align: left; padding: 1px 0; cursor: pointer; }
.lens-city .lc-rowbtn.off { color: var(--lc-muted); }
.lens-city .lc-tour { position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); width: min(640px, calc(100% - 32px)); z-index: 4; padding: 14px 18px 10px; border-top: 3px solid var(--lc-seat); }
.lens-city .lc-tour.tone-flag { border-top-color: var(--lc-flag); }
.lens-city .lc-tour.tone-election { border-top-color: var(--lc-ballot); }
.lens-city .lc-tour-kicker { color: var(--lc-muted); font-size: 12.5px; }
.lens-city .lc-tour-title { font-size: 18px; font-weight: 800; line-height: 1.3; margin-top: 4px; }
.lens-city .lc-tour-words { font-family: var(--lc-serif); font-size: 15px; line-height: 1.5; margin-top: 8px; max-height: 7.5em; overflow: hidden; }
.lens-city .lc-tour-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; }
.lens-city .lc-tour-dots { display: flex; gap: 4px; flex-wrap: wrap; }
.lens-city .lc-tour-dots button { width: 14px; height: 3px; border: 0; padding: 0; background: var(--lc-hair); cursor: pointer; }
.lens-city .lc-tour-dots button.on { background: var(--lc-seat); }
.lens-city .lc-tour-dots button.tone-flag.on { background: var(--lc-flag); }
.lens-city .lc-tour-ctl { display: flex; gap: 4px; }
.lens-city .lc-tour-ctl button { border: 1px solid var(--lc-hair); background: none; color: var(--lc-text); font: inherit; font-size: 12px; border-radius: 2px; padding: 3px 10px; cursor: pointer; }
.lens-city .lc-pane-label { position: absolute; top: 100px; left: 12px; z-index: 3; padding: 4px 10px; font-weight: 800; pointer-events: none; white-space: nowrap; }
.lens-city .lc-pane-label.bare { top: 12px; }
.lens-city .lc-diff { position: absolute; left: 12px; bottom: 12px; z-index: 3; display: grid; gap: 3px; padding: 9px 12px; font-size: 12px; }
.lens-city .lc-diff b { font-weight: 800; margin-bottom: 2px; }
.lens-city .lc-diff span { display: flex; align-items: center; gap: 7px; color: var(--lc-muted); }
.lens-city .lc-diff .sw { display: inline-block; width: 12px; height: 8px; }
.lens-city .lc-diff .sw.arc { border-top: 2px solid var(--lc-inst); border-radius: 8px 8px 0 0; }
.lens-city .lc-diff .sw.dot { width: 8px; border-radius: 50%; background: #B9892F; }
.lens-city .lc-diff .sw.ring { width: 8px; border-radius: 50%; border: 1.5px solid #B9892F; }
.lens-city .lc-mini { position: absolute; right: 12px; bottom: 12px; z-index: 3; border-radius: 2px; border: 1px solid var(--lc-hair); box-shadow: 0 1px 3px rgba(0,0,0,.18); cursor: crosshair; touch-action: none; }
/* Labels written on the map, positioned over their place (street-plan style). */
.lens-city .lc-anno { position: absolute; z-index: 2; pointer-events: none; transform: translate(-50%, -100%); white-space: nowrap; font-weight: 800; font-size: 13px;
  color: var(--lc-text); text-shadow: 0 0 3px var(--lc-ink), 0 0 3px var(--lc-ink), 0 0 6px var(--lc-ink); }
.lens-city .lc-anno.place { font-weight: 700; font-size: 12px; }
.lens-city .lc-anno.place.big { font-weight: 800; font-size: 16px; letter-spacing: -.005em; }
.lens-city .lc-anno.night { color: #E4EAEE; text-shadow: 0 0 3px #16212B, 0 0 3px #16212B, 0 0 6px #16212B; }
.lens-city .lc-anno.night.hall::after { background: #E4EAEE; }
.lens-city .lc-anno.hall::after { content: ""; display: block; width: 1px; height: 14px; margin: 2px auto 0; background: var(--lc-text); }
.lens-city .lc-anno.act { font-weight: 700; font-size: 12.5px; max-width: 280px; white-space: normal; text-align: center; color: var(--lc-text); }
.lens-city .lc-anno.act b { display: inline-block; width: 8px; height: 8px; background: var(--lc-seat); margin-right: 6px; }
.lens-city .lc-anno.act.refused b { background: var(--lc-flag); }
.lens-city .lc-hint { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 4; padding: 7px 12px; font-size: 12.5px; max-width: calc(100% - 24px); }
.lens-city.lc-insp { position: static; height: auto; background: transparent; overflow: visible; }
.lens-city .lc-today { display: grid; gap: 3px; margin-top: 4px; }
.lens-city .lc-today .lc-row { font-size: 12.5px; }
@media (max-width: 640px) {
  .lens-city { font-size: 13.5px; }
  .lens-city .lc-clock { top: 8px; left: 8px; padding: 6px 9px; }
  .lens-city .lc-clock-time { font-size: 20px; }
  .lens-city .lc-clock-sub { font-size: 11.5px; }
  .lens-city .lc-panel.closed { right: 8px; top: 8px; }
  .lens-city .lc-long { display: none; }
  .lens-city .lc-short { display: inline; }
  .lens-city .lc-panel.closed .lc-ghost { padding: 7px; }
  .lens-city .lc-panel:not(.closed) { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 64%; z-index: 6; border-width: 1px 0 0; padding-bottom: env(safe-area-inset-bottom); }
  .lens-city .lc-panel-body { padding: 0 16px 16px; }
  .lens-city .lc-ghost { padding: 9px 10px; }
  .lens-city .lc-row { padding: 3px 0; font-size: 13.5px; }
  .lens-city .lc-num, .lens-city .lc-note { font-size: 12.5px; }
  .lens-city .lc-switch { width: 38px; height: 22px; border-radius: 11px; }
  .lens-city .lc-switch span { width: 16px; height: 16px; }
  .lens-city .lc-switch.on span { transform: translateX(16px); }
  .lens-city .lc-seg button { padding: 6px 10px; font-size: 12.5px; }
  .lens-city .lc-card { left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 52%; }
  .lens-city .lc-tip { display: none; }
  .lens-city .lc-mini { top: 56px; bottom: auto; right: 8px; }
  .lens-city .lc-pane-label { top: 64px; left: 8px; font-size: 12.5px; }
  .lens-city .lc-pane-label.bare { top: 8px; }
  .lens-city .lc-follow { top: auto; bottom: 12px; }
  .lens-city .lc-diff { font-size: 11.5px; left: 8px; bottom: 8px; padding: 7px 9px; }
  .lens-city .lc-tour { bottom: 8px; padding: 12px 14px 10px; }
  .lens-city .lc-tour-title { font-size: 16px; }
  .lens-city .lc-tour-words { font-size: 14px; max-height: 6em; }
  .lens-city .lc-hint { top: auto; bottom: 12px; }
}
`;
