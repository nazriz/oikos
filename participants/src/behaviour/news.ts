// firm.newspaper: the local paper's editor (docs/behaviour/news.md; docs/design/world-expansion.md 3.2). It reads the
// public record, and each week runs the most newsworthy items: a statement each, put forward to be believed (an
// assertion), saying whether it's about the town's government and whether it reflects well or badly on it (tone).
// The facts are the records'; what it runs, and how it judges what's a matter of judgement, are its own (its leaning).

import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, DAY, say, type Step } from "./common";
import { stepper } from "./firms";
import * as P from "./papers";

/** What makes an item news, by the kind of record (placeholders): its weight, and its tone toward the government. */
const KINDS: { [kind: string]: { weight: number; tone: (r: any) => number; headline: (r: any) => string } } = {
  petition: { weight: 3, tone: () => -1, headline: (r) => `Residents petition the town: ${String(r.text).slice(0, 160)}` },
  complaint: { weight: 1, tone: () => -1, headline: () => "A resident complains to the town about a service." },
  environment_report: {
    weight: 2,
    tone: (r) => (Object.values(r.data?.species ?? {}).some((s: any) => (s.change_bps ?? 0) <= -2000) ? -1 : 0),
    headline: (r) => `The environment office reports: ${String(r.text).slice(0, 200)}`,
  },
  budget: { weight: 2, tone: () => 0, headline: (r) => `The council adopts the town's budget: ${String(r.text).slice(0, 160)}` },
  law: { weight: 2, tone: () => 0, headline: (r) => `A new law: ${String(r.text).slice(0, 200)}` },
  ballot_result: { weight: 4, tone: () => 0, headline: (r) => String(r.text).slice(0, 220) },
  election_notice: { weight: 3, tone: () => 0, headline: (r) => String(r.text).slice(0, 220) },
  nomination: { weight: 2, tone: () => 0, headline: (r) => `A candidate stands: ${String(r.text).slice(0, 200)}` },
  permit_decision: { weight: 1, tone: () => 0, headline: (r) => String(r.text).slice(0, 220) },
};

export const newspaper: BehaviourModule = {
  name: "firm.newspaper",
  answers: {"office": "the paper's editor", "acts": "The paper reports the public record. It prints no letters."},
  issues: P.EDITOR,
  issuesWith: (p) => ({ town: p.town }),
  version: "0.1.0",
  doc: "docs/behaviour/news.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      town: "", // the government it reports on (the world must say)
      every_days: 7, // its rhythm: an edition a week, by an editor and reporters who are paid and whose time it takes
      items_per_edition: 5,
      leaning_bps: 0, // -10,000 against the town's government to 10,000 for it (placeholder: none)
    }, ctx.params);
    need(p, ["town"], "firm.newspaper");
    const book = new Book();
    const run = new Set<string>(); // records already reported
    let next = (1 + ctx.rng("first-edition").below(7)) * DAY;
    let edition = 0;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const t = obs.t;
        if (t < next) return [];
        next = t + p.every_days * DAY;
        const lean = p.leaning_bps / 10_000;
        // What's new on the record, scored: its weight, tipped by our leaning (a paper for the government runs more of
        // what reflects well on it, and less of what doesn't).
        const items = Object.keys(KINDS).flatMap((kind) => book.open(kind).filter((r) => !run.has(r.id) && r.author !== ctx.participant).map((r) => ({ r, kind })))
          .map(({ r, kind }) => {
            const k = KINDS[kind]!;
            let tone = k.tone(r);
            // (Where tone is a matter of judgement, our leaning may decide it.)
            if (tone === 0 && lean !== 0 && ctx.rng(`tone-${r.id}`).below(10_000) < Math.abs(p.leaning_bps) / 2) tone = Math.sign(lean);
            const score = k.weight * (1 + tone * lean) * 1000 + (r.at % 1000);
            return { r, kind, tone, score, headline: k.headline(r) };
          })
          .sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1));
        for (const x of items) run.add(x.r.id);
        const chosen = items.slice(0, p.items_per_edition);
        if (!chosen.length) return []; // nothing new on the record: no edition this week
        edition += 1;
        const steps: Step[] = [because(`Edition ${edition}: the ${chosen.length} most newsworthy items of ${items.length} new on the record.`,
          ...chosen.map((x) => say("news", x.headline, { visible: "public", basis: x.r.id,
            data: { kind: x.kind, tone: x.tone, about_office: x.kind !== "ballot_result" && x.kind !== "nomination", edition }, assertion: { that: x.headline, about: [p.town] } })))];
        return steps;
      },
    );
  },
};
