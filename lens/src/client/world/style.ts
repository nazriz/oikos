// The 3D view's own styles, scoped under .lens-world, in the house style (docs/design/lens-look.md): Overpass, square
// corners, one rule, no glass or glow. The map's floating controls are the one place a shadow is allowed.
export const WORLD_CSS = `
.lens-world {
  --lw-panel: var(--panel, #F8F9FA); --lw-ink: var(--text, #1D2B36); --lw-muted: var(--muted, #5B6B78); --lw-rule: var(--line, #C3CCD3);
  --lw-ui: "Overpass Variable", Overpass, var(--font-sans, system-ui), -apple-system, sans-serif;
  position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--ink, #EDF0F2);
  font-family: var(--lw-ui); font-size: 13px; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; color: var(--lw-ink);
}
.lens-world * { box-sizing: border-box; }
.lens-world .lw-host { position: absolute; inset: 0; }
.lens-world .lw-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted, #5B6B78); font-weight: 700; font-size: 15px; background: var(--ink, #EDF0F2); }
.lens-world .lw-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.lens-world .lw-label { position: absolute; left: 0; top: 0; white-space: nowrap; font-weight: 800; font-size: 12.5px; letter-spacing: -0.005em; color: #1D2B36;
  text-shadow: 0 0 2px #F8F9FA, 0 0 2px #F8F9FA, 0 0 4px #F8F9FAcc, 0 0 6px #F8F9FA99; will-change: transform, opacity; opacity: 0; transition: opacity .35s ease; }
.lens-world .lw-label[data-kind="industrial"], .lens-world .lw-label[data-kind="utility"] { font-weight: 700; font-size: 11.5px; color: #3c4b57; }
.lens-world .lw-poll { color: #1F5FAD; }
.lens-world .lw-labels.night .lw-label { color: #EDF0F2; text-shadow: 0 0 2px #16212B, 0 0 3px #16212B, 0 0 6px #16212Bcc; }
.lens-world .lw-labels.night .lw-poll { color: #9cc0ee; }
.lens-world .lw-modes { position: absolute; left: 14px; top: 14px; display: flex; background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px;
  box-shadow: 0 2px 10px #1d2b3626; }
.lens-world .lw-modes button { font: inherit; font-size: 12.5px; font-weight: 700; color: var(--lw-ink); background: none; border: 0; padding: 5px 11px 4px; cursor: pointer; border-right: 1px solid var(--lw-rule); }
.lens-world .lw-modes button:last-child { border-right: 0; }
.lens-world .lw-modes button.on { background: var(--lw-ink); color: var(--lw-panel); }
.lens-world .lw-modes button:disabled { color: #9aa6af; cursor: default; }
.lens-world .lw-status { position: absolute; right: 14px; top: 14px; color: #1D2B36; font-size: 12px; font-weight: 600; pointer-events: none;
  text-shadow: 0 0 2px #F8F9FA, 0 0 4px #F8F9FAcc; }
.lens-world .lw-hint, .lens-world .lw-key { position: absolute; left: 14px; bottom: 14px; max-width: min(560px, calc(50% - 120px)); padding: 6px 10px 4px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px; color: var(--lw-muted); line-height: 1.45; }
.lens-world .lw-key i { display: inline-block; width: 9px; height: 9px; margin: 0 3px -1px 2px; }
.lens-world .lw-who { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: flex; gap: 10px; align-items: baseline; padding: 6px 12px 4px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-left: 3px solid #8C7B6B; border-radius: 2px; box-shadow: 0 2px 10px #1d2b3626; color: var(--lw-muted); white-space: nowrap; }
.lens-world .lw-who b { color: var(--lw-ink); font-weight: 800; }

.lens-world .lw-caption { position: absolute; left: 0; top: 0; max-width: 220px; white-space: normal; font-weight: 700; font-size: 11.5px; line-height: 1.3; color: #1D2B36;
  background: #F8F9FAee; border-left: 2px solid #E8B400; padding: 3px 7px 2px; will-change: transform, opacity; opacity: 0; transition: opacity .5s ease; }
.lens-world .lw-caption.refused { border-left-color: #C8102E; }
.lens-world .lw-extra { position: absolute; left: 14px; top: 48px; display: flex; gap: 6px; }
.lens-world .lw-extra button { font: inherit; font-size: 12px; font-weight: 700; color: var(--lw-ink); background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px; padding: 4px 9px 3px; cursor: pointer; }
.lens-world .lw-extra button[aria-pressed="true"] { background: var(--lw-ink); color: var(--lw-panel); }
.lens-world .lw-oldtour { position: absolute; left: 14px; top: 58px; font: inherit; font-weight: 700; color: var(--lw-ink); background: var(--lw-panel);
  border: 1px solid var(--lw-rule); border-radius: 2px; padding: 7px 12px 5px; cursor: pointer; box-shadow: 0 2px 10px #1d2b3626; }
.lens-world .lc-tour { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); width: min(640px, calc(100% - 32px)); z-index: 4; padding: 14px 18px 10px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-top: 3px solid #E8B400; border-radius: 2px; box-shadow: 0 2px 14px #1d2b3633; color: var(--lw-ink); }
.lens-world .lc-tour.tone-flag { border-top-color: #C8102E; }
.lens-world .lc-tour.tone-election { border-top-color: #1F5FAD; }
.lens-world .lc-tour-kicker { color: var(--lw-muted); font-size: 12.5px; }
.lens-world .lc-tour-title { font-size: 18px; font-weight: 800; line-height: 1.3; margin-top: 4px; }
.lens-world .lc-tour-words { font-family: "Source Serif 4 Variable", "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.5; margin-top: 8px; max-height: 7.5em; overflow: hidden; }
.lens-world .lc-note { margin-top: 6px; color: var(--lw-muted); font-size: 12px; }
.lens-world .lc-tour-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; }
.lens-world .lc-tour-dots { display: flex; gap: 4px; flex-wrap: wrap; }
.lens-world .lc-tour-dots button { width: 14px; height: 3px; border: 0; padding: 0; background: var(--lw-rule); cursor: pointer; }
.lens-world .lc-tour-dots button.on { background: #E8B400; }
.lens-world .lc-tour-dots button.tone-flag.on { background: #C8102E; }
.lens-world .lc-tour-ctl { display: flex; gap: 4px; }
.lens-world .lc-tour-ctl button { border: 1px solid var(--lw-rule); background: none; color: var(--lw-ink); font: inherit; font-size: 12px; border-radius: 2px; padding: 3px 10px; cursor: pointer; }
@media (max-width: 640px) {
  .lens-world .lc-tour { bottom: 60px; padding: 12px 14px 10px; }
  .lens-world .lc-tour-title { font-size: 16px; }
  .lens-world .lc-tour-words { font-size: 14px; max-height: 6em; }
  .lens-world .lw-caption { max-width: 200px; font-size: 12px; }
  .lens-world .lw-who { top: 60px; max-width: calc(100% - 28px); overflow: hidden; text-overflow: ellipsis; }
  .lens-world .lw-modes button { padding: 10px 16px 8px; }
  .lens-world .lw-key { display: none; }
  .lens-world .lw-status { display: none; }
}
`;
