// A model seat's configuration as the host makes it from the world's config: its reports (channels and their titles),
// which are standing documents, which it reads on request, which way each reaches it (docs/design/knowing.md), its
// in-trays, its office's own file and staff, and the rest of `LlmParticipantConfig` (participants/src/llm/participant.ts).
// One place, so that a seat is the same seat whichever host runs it: the run's (run.ts, `llmUnit`) and the experiment
// harness's (seat-host.ts, a model steward in a fork).

import { DayBook, diaryText, Roster, Tally, type BehaviourModule, type ParticipantContext } from "@oikos/participants";
import type { LlmParticipantConfig } from "@oikos/participants/llm";

/** A position as a host knows it (the config's, and as position_created / appointed change it). */
export interface SeatPos { id: string; entity: string; title?: string; role?: string; channels: any[]; role_module?: any; holder?: string }

export interface SeatConfigInput {
  cfg: any;
  /** The participant: its id, title, framing and controller (`params` are the seat's). */
  part: { id: string; title?: string; framing: any; controller: any; person?: string; owner?: string };
  /** Its own channels (a participant's, or its template's). */
  personal: any[];
  /** The posts it holds now, and every post (for its organisation's other offices and its staff's post). */
  mine: SeatPos[];
  positions: Map<string, SeatPos>;
  mods: { [name: string]: BehaviourModule };
  whoIs: (id: string) => { id: string; name?: string; of?: string } | undefined;
  ctxFor: (pid: string, cap: string, entity: string, params: any) => ParticipantContext;
  /** A mock seat that sits as its code twin (no office hours of its own; back to the second). */
  twin: boolean;
  draftText: (d: any) => string;
  /** Keys sorted (the log keeps the config in canonical form). */
  sorted: (v: unknown) => unknown;
}

export interface SeatConfig {
  config: LlmParticipantConfig;
  office?: SeatPos;
  entity: string;
  entityName?: string;
  standingIds: string[];
  roster?: Roster;
  tally?: Tally;
  dayBook: DayBook;
}

export function seatConfig(x: SeatConfigInput): SeatConfig {
  const { cfg, part: p, mine, positions, mods, whoIs, ctxFor, twin } = x;
  const pp = p.controller?.params ?? {};
  // Channel paths as the kernel names them: its own, and each held position's as <position>/<channel>.
  const chans: { path: string; ch: any }[] = [
    ...x.personal.map((ch: any) => ({ path: ch.id, ch })),
    ...mine.flatMap((o) => o.channels.map((ch: any) => ({ path: `${o.id}/${ch.id}`, ch }))),
  ];
  const titles = new Map<string, string>(chans.filter((c) => c.ch.title).map((c) => [c.path, c.ch.title]));
  const standingIds: string[] = (pp.standing ?? []).flatMap((s: string) => chans.filter((c) => c.path === s || c.path.endsWith(`/${s}`)).map((c) => c.path));
  const onRequest = chans.filter((c) => c.ch.on_request).map((c) => c.path);
  const office = mine.length === 1 ? mine[0] : undefined;
  // (A person who holds one office, as a seat's person does, acts for its organisation: that is the entity its papers and trays are of.)
  const entity = office?.entity ?? p.person ?? p.owner!;
  const entityName = (cfg.world?.entities ?? []).find((e: any) => e.id === entity)?.name;
  // What kind of report each is: with it, the seat can look into its papers, its buildings and ground, and who's who.
  const kinds = new Map<string, string>(chans.map((c) => [c.path, c.ch.kind]));
  // And which way each reaches it (docs/design/knowing.md): a register asked of its keeper is asked about one named
  // thing (by which fields), a board searched, who's who looked up, a place gone to.
  const boards = new Set<string>((cfg.knowing?.published ?? []).filter((b: any) => b.board).map((b: any) => b.what));
  const ways = new Map<string, { way: string; by?: string[]; board?: boolean }>(chans.filter((c) => c.ch.way).map((c) => [c.path, { way: c.ch.way, ...(c.ch.by ? { by: c.ch.by } : {}),
    ...(c.ch.way === "published" && !c.ch.from && (c.ch.match?.statement_kinds ?? []).some((k: string) => boards.has(k)) ? { board: true } : {}) }]));
  // An office that employs staff of its own (its module says so: `staffed`): whoever holds it knows its posts, who is
  // in each and which are vacant, from the office's own papers (readers/roster.ts). Kept from what the seat is shown.
  const staffedBy = office ? mods[office.role_module?.code ?? ""]?.staffed?.(office.role_module?.params ?? {}) : undefined;
  const roster = office && staffedBy ? new Roster(ctxFor(p.id, office.id, entity, {}), entity, office.id, staffedBy, (mods[office.role_module?.code ?? ""]?.routines ?? []).map((r) => r.task)) : undefined;
  // A seat that keeps its body's ballots, or votes on them (the world says which: `ballot_count`), has the count of
  // each ballot not yet declared, or its own vote on file, set out from the votes it has been shown (readers/tally.ts).
  const tally = office && (pp.ballot_count === "keeper" || pp.ballot_count === "member") ? new Tally(entity, pp.ballot_count === "member" ? office.id : undefined) : undefined;
  // And its diary (readers/diary.ts): how long its own work takes it and what its staff have in a week, the town's practice as the town states it.
  const times: { [row: string]: number } = cfg.orchestration?.act_time?.person ?? {};
  const diary = (at: number) => office && Object.keys(times).length ? diaryText({ title: office.title ?? office.id, times, issues: mods[office.role_module?.code ?? ""]?.issues ?? [], ...(cfg.catalogue?.working_day ? { workday: cfg.catalogue.working_day } : {}), ...(roster ? { staff: roster.now(at) } : {}) }) : undefined;
  const setOut = (at: number) => [roster ? roster.text(at, office!.title ?? office!.id, (id: string) => whoIs(id)?.name) : "", tally ? tally.text(at, office!.title ?? office!.id) : "", diary(at) ?? ""].filter(Boolean).join("\n\n");
  // Its in-trays (what a paper filed with its office comes into): its own papers of some kinds only, or a folder of
  // some kinds; and the folders that hold every paper of its organisation's. And whose papers are its office's own
  // doing: its own, and its staff's where they are a post of their own.
  const folderKinds = new Map<string, string[]>(Object.entries((pp.folders ?? {}) as { [id: string]: string[] }).flatMap(([id, ks]) => chans.filter((c) => c.path === id || c.path.endsWith(`/${id}`)).map((c) => [c.path, ks] as [string, string[]])));
  const own = chans.filter((c) => c.ch.kind === "records" && c.ch.way === "mine" && !c.ch.on_request && !standingIds.includes(c.path));
  const narrow = (m: any) => !!(m?.statement_kinds?.length || m?.records?.length || m?.has?.length);
  const trays = { kinds: new Map<string, string[] | true>(own.flatMap((c): [string, string[] | true][] => (folderKinds.has(c.path) ? [[c.path, folderKinds.get(c.path)!]] : narrow(c.ch.match) ? [[c.path, true]] : []))),
    all: new Set(own.filter((c) => !folderKinds.has(c.path) && !narrow(c.ch.match)).map((c) => c.path)),
    // (Its organisation's only office, its own staff's post apart: what is addressed to the organisation is its post.)
    ...(office && [...positions.values()].filter((y: any) => y.entity === office.entity && !mine.some((m) => y.id === `${m.id}-staff`)).length === 1 ? { sole: true } : {}) };
  const ownAuthors = mine.flatMap((o) => { const staff = positions.get(`${o.id}-staff`)?.holder; return staff ? [staff] : []; });
  // The office's own file (readers/daybook.ts): its own papers and payments, and what stands open on its books (its
  // module's `books`, read from what the seat is shown as its clerk reads it), set out at every sitting.
  const officeModule = office ? mods[office.role_module?.code ?? ""] : undefined;
  const dayBook = new DayBook({ entity, authors: [p.id, ...ownAuthors], name: (id: string) => whoIs(id)?.name,
    ...(office && officeModule?.books ? { books: officeModule.books(ctxFor(p.id, office.id, entity, x.sorted(office.role_module?.params ?? {}) as any)) } : {}) });
  const config: LlmParticipantConfig = { dayBook: { text: (at: number) => dayBook.text(at, office?.title ?? entityName ?? "The office") }, ...(pp.mock?.debrief ? { mockDebrief: pp.mock.debrief } : {}), trays, ownAuthors, ...(pp.wake_on_papers === false ? { wakeOnPapers: false } : {}), ...(typeof pp.effort === "string" && pp.effort ? { effort: pp.effort } : {}), ...(roster || tally || (office && Object.keys(times).length) ? { staff: { text: setOut } } : {}), whoIs, participant: p.id, entity, entityName, onRequest, kinds, ways, title: office?.title ?? p.title, role: office?.role, framing: p.framing, standing: standingIds, titles, cadenceDays: pp.cadence_days ?? 7, draftText: x.draftText,
    ...(pp.sessions && !twin ? { sessions: pp.sessions } : {}), ...(twin ? { exactBack: true } : {}), ...(pp.max_actions ? { maxActions: pp.max_actions } : {}),
    // Folders that hold some kinds of paper only (by the channel's own id, as `standing` is given), and the most a prompt may be.
    ...(pp.folders ? { folders: new Map<string, string[]>(Object.entries(pp.folders as { [id: string]: string[] }).flatMap(([id, ks]) => chans.filter((c) => c.path === id || c.path.endsWith(`/${id}`)).map((c) => [c.path, ks] as [string, string[]]))) } : {}),
    ...(pp.prompt_max ? { promptMax: pp.prompt_max } : {}) } as LlmParticipantConfig;
  return { config, ...(office ? { office } : {}), entity, ...(entityName ? { entityName } : {}), standingIds, ...(roster ? { roster } : {}), ...(tally ? { tally } : {}), dayBook };
}
