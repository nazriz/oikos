// A finished pilot run folder into the viewer's data (`ViewData`): one JSON-able object the page draws. The folder is only
// read: its log through the repo's reader, the files beside it with readFileSync and readdirSync. The data is separate
// from how it is drawn (render.ts), so a later renderer (docs/design/renderer.md) can take the same data.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { currentLogs, runOf } from "../../orchestrator/src/logs";
import { DebriefCollector, isKeptBack } from "../../orchestrator/src/debriefs";
import { endingOf } from "../../orchestrator/src/pilot-report";
import { ingest, personOf, type Actor, type Raw, type SeatAct, type Transcript } from "./ingest";
import { clip, compareActs, lookBody, readingOf, dayOf, decisionSignature, mentions, money, stamp, summariseBlocks, type Pair } from "./parse";

export interface Caps { reading: number; result: number; say: number; actorItems: number }
export const CAPS: Caps = { reading: 12_000, result: 2_500, say: 2_000, actorItems: 40 };

export interface ViewData { [k: string]: any }

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** A per-day series as exactly n days (anything on a later day, as the log's last instant, counts on the last). */
const pad = (a: number[], n: number) => { const out: number[] = new Array(n).fill(0); a.forEach((v, i) => { if (v) out[Math.min(i, n - 1)]! += v; }); return out; };

/** The pilot's run log (its current one), or the first run log in the folder. */
export function logOf(dir: string): string {
  const logs = currentLogs(dir).filter((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f));
  const log = logs[0] ?? currentLogs(dir)[0];
  if (!log) throw new Error(`no run log in ${dir}`);
  return log;
}

/** The pilot's code twin, if there is one: the folder named by --twin, or a sibling "twin*" folder of the working folder the
 * pilot's world file lives in (`<work>/worlds/x.yaml`, `<work>/twinA/`) that holds a log of the same run id. */
export function findTwin(dir: string, log: string, explicit?: string): string | undefined {
  if (explicit) return resolve(explicit);
  const batch = readJson(join(dir, "batch.json"));
  const world: string | undefined = batch?.world;
  if (!world) return undefined;
  const work = dirname(dirname(world));
  if (!existsSync(work)) return undefined;
  const id = runOf(log);
  for (const d of readdirSync(work).filter((n) => /^twin/i.test(n)).sort()) {
    const p = join(work, d);
    try { if (statSync(p).isDirectory() && currentLogs(p).some((f) => runOf(f) === id)) return p; } catch { /* (not a folder) */ }
  }
  return undefined;
}

/** Lines of the wave's alert log that name this pilot (`<runs>/pilot-queues/*.alerts.log`). */
function waveAlerts(dir: string, pilot: string): string[] {
  const q = join(dirname(resolve(dir)), "pilot-queues");
  if (!existsSync(q)) return [];
  const out: string[] = [];
  for (const f of readdirSync(q).filter((n) => n.endsWith(".alerts.log"))) for (const l of readFileSync(join(q, f), "utf8").split("\n")) if (l.includes(pilot) && !/\] done: /.test(l)) out.push(l);
  return out;
}

function maps(header: any) {
  const c = header?.config ?? {};
  const entities = new Map<string, { kind: string; name: string }>();
  for (const e of c.world?.entities ?? []) entities.set(e.id, { kind: e.kind, name: e.name ?? e.id });
  const positions = new Map<string, { entity?: string; title?: string; holder?: string }>();
  for (const p of c.positions ?? []) positions.set(p.id, { entity: p.entity, title: p.title, holder: p.holder });
  const holderOfAccount = new Map<string, string>();
  for (const a of c.world?.accounts ?? []) holderOfAccount.set(a.id, a.holder);
  const titles = new Map<string, string>();
  for (const p of c.participants ?? []) if (p.title) titles.set(p.id, p.title);
  const seats: string[] = (c.participants ?? []).filter((p: any) => p.controller?.type === "llm" && !/-self$/.test(p.id)).map((p: any) => p.id);
  const entityOfPosition = new Map<string, string>();
  for (const [id, p] of positions) if (p.entity) entityOfPosition.set(id, p.entity);
  return { entities, positions, holderOfAccount, titles, seats, entityOfPosition, currency: c.world?.currencies?.[0] ?? {} };
}

const SEAT_TOOLS_HIDDEN = new Set(["notebook"]);

/** An experiment fork (orchestrator/src/experiment.ts): the arm's log, its seats and their posts (bound at the fork, so
 * not in the log's header), the code arm's log as the twin, and what the folder says of the experiment. */
export interface ForkInput { log: string; name: string; seats: { [seat: string]: string | undefined }; twinLog?: string; info: ViewData }

export async function buildView(dir: string, opts: { twin?: string | false; caps?: Partial<Caps>; log?: (s: string) => void; debriefs?: false; fork?: ForkInput } = {}): Promise<ViewData> {
  const say = opts.log ?? (() => {});
  let caps: Caps = { ...CAPS, ...opts.caps };
  const fork = opts.fork;
  const log = fork?.log ?? logOf(dir);
  const pilotName = fork?.name ?? basename(resolve(dir));
  // (The explorer passes debriefs: false: it reads no debrief, docs/design/renderer.md 1.)
  const deb = opts.debriefs === false ? undefined : new DebriefCollector(log);
  // The header is needed before the pass (which seats sat), and is the log's first line.
  const first = await (async () => { const { logLines } = await import("../../orchestrator/src/logs"); for await (const l of logLines(log)) return JSON.parse(l); })();
  const m = maps(first.body);
  // (A fork's seats take their posts at the fork: the header's config is the base run's, from before.)
  if (fork) for (const [seat, post] of Object.entries(fork.seats)) {
    if (!m.seats.includes(seat)) m.seats.push(seat);
    const p = post ? m.positions.get(post) : undefined;
    if (p) p.holder = seat;
  }
  say(`reading ${basename(log)}`);
  const seatPositions = new Set([...m.positions].filter(([, p]) => p.holder && m.seats.includes(p.holder)).map(([id]) => id));
  // (A fork's code arm is read beside it, at the same time.)
  const forkTwin = opts.twin !== false && fork?.twinLog ? (say(`reading the code arm ${basename(fork.twinLog)}`), ingest(fork.twinLog, { seats: new Set(m.seats), positions: seatPositions, twin: true, entityOfPosition: m.entityOfPosition, holderOfAccount: m.holderOfAccount, full: false }).catch((e) => e as Error)) : undefined;
  const raw = await ingest(log, { seats: new Set(m.seats), positions: seatPositions, entityOfPosition: m.entityOfPosition, holderOfAccount: m.holderOfAccount, full: true, ...(deb ? { debriefs: deb, wants: DebriefCollector.wants } : {}) });
  const days = Math.max(1, Math.ceil((raw.end?.t ?? raw.lastT) / 86_400));
  const cur = m.currency;
  const fmt = (x: any) => money(x, cur);

  let twinRaw: Raw | undefined, twinDir: string | undefined;
  if (opts.twin !== false && fork?.twinLog) {
    // (A fork's twin is the experiment's code arm: the same town forked on the same day, code in the same seats.)
    const t = await forkTwin!;
    if (t instanceof Error) say(`twin not read: ${t.message}`);
    else { twinRaw = t; twinDir = fork.twinLog; }
  } else if (opts.twin !== false && !fork) {
    twinDir = findTwin(dir, log, typeof opts.twin === "string" ? opts.twin : undefined);
    if (twinDir && existsSync(twinDir)) {
      try {
        const tl = logOf(twinDir); say(`reading the code twin ${tl}`);
        const th = (await (async () => { const { logLines } = await import("../../orchestrator/src/logs"); for await (const l of logLines(tl)) return JSON.parse(l); })()).body;
        // (In the twin the seats' posts are held by code citizens: their acts on those posts are what the seat is set beside.)
        const holders = new Set<string>((th.config?.positions ?? []).filter((p: any) => seatPositions.has(p.id)).map((p: any) => p.holder));
        twinRaw = await ingest(tl, { seats: holders, positions: seatPositions, twin: true, entityOfPosition: m.entityOfPosition, holderOfAccount: m.holderOfAccount, full: false });
      } catch (e) { say(`twin not read: ${(e as Error).message}`); twinDir = undefined; }
    } else twinDir = undefined;
  }

  const label = (id: string): string => m.entities.get(id)?.name && m.entities.get(id)!.name !== id ? `${m.entities.get(id)!.name} (${id})` : m.positions.get(id)?.title ? `${m.positions.get(id)!.title} (${id})` : id;
  const nameOf = (id: string): string => m.entities.get(id)?.name ?? m.positions.get(id)?.title ?? m.titles.get(id) ?? id;

  const pilotFile = (() => { const p = join(dir, "PILOT.txt"); if (!existsSync(p)) return {} as any; const t = readFileSync(p, "utf8"); const at = t.indexOf("\n{"); let queue: any; try { queue = JSON.parse(t.slice(at < 0 ? t.indexOf("{") : at + 1)); } catch { /* (by hand) */ } return { note: (at < 0 ? t : t.slice(0, at)).trim(), queue }; })();
  const batch = readJson(join(dir, "batch.json"));
  const summary = readJson(log.replace(/\.(jsonl(\.zst)?|oklog)$/, ".summary.json"));
  const cfg = first.body.config ?? {};
  const llm = raw.llm?.llm ?? {};
  const framing = new Map<string, any>();
  for (const p of cfg.participants ?? []) if (m.seats.includes(p.id) && p.framing) framing.set(p.id, p.framing);

  // ---------- usage per seat, translator
  const usageBy = (f: (u: Raw["usage"][number]) => boolean) => raw.usage.filter(f);
  const totalMicro = sum(raw.usage.map((u) => u.cost));
  const trUsage = usageBy((u) => u.purpose === "translator" || u.subject === "translator");
  const byModel: { [k: string]: { calls: number; usd: number } } = {};
  for (const u of raw.usage) { const k = `${u.provider}/${u.model}`; (byModel[k] ??= { calls: 0, usd: 0 }).calls++; byModel[k]!.usd += u.cost / 1e6; }

  // ---------- requests, by draft id
  const reqIds = new Set<string>([...raw.requestText.keys(), ...raw.drafts.keys(), ...raw.failures.keys()]);
  const actsByDraft = new Map<string, SeatAct>();
  for (const a of raw.seatActs) if (a.draft) actsByDraft.set(a.draft, a);
  const arrangement = llm.translator_arrangement;
  const modelOf = (which: "first" | "behind") => String(arrangement?.[which]?.model ?? "");
  const ID = /^draft\.(.+)\.(\d+)$/;
  type Req = ViewData;
  const requests = new Map<string, Req>();
  for (const id of reqIds) {
    const mm = ID.exec(id); if (!mm) continue;
    const route = raw.routes.get(id), draft = raw.drafts.get(id), fail = raw.failures.get(id), so = raw.signoffs.get(id), rt = raw.requestText.get(id);
    const ending = draft ? "draft_offered" : fail ? endingOf(fail.call, String(fail.reason ?? ""), fail.asked_back === true ? true : undefined).ending : "no_result";
    const act = actsByDraft.get(id);
    const by = route ? (route.used === "first" ? "ours" : "fallback") : "single";
    // (Which translator drafted it: the route's own record of each model where there is one, else the calls made for it.)
    const calls = raw.translatorCalls.get(id) ?? [];
    const usedModel = route ? String((route.used === "first" ? route.first?.model : route.behind?.model) ?? modelOf(route.used === "first" ? "first" : "behind")) : calls.at(-1)?.model ?? llm.translator?.model ?? "";
    requests.set(id, {
      id, seat: raw.reqSeat.get(id) ?? mm[1], n: Number(mm[2]), t: rt?.t ?? draft?.t ?? 0, words: clip(rt?.words ?? "", 1500), attempts: rt?.attempts ?? 0, retries: raw.retries.get(id) ?? 0,
      by, usedModel, translators: [...new Set(calls.map((c) => c.model))],
      route: route ? { used: route.used, why: route.why, agree: route.agree, first: route.first ? { model: route.first.model, result: route.first.result, label: route.first.label, ms: route.first.ms, sure: route.first.sure_ppm, withheld: route.first.withheld, wrote: clip(route.first.wrote ?? route.first.call, 600) } : undefined, behind: route.behind ? { model: route.behind.model, result: route.behind.result, call: clip(route.behind.call, 600) } : undefined } : undefined,
      ending,
      draft: draft ? { call: clip(draft.call, 1500), proposal: clip(draft.proposal, 1500), summary: clip(draft.summary, 2500), ok: draft.check?.ok !== false } : undefined,
      failure: fail ? { reason: clip(fail.reason, 800), call: clip(fail.call, 600), askedBack: fail.asked_back === true } : undefined,
      signoff: so?.decision === "accept" ? "confirmed" : so?.decision === "reject" ? "declined" : draft ? "unanswered" : undefined,
      act: act ? { seq: act.seq, t: act.t, status: act.status, appliedAt: act.appliedAt, refusal: act.refusal, blocks: act.blocks.map((b) => ({ ...b, text: clip(b.text, 400) })), effects: act.effects.slice(0, 12).map((e) => ({ ...e, text: clip(e.text, 500) })), consequences: act.consequences.map((c) => ({ ...c, byName: nameOf(c.by), text: clip(c.text, 500) })), reasoning: clip(act.reasoning, 400) } : undefined,
    });
  }

  // ---------- sittings per seat
  const seatsOut: ViewData[] = [];
  const mentionWeight = new Map<string, number>();
  const known = new Set<string>(m.entities.keys());
  const addMentions = (text: string, w = 1) => { for (const id of mentions(text, known)) mentionWeight.set(id, (mentionWeight.get(id) ?? 0) + w); };
  const debriefOut = deb ? deb.finish() : { seats: [] as ReturnType<DebriefCollector["finish"]>["seats"], not_given: [] as ReturnType<DebriefCollector["finish"]>["not_given"] };
  const toolsLine = (o: any) => (o && typeof o === "object" ? o : {});

  for (const seat of m.seats) {
    const trs = raw.transcripts.filter((t) => t.subject === seat && t.purpose === "participant").sort((a, b) => a.seq - b.seq);
    const sittings: ViewData[] = [];
    let curS: ViewData | undefined, prevTr: Transcript | undefined;
    const wakes = raw.woken.filter((w) => w.subject === seat);
    let wi = 0, lastWake: (typeof wakes)[number] | undefined;
    for (const tr of trs) {
      if (tr.turn === 1 || !curS) {
        // (What woke it: the participant's last observation before the sitting's first call.)
        while (wi < wakes.length && wakes[wi]!.seq < tr.seq) lastWake = wakes[wi++];
        const opening = tr.opening ?? "";
        curS = { t: tr.t, day: dayOf(tr.t), stamp: stamp(tr.t), model: `${tr.provider}/${tr.model}`, reading: clip(readingOf(opening), caps.reading), readingLen: readingOf(opening).length, notebookBefore: tr.notebook, system: tr.systemSha, ...(fork ? { prompt: clip(opening, caps.reading), promptLen: opening.length } : {}), woken: lastWake && lastWake.t <= tr.t && lastWake.t > tr.t - 86_400 ? { for: lastWake.wokeFor, inbox: lastWake.inbox, outcomes: lastWake.outcomes, drafts: lastWake.drafts } : undefined, turns: [], cost: 0, calls: 0, requests: [], direct: [], notes: [] };
        sittings.push(curS); prevTr = undefined;
      }
      // What the seat looked up at its previous turn comes back as this turn's tool results.
      const resultBy = new Map(tr.results.map((r) => [r.id, r.text]));
      if (prevTr) for (const tu of curS.turns.at(-1)!.tools) if (tu.id && resultBy.has(tu.id)) { const text = resultBy.get(tu.id)!; tu.result = clip(tu.name === "look" && !fork ? lookBody(text) : text, caps.result); }
      if (tr.shown && curS.turns.length) curS.turns.at(-1)!.shownAfter = clip(tr.shown, caps.result);
      const tools = (tr.output as any[]).filter((x) => x?.type === "tool_use").map((x) => ({ id: x.id, name: x.name, input: toolsLine(x.input) }));
      for (const tu of tools) addMentions(JSON.stringify(tu.input), 2);
      curS.turns.push({ turn: tr.turn, say: clip((tr.output as any[]).filter((x) => x?.type === "text").map((x) => x.text).join("\n"), caps.say), tools, ...(tr.systemSha && tr.systemSha !== curS.system ? { system: tr.systemSha } : {}) });
      curS.calls++;
      prevTr = tr;
    }
    // Which sitting a time belongs to: the seat's latest sitting that began at or before it.
    const sittingAt = (t: number) => { let s: ViewData | undefined; for (const x of sittings) { if (x.t <= t) s = x; else break; } return s ?? sittings[0]; };
    for (const u of raw.usage) if (u.subject === seat && u.purpose === "participant") { const s = sittingAt(u.t); if (s) s.cost += u.cost / 1e6; }
    const myReqs = [...requests.values()].filter((r) => r.seat === seat).sort((a, b) => a.n - b.n);
    for (const r of myReqs) { const s = sittingAt(r.t); if (s) s.requests.push(r); addMentions(r.words, 3); for (const c of r.act?.consequences ?? []) addMentions(c.by + " " + c.text, 1); }
    const myActs = raw.seatActs.filter((a) => a.participant === seat);
    for (const a of myActs) {
      addMentions(JSON.stringify(a.blocks), 2);
      if (a.draft && requests.has(a.draft)) continue;
      const s = sittingAt(a.t);
      if (s) s.direct.push({ seq: a.seq, t: a.t, status: a.status, blocks: a.blocks.map((b) => ({ ...b, text: clip(b.text, 400) })), effects: a.effects.slice(0, 8), consequences: a.consequences.slice(0, 6).map((c) => ({ ...c, byName: nameOf(c.by), text: clip(c.text, 400) })) });
    }
    for (const n of raw.notes) if (n.subject === seat && n.kind !== "empty_sitting") { const s = sittingAt(n.t); if (s) s.notes.push({ kind: n.kind, data: clip(n.data, 300) }); }
    // Empty sittings: woken, shown nothing new, and it did nothing. A seat from 2026-11-10 on holds no sitting for such a
    // wake and makes no call (noted `empty_sitting`): those are listed as skipped. Before, they were held, and are known
    // here from what the log has: woken by news with no letter, result or draft for it, and in the sitting nothing
    // asked for, sent, made or answered (only looks, its notebook and "done for now").
    const QUIET = new Set(["look", "notebook", "done_for_now"]);
    for (const s of sittings) s.empty = !!s.woken && s.woken.for === "news" && !s.woken.inbox && !s.woken.outcomes && !s.woken.drafts && !s.requests.length && !s.direct.length && s.turns.every((t: ViewData) => t.tools.every((x: ViewData) => QUIET.has(x.name)));
    const held = sittings.length;
    for (const n of raw.notes) if (n.subject === seat && n.kind === "empty_sitting") sittings.push({ t: n.t, day: dayOf(n.t), stamp: stamp(n.t), skipped: true, empty: true, woken: { for: n.data?.woke_for ?? "news" }, backAt: n.data?.back_at, turns: [], cost: 0, calls: 0, requests: [], direct: [], notes: [] });
    if (sittings.length > held) sittings.sort((a, b) => a.t - b.t || (a.skipped ? 1 : 0) - (b.skipped ? 1 : 0));
    // The notebook: what it held at each sitting's opening, and what the seat wrote into it.
    const notebookAdds: { day: number; text: string }[] = [];
    for (const s of sittings) for (const tu of s.turns.flatMap((t: ViewData) => t.tools)) if (tu.name === "notebook") { const text = tu.input.add ?? tu.input.text ?? tu.input.replace ?? JSON.stringify(tu.input); notebookAdds.push({ day: s.day, text: clip(text, 3000) }); addMentions(String(text), 2); }
    const last = sittings.filter((s) => !s.skipped).at(-1);
    const dr = debriefOut.seats.find((x) => x.seat === seat);
    const titleOf = m.titles.get(seat) ?? [...m.positions.values()].find((p) => p.holder === seat)?.title ?? nameOf(seat);
    // (Came to nothing: no act of it was carried out, whatever the reason: no draft, a draft declined or unanswered, an act refused.)
    const reqStats = { requests: myReqs.length, drafts: myReqs.filter((r) => r.ending === "draft_offered").length, confirmed: myReqs.filter((r) => r.signoff === "confirmed").length, declined: myReqs.filter((r) => r.signoff === "declined").length, askedBack: myReqs.filter((r) => r.ending === "asked_back").length, refused: myReqs.filter((r) => r.ending === "refused").length, ours: myReqs.filter((r) => r.by === "ours").length, fallback: myReqs.filter((r) => r.by === "fallback").length, nothing: myReqs.filter((r) => r.act?.status !== "applied").length };
    const steward = raw.stewards.get(seat);
    seatsOut.push({
      id: seat, title: titleOf, model: steward?.adapter ?? llm.participants?.[seat]?.adapter ?? (trs[0] ? `${trs[0].provider}/${trs[0].model}` : null), framing: steward?.framing?.disclosure ?? framing.get(seat)?.disclosure, framingReason: steward?.framing?.reason ?? framing.get(seat)?.reason,
      post: steward?.post, empty: sittings.filter((s) => s.empty && !s.skipped).length, emptyCalls: sum(sittings.filter((s) => s.empty && !s.skipped).map((s) => s.calls)), skipped: sittings.filter((s) => s.skipped).length,
      calls: trs.length, cost: sum(usageBy((u) => u.subject === seat && u.purpose === "participant").map((u) => u.cost)) / 1e6, debriefCost: sum(usageBy((u) => u.subject === seat && u.purpose === "debrief").map((u) => u.cost)) / 1e6,
      sittings: sittings.filter((s) => !s.skipped).length, tools: trs.flatMap((t) => (t.output as any[]).filter((x) => x?.type === "tool_use").map((x) => x.name)).reduce((o: any, n: string) => ((o[n] = (o[n] ?? 0) + 1), o), {}),
      acts: myActs.length, ...reqStats,
      sittingList: sittings, notebook: { final: last ? (notebookAdds.length ? last.notebookBefore ?? "" : last.notebookBefore ?? "") : "", adds: notebookAdds },
      opted_out: raw.optOuts.find((o) => o.participant === seat) ?? null,
      debrief: dr ? debriefView(dr.record) : null,
      debriefNote: !deb ? undefined : dr ? undefined : debriefOut.not_given.find((x) => x.seat === seat)?.why ?? "no debrief on record",
    });
  }
  // The notebook as the seat last saw it plus what it added after: the last opening is from before the last sitting's own
  // adds, so the final text is that opening followed by that sitting's adds.
  for (const s of seatsOut) {
    const lastS = s.sittingList.filter((x: ViewData) => !x.skipped).at(-1);
    if (lastS) {
      const lastAdds = lastS.turns.flatMap((t: ViewData) => t.tools).filter((x: ViewData) => x.name === "notebook").map((x: ViewData) => String(x.input.add ?? x.input.text ?? ""));
      s.notebook.final = [lastS.notebookBefore ?? "", ...lastAdds].filter(Boolean).join("\n");
    }
  }

  function debriefView(r: any) {
    return {
      script: r.version, ended: r.ended, keptBackAll: !!r.kept_back_all, keptBack: r.kept_back ?? [],
      steps: (r.steps ?? []).map((s: any) => {
        // A step the seat asked to keep back is shown as kept back and nothing else (VISION 15).
        if (isKeptBack(r, s)) return { id: s.id, question: s.question, keptBack: true };
        return { id: s.id, question: s.question, answer: s.answer ?? (s.id === "consent" ? (s.go_on === false ? "no" : "willing to go on") : undefined), more: s.more, values: s.values, declined: !!s.declined, stop: !!s.stop };
      }).filter((s: any) => s.id !== "publication" || s.keptBack),
      words: (r as any).apart ? "the file of what seats said was not beside this log" : undefined,
    };
  }

  // ---------- translator
  const reqList = [...requests.values()];
  const ours = reqList.filter((r) => r.by === "ours"), fb = reqList.filter((r) => r.by === "fallback");
  const share = (xs: Req[]) => ({ requests: xs.length, drafts: xs.filter((r) => r.ending === "draft_offered").length, confirmed: xs.filter((r) => r.signoff === "confirmed").length, declined: xs.filter((r) => r.signoff === "declined").length, unanswered: xs.filter((r) => r.signoff === "unanswered").length, askedBack: xs.filter((r) => r.ending === "asked_back").length, refused: xs.filter((r) => r.ending === "refused").length });
  const fbWhy: { [k: string]: number } = {};
  for (const r of fb) fbWhy[r.route?.why ?? "?"] = (fbWhy[r.route?.why ?? "?"] ?? 0) + 1;
  const forkArrangement = [...raw.stewards.values()].find((s) => s.translator?.first)?.translator;
  const translator = {
    arrangement: arrangement ? { kind: arrangement.arrangement, first: modelOf("first"), behind: modelOf("behind") } : forkArrangement ? { kind: forkArrangement.arrangement, first: forkArrangement.first, behind: forkArrangement.behind } : null, model: llm.translator?.model ?? null, version: llm.translator_version ?? llm.translator?.version ?? [...raw.stewards.values()][0]?.translator_version ?? null,
    requests: reqList.length, ours: share(ours), fallback: share(fb), single: share(reqList.filter((r) => r.by === "single")), fallbackWhy: fbWhy,
    calls: trUsage.length, usd: sum(trUsage.map((u) => u.cost)) / 1e6,
    meanMsOurs: ours.length ? Math.round(sum(ours.map((r) => r.route?.first?.ms ?? 0)) / ours.length) : null,
    // (Per seat model: requests served first time, after one restatement, never; the seats' answers to the drafts.)
    servedByModel: raw.served.byModel(),
  };

  // ---------- alerts
  const alerts: string[] = [];
  const untilS = (pilotFile.queue?.until ?? (fork?.info?.untilDay ? fork.info.untilDay * 86_400 : undefined)) as number | undefined;
  const endText = raw.end ? `${raw.end.reason}${raw.end.detail ? ` (${raw.end.detail})` : ""}` : "no end written";
  const reachedUntil = untilS !== undefined ? (raw.end?.t ?? raw.lastT) >= untilS : null;
  if (!raw.end) alerts.push("The log has no end entry: the run was cut short or is still going.");
  else if (raw.end.reason !== "completed" && !(reachedUntil && /^stopped at \d+$/.test(String(raw.end.detail ?? "")))) alerts.push(`The run ended: ${endText}.`);
  if (untilS !== undefined && reachedUntil === false) alerts.push(`The run did not reach its set length (${Math.round(untilS / 86400)} days).`);
  for (const f of raw.failedCalls) alerts.push(`A model call failed (${f.purpose}, ${f.subject}, ${stamp(f.t)}): ${f.why}`);
  for (const n of raw.notes) if (["sitting_missed", "participant_error", "prompt_too_long"].includes(n.kind)) alerts.push(`${n.subject}: ${n.kind.replace(/_/g, " ")} at ${stamp(n.t)}`);
  for (const o of raw.optOuts) alerts.push(`${o.participant} opted out at ${stamp(o.t)}: ${clip(o.statement, 200)}`);
  for (const s of seatsOut) if (s.debriefNote) alerts.push(`${s.id}: ${s.debriefNote}`); else if (s.debrief && s.debrief.ended !== "complete") alerts.push(`${s.id}: debrief ended "${s.debrief.ended}"`);
  const noTurn = raw.notes.filter((n) => n.kind === "no_turn");
  for (const n of noTurn) alerts.push(`${n.subject}: a sitting ended with no turn at ${stamp(n.t)}; it was sent away for ${n.data?.back_after_days ?? "?"} days.`);
  if (summary?.participantErrors) alerts.push(`${summary.participantErrors} participant errors on record.`);
  for (const l of waveAlerts(dir, pilotName)) alerts.push(`Wave log: ${l}`);

  // ---------- actors
  const total = (a: Actor) => a.acts + sum(Object.values(a.authored)) + a.sent.n + a.received.n;
  const dealt = [...mentionWeight.entries()].sort((a, b) => b[1] - a[1]);
  const wanted = new Set<string>();
  for (const [id] of m.entities) { const k = m.entities.get(id)!.kind; if (!["person", "shop", "landlord", "factory", "group"].includes(k)) wanted.add(id); }
  for (const [id] of dealt.slice(0, 300)) wanted.add(id);
  for (const s of m.seats) { for (const p of m.positions.values()) if (p.holder === s && p.entity) wanted.add(p.entity); wanted.add(personOf(s)); }
  const seatPersonIds = new Set((cfg.participants ?? []).filter((p: any) => m.seats.includes(p.id) && p.person).map((p: any) => p.person));
  for (const id of seatPersonIds) wanted.add(String(id));
  const itemsOf = (a: Actor) => [...a.first, ...a.last].slice(0, caps.actorItems).map((x) => ({ day: dayOf(x.t), what: clip(x.what, 220) }));
  const actors = [...wanted].filter((id) => raw.actors.has(id) || m.entities.has(id)).map((id) => {
    const a = raw.actors.get(id);
    const ent = m.entities.get(id);
    const dealtWith = [...requests.values()].filter((r) => r.words.includes(id) || r.act?.blocks.some((b: any) => (b.to ?? []).includes(id) || JSON.stringify(b.facts).includes(id))).map((r) => ({ id: r.id, seat: r.seat, day: dayOf(r.t), words: clip(r.words, 160) })).slice(0, 12);
    return {
      id, name: ent?.name ?? nameOf(id), kind: ent?.kind ?? (seatPersonIds.has(id) ? "person" : "?"), weight: mentionWeight.get(id) ?? 0,
      acts: a?.acts ?? 0, blocks: a?.blocks ?? {}, roles: a?.roles ?? {}, authored: a?.authored ?? {},
      sent: a ? { n: a.sent.n, amt: fmt(String(a.sent.amt)) } : { n: 0, amt: fmt("0") }, received: a ? { n: a.received.n, amt: fmt(String(a.received.amt)) } : { n: 0, amt: fmt("0") },
      days: a ? pad(a.days, days) : [], items: a ? itemsOf(a) : [], dealtWith, seat: m.seats.find((s) => personOf(s) === id || [...m.positions.values()].some((p) => p.holder === s && p.entity === id)) ?? null,
    };
  }).filter((a) => total({ ...(raw.actors.get(a.id) ?? ({ acts: 0, authored: {}, sent: { n: 0 }, received: { n: 0 } } as any)) }) > 0 || a.dealtWith.length || a.weight)
    .sort((a, b) => b.weight - a.weight || (b.acts + sum(Object.values(b.authored) as number[])) - (a.acts + sum(Object.values(a.authored) as number[])));

  // ---------- twin comparison
  let twin: ViewData | null = null;
  if (twinRaw) {
    const per: ViewData[] = [];
    for (const seat of m.seats) {
      const mine = raw.seatActs.filter((a) => a.participant === seat);
      const myPositions = new Set([...m.positions].filter(([, p]) => p.holder === seat).map(([id]) => id));
      // (Acts of the post that staff do in the seat's run too, whoever holds the post, are not the seat's to compare.)
      const theirs = twinRaw.seatActs.filter((a) => myPositions.has(a.as) && !a.blocks.every((b) => raw.otherKinds.get(a.as)?.has(b.block + (b.kind ? `:${b.kind}` : ""))));
      const allPairs = compareActs(mine, theirs);
      // Twin acts of a kind the seat never made are the post's other work (hearing notices the twin's member also writes): counted, not listed.
      const seatKinds = new Set(mine.flatMap((a) => a.blocks.map((b) => b.block + (b.kind ? `:${b.kind}` : ""))));
      const otherWork: { [k: string]: number } = {};
      const pairs = allPairs.filter((p) => {
        if (p.seat || !p.twin) return true;
        const ks = p.twin.blocks.map((b) => b.block + (b.kind ? `:${b.kind}` : ""));
        if (ks.every((k) => !seatKinds.has(k))) { for (const k of ks) otherWork[k] = (otherWork[k] ?? 0) + 1; return false; }
        return true;
      });
      const view = (x?: { t: number; as: string; blocks: any[]; reasoning?: string; seq?: number }) => x && { seq: x.seq, t: x.t, day: dayOf(x.t), stamp: stamp(x.t), as: x.as, blocks: x.blocks.map((b: any) => ({ ...b, text: clip(b.text, 300) })), signature: decisionSignature(x.blocks), reasoning: clip(x.reasoning, 300) };
      per.push({
        seat, title: seatsOut.find((s) => s.id === seat)?.title, seatActs: mine.length, twinActs: theirs.length, matched: pairs.filter((p) => p.seat && p.twin).length, same: pairs.filter((p) => p.seat && p.twin && p.same).length,
        differ: pairs.filter((p) => p.seat && p.twin && !p.same).length, seatOnly: pairs.filter((p) => p.seat && !p.twin).length, twinOnly: pairs.filter((p) => !p.seat && p.twin).length,
        pairs: pairs.slice(0, 400).map((p: Pair) => ({ same: p.same, seat: view(p.seat), twin: view(p.twin) })),
        truncated: pairs.length > 400, twinOtherWork: otherWork,
      });
    }
    twin = { dir: twinDir, run: twinRaw.header?.run_id, seats: per, lines: twinRaw.lines };
  }

  // ---------- town
  const D = days;
  const ser = (r: Raw) => ({ acts: pad(r.daily.acts, D), refused: pad(r.daily.refused, D), payments: pad(r.daily.payments, D), moved: pad(r.daily.moved, D).map((x) => Math.round(x)), papers: pad(r.daily.papers, D), messages: pad(r.daily.messages, D), worked: pad(r.daily.worked, D) });
  const kindTotals = [...raw.daily.kinds.entries()].map(([k, v]) => [k, sum(v)] as [string, number]).sort((a, b) => b[1] - a[1]);
  const town = {
    days: D, currency: cur.code ?? "", series: ser(raw), twinSeries: twinRaw ? ser(twinRaw) : null,
    kinds: Object.fromEntries(kindTotals.slice(0, 40).map(([k]) => [k, pad(raw.daily.kinds.get(k)!, D)])), kindTotals,
    twinKinds: twinRaw ? Object.fromEntries(kindTotals.slice(0, 40).map(([k]) => [k, pad(twinRaw!.daily.kinds.get(k) ?? [], D)])) : null,
    people: { start: (cfg.participants ?? []).filter((p: any) => p.kind === "person").length - m.seats.length * 0, arrived: sum(raw.people.arrived), created: sum(raw.people.created), left: sum(raw.people.left), died: sum(raw.people.died) },
    census: raw.census.map((c) => ({ day: dayOf(c.t), counters: c.counters })),
    unitMoney: cur.symbol ?? "",
    minorUnits: cur.minor_units ?? 2,
  };

  // ---------- overview
  const pilotQueue = pilotFile.queue ?? {};
  const profile = batch?.spec?.profile ?? (pilotQueue.sets ?? []).find((s: string) => s.startsWith("profile="))?.slice(8) ?? null;
  const overview = {
    pilot: pilotName, run: runOf(log), note: pilotFile.note ?? null, test: !!pilotQueue.test,
    town: cfg.meta?.name ?? null, description: cfg.meta?.description ?? null, profile, seed: cfg.seed ?? batch?.config_seed ?? null,
    people: batch?.spec?.citizens ?? null, days: Math.round(((raw.end?.t ?? raw.lastT) / 86_400) * 10) / 10, untilDays: untilS !== undefined ? Math.round(untilS / 86400) : null,
    end: endText, finished: !!raw.end && reachedUntil !== false,
    framing: [...new Set(seatsOut.map((s) => s.framing).filter(Boolean))], framingReason: seatsOut.find((s) => s.framingReason)?.framingReason ?? null,
    started: batch?.started ?? null, wallMinutes: batch?.wall_ms ? Math.round(batch.wall_ms / 60000) : null,
    cost: { usd: totalMicro / 1e6, calls: raw.usage.length, limit: llm.spending_limit_microusd ? llm.spending_limit_microusd / 1e6 : null, byModel },
    seats: seatsOut.map((s) => ({ id: s.id, title: s.title, model: s.model, calls: s.calls, sittings: s.sittings, cost: s.cost, requests: s.requests, confirmed: s.confirmed, declined: s.declined, acts: s.acts, ours: s.ours, fallback: s.fallback, nothing: s.nothing, empty: s.empty, emptyCalls: s.emptyCalls, skipped: s.skipped, framing: s.framing, post: s.post })),
    experiment: fork?.info ?? null,
    translator, alerts, logLines: raw.lines, twinFound: !!twin,
    generated: { by: "oikos pilot-view", log: basename(log) },
  };
  const data: ViewData = { overview, seats: seatsOut.map(({ sittingList, ...rest }) => ({ ...rest, sittings: sittingList.map((s: ViewData) => ({ ...s, turns: s.turns.map((t: ViewData) => ({ ...t, tools: t.tools.filter((x: ViewData) => !SEAT_TOOLS_HIDDEN.has(x.name) || true) })) })) })), actors, twin, town, systems: Object.fromEntries([...raw.systems].filter(([k]) => seatsOut.some((s) => s.sittingList.some((x: ViewData) => x.system === k || x.turns.some((t: ViewData) => t.system === k))))) };
  return data;
}
