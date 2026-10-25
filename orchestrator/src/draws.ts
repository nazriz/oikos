// How the host names the random streams of what it runs on the TypeScript side for a seat (a mock seat's signing, the
// readers of a seat's office books): the same rules as the engine's (kernel/crates/actors/src/draws.rs), for one run.
//
// - A draw named for a paper is named for which paper it is to whoever draws, never for the paper's number in the
//   world's file (docs/reliability.md, "Draws and the order papers were filed in"). A record made in a run is numbered
//   in the order every record of the town was made, so one more paper filed by anyone moves every later number; a draw
//   keyed on the number then falls differently for people that paper had nothing to do with, and a pilot and its twin
//   part from the first paper a seat files. So a record's number stands as "the nth such paper this drawer has drawn on
//   for this purpose" (`paper#n`).
// - A stream is named for who draws (and in what capacity), what it is for, and which time that is: never the hour it
//   woke at (docs/reliability.md, "Draws and the moment"). A draw that names its matter (a `#` and a digit, or five
//   digits in a row) is that matter's: the nth time this drawer has drawn for it. Any other draw is the calendar day's,
//   and the nth time that day. The nth is counted by moments: drawing again in the same moment is the same occurrence.

const DAY = 86_400;

export class Draws {
  private drawnOn = new Map<string, Map<string, number>>();
  private day = -1;
  private dayOccurrences = new Map<string, { at: number; n: number }>();
  private matterOccurrences = new Map<string, { at: number; n: number }>();

  /** `purpose` with each record's number (`rec.123`) replaced by which such paper it is to `who` (`paper#n`). */
  stable(who: string, purpose: string): string {
    if (!purpose.includes("rec.")) return purpose;
    const what = `${who}\n${purpose.replace(/rec\.[0-9]+/g, "rec")}`;
    let seen = this.drawnOn.get(what);
    if (!seen) this.drawnOn.set(what, (seen = new Map()));
    return purpose.replace(/rec\.[0-9]+/g, (id) => {
      if (!seen!.has(id)) seen!.set(id, seen!.size + 1);
      return `paper#${seen!.get(id)}`;
    });
  }

  /** The key of the stream for `purpose` (already made stable) drawn by `pid` in `cap` at moment `t`. */
  key(pid: string, cap: string, purpose: string, t: number): string[] {
    const day = Math.floor(t / DAY);
    if (day !== this.day) { this.dayOccurrences.clear(); this.day = day; }
    const matter = /#[0-9]|[0-9]{5}/.test(purpose);
    const seen = matter ? this.matterOccurrences : this.dayOccurrences;
    const what = `${pid}\n${cap}\n${purpose}`;
    let occ = seen.get(what);
    if (!occ) seen.set(what, (occ = { at: t, n: 1 }));
    else if (occ.at !== t) { occ.at = t; occ.n++; }
    return matter ? ["participant", pid, cap, "", purpose, String(occ.n)] : ["participant", pid, cap, String(day), purpose, String(occ.n)];
  }
}
