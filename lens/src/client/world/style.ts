// The 3D view's own styles, scoped under .lens-world, in the house style (docs/design/lens-look.md): Overpass, square
// corners, one rule, no glass or glow. The map's floating controls are the one place a shadow is allowed.
export const WORLD_CSS = `
.lens-world {
  --lw-panel: var(--panel, #F8F9FA); --lw-ink: var(--text, #1D2B36); --lw-muted: var(--muted, #5B6B78); --lw-rule: var(--rule, #C3CCD3);
  --lw-ui: "Overpass Variable", Overpass, var(--font-sans, system-ui), -apple-system, sans-serif;
  position: relative; width: 100%; height: 100%; overflow: hidden; background: #c8d4dc;
  font-family: var(--lw-ui); font-size: 13px; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; color: var(--lw-ink);
}
.lens-world * { box-sizing: border-box; }
.lens-world .lw-host { position: absolute; inset: 0; }
.lens-world .lw-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #1D2B36; font-weight: 700; font-size: 15px; background: #EDF0F2; }
.lens-world .lw-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.lens-world .lw-label { position: absolute; left: 0; top: 0; white-space: nowrap; font-weight: 800; font-size: 12.5px; letter-spacing: -0.005em; color: #1D2B36;
  text-shadow: 0 0 2px #F8F9FA, 0 0 2px #F8F9FA, 0 0 4px #F8F9FAcc, 0 0 6px #F8F9FA99; will-change: transform; }
.lens-world .lw-label[data-kind="industrial"], .lens-world .lw-label[data-kind="utility"] { font-weight: 700; font-size: 11.5px; color: #3c4b57; }
.lens-world .lw-poll { color: #1F5FAD; }
.lens-world .lw-labels.night .lw-label { color: #EDF0F2; text-shadow: 0 0 2px #16212B, 0 0 3px #16212B, 0 0 6px #16212Bcc; }
.lens-world .lw-labels.night .lw-poll { color: #9cc0ee; }
.lens-world .lw-modes { position: absolute; left: 14px; top: 14px; display: flex; background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px;
  box-shadow: 0 2px 10px #1d2b3626; }
.lens-world .lw-modes button { font: inherit; font-weight: 700; color: var(--lw-ink); background: none; border: 0; padding: 7px 14px 5px; cursor: pointer; border-right: 1px solid var(--lw-rule); }
.lens-world .lw-modes button:last-child { border-right: 0; }
.lens-world .lw-modes button.on { background: #1D2B36; color: #F8F9FA; }
.lens-world .lw-modes button:disabled { color: #9aa6af; cursor: default; }
.lens-world .lw-status { position: absolute; right: 14px; top: 14px; display: flex; gap: 10px; align-items: baseline; padding: 6px 12px 4px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px; box-shadow: 0 2px 10px #1d2b3626; color: var(--lw-muted); }
.lens-world .lw-time { font-weight: 800; font-size: 17px; color: var(--lw-ink); letter-spacing: -0.01em; }
.lens-world .lw-hint, .lens-world .lw-key { position: absolute; left: 14px; bottom: 14px; max-width: min(560px, calc(100% - 28px)); padding: 6px 10px 4px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-radius: 2px; color: var(--lw-muted); line-height: 1.45; }
.lens-world .lw-key i { display: inline-block; width: 9px; height: 9px; margin: 0 3px -1px 2px; }
.lens-world .lw-who { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: flex; gap: 10px; align-items: baseline; padding: 6px 12px 4px;
  background: var(--lw-panel); border: 1px solid var(--lw-rule); border-left: 3px solid #8C7B6B; border-radius: 2px; box-shadow: 0 2px 10px #1d2b3626; color: var(--lw-muted); white-space: nowrap; }
.lens-world .lw-who b { color: var(--lw-ink); font-weight: 800; }
@media (max-width: 640px) {
  .lens-world .lw-who { top: 60px; max-width: calc(100% - 28px); overflow: hidden; text-overflow: ellipsis; }
  .lens-world .lw-modes button { padding: 10px 16px 8px; }
  .lens-world .lw-key { display: none; }
  .lens-world .lw-status { top: auto; bottom: 14px; right: 14px; }
}
`;
