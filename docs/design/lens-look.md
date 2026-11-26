# Lens: the look (house style, 2026-11-26)

Naz: "make it as non-AI looking as possible … certain things that the Claude models do." This replaces docs/design/lens.md
§4's palette and type. Every page follows it; every builder sweeps their own pages against the ban list below.

## First rule: a professional tool that is a joy to use and never gets in the way

Naz (2026-11-26): "a professional research tool that is a joy to use, but also doesn't get in the way." Think Linear,
Figma, a good map app: fast, calm, predictable.
- **Help is on demand, never imposed.** The walkthrough runs once, is skippable in one key (Esc) and never returns by
  itself. Hints appear once, small, and go when you act. No banner or modal blocks the work; prompts like "Play the
  first week" sit inline and vanish on the first interaction.
- **Instant and quiet.** Every action answers in under 100 ms (or shows a skeleton in place); nothing flickers, jumps
  or animates without a reason. Motion only shows what changed.
- **Keyboard-first and remembered.** Every common action has a key (listed under ?); the app remembers mode, theme,
  panel sizes, open layers and the last run and moment, per viewer.
- **Dense when wanted.** Researcher mode may show more at once; Story mode shows less. Neither hides the way to go
  deeper: evidence is one click away from every claim.
- **No nagging, no decoration.** Nothing celebrates, nothing asks for attention it hasn't earned.

## Where the look comes from

The subject is a town and its public record: a council's minutes, the electoral roll, the planning map, road signs, a
ballot paper. Lens should feel like a well-made civic atlas and register, the kind a town clerk and a surveyor would
make, not a SaaS dashboard and not a newspaper.

- **Type: road signage and the printed record.**
  - **Overpass** (`@fontsource-variable/overpass`; after Highway Gothic, the road-sign face) for all UI, headings and
    numbers. Headings are set in Overpass at weight 800, in sentence case, tight tracking; they are the voice of the tool.
  - **Source Serif 4** (`@fontsource-variable/source-serif-4`) for one thing only: words someone in the world wrote. These
    are the AI mayor's turns, quotes, papers and news. A reader can tell at a glance what the mayor said and what Lens says.
  - No monospace for labels or numbers: use Overpass with `font-variant-numeric: tabular-nums`. Mono is kept for raw ids
    in Researcher mode only.
- **Colour: a surveyor's plan by day, the town at night.**
  - Light (default): survey paper `#EDF0F2`, panel `#F8F9FA`, ink `#1D2B36` (drafting navy, never pure black), rule
    `#C3CCD3`, muted text `#5B6B78`.
  - Dark: night slate `#16212B`, panel `#1E2B37`, text `#E4EAEE`, rule `#33424F`, muted `#8FA0AD`. Never tinted black.
  - Meanings come from the town's own objects:
    - the AI mayor: road-marking yellow `#E8B400` (text on light uses `#8A6A00`);
    - a power grab: stop-sign red `#C8102E`;
    - the election: ballot-box blue `#1F5FAD`;
    - institutions: council green `#2F7D5B`;
    - people: warm grey-brown `#8C7B6B`.
    - lawful lock-in (the study's blind graders): plum `#8E3B8C` (dark `#B873B3`, text `#C98BC4`). Lock-in and a power
      grab sit side by side on every summary, so the two must part under colour blindness: burnt orange failed against
      the red (ΔE 2.9 deutan), plum passes (17.4 normal; its weak pair is the election blue, 6.6 protan, so it is never
      used alone: the word "Lock-in" or a square, not a dot, always goes with it). A meaning colour, not the banned
      decorative purple.
  - Run every pair through the dataviz validator for contrast in both themes.
- **Shape:** square-cornered panels (radius 2 px) separated by space and one rule, not boxed cards. A box is used only when
  the thing *is* a document (a paper, a ballot, a quote), and then it looks like that document: a ruled card, a ballot
  slip. One radius per kind of object, never one radius for everything. No drop shadows except the map's floating
  controls.
- **Labels live where the thing is.** On the map: write on the map (street-plan style labels on buildings and blocks), not
  in a legend far away. In charts: label lines at their ends, not in a key.

## Ban list (each of these reads as machine-made)

1. Tracked-out ALL-CAPS eyebrow labels above headings ("SITTING 10 OF 13", "THE SEAT · MAYOR-SYSTEM"). Use a sentence-case
   heading that says the thing: "Turn 10 of 13, day 154".
2. Meta strings joined with middle dots ("seed 7 · forked day 120 · $0.30"). Write a short sentence or a small table.
3. One word in a headline set apart in italic, bold or colour ("glm-5.3 · *redteam*").
4. Identical rounded cards with soft grey shadows for every block; cards inside cards.
5. Monospace for small data labels; `→` or `›` appended to buttons and links ("open in its run ›"). Buttons say the action:
   "Open this turn".
6. Gradients, glows used as decoration, glass/blur panels, purple or indigo accents, neon on black.
7. Fade-and-slide-up on load, hover lifts on every card, bounce easing. Motion answers an action, or marks one moment.
8. Numbered markers (01 / 02) unless the content is a sequence.
9. Pills and chips for everything. A chip is for a filter you can toggle, nothing else.
10. Filler copy: "insights", "at a glance", "seamless", "powerful". Name things by what they are: "How the votes went".
11. Em-dash fragments as labels ("Story — the mayor's turns").

## Check before showing anything

Screenshot every page in both themes at 1600×1000 and 390×844. Look for each banned item. Then remove one more
decoration ("look in the mirror and take one thing off").
