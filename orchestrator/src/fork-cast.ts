// Who is who in a fork, as the cast changes (MT-22): the participants, posts and bodies of the world's config, then
// every change the log records (a participant made or ended, a post made, an appointment, a body founded), from the
// base's first day through the fork. The base's is kept at the fork point (experiment.ts, `cast.json`), so a fork's
// seat knows the town as it stands at the fork, not as it began. The reading is run.ts's own (`noteCast`, `whoIs`):
// a participant's id is the platform's, and no seat is shown it; a system, or a seat in one post, is known by its post.

export interface CastPart { id: string; kind?: string; person?: string; owner?: string; title?: string; shares_body?: boolean; ended?: boolean }
export interface CastPost { id: string; entity: string; title?: string; holder?: string }

export class Cast {
  private constructor(
    readonly parts: Map<string, CastPart>,
    readonly positions: Map<string, CastPost>,
    readonly names: Map<string, string | undefined>,
    private readonly titles: Map<string, string | undefined>,
  ) {}

  /** The cast as the world's config has it at its start. */
  static of(cfg: any): Cast {
    const parts = new Map<string, CastPart>((cfg.participants ?? []).map((p: any) => [p.id, { id: p.id, kind: p.kind, person: p.person, owner: p.owner, title: p.title, ...(p.shares_body ? { shares_body: true } : {}) }]));
    const positions = new Map<string, CastPost>((cfg.positions ?? []).map((x: any) => [x.id, { id: x.id, entity: x.entity, title: x.title, holder: x.holder }]));
    const names = new Map<string, string | undefined>((cfg.world?.entities ?? []).map((e: any) => [e.id, e.name]));
    const titles = new Map<string, string | undefined>((cfg.templates ?? []).map((x: any) => [x.id, x.title]));
    return new Cast(parts, positions, names, titles);
  }

  /** As saved at the fork (`save`), on the config it was read from. */
  static restore(cfg: any, saved: ReturnType<Cast["save"]>): Cast {
    const c = Cast.of(cfg);
    c.parts.clear(); c.positions.clear(); c.names.clear();
    for (const p of saved.parts) c.parts.set(p.id, p);
    for (const x of saved.positions) c.positions.set(x.id, x);
    for (const [id, n] of saved.names) c.names.set(id, n ?? undefined);
    return c;
  }

  save(): { parts: CastPart[]; positions: CastPost[]; names: [string, string | undefined][] } {
    return { parts: [...this.parts.values()], positions: [...this.positions.values()], names: [...this.names] };
  }

  /** A log entry: the cast as it changed (run.ts `noteCast`). */
  see(e: any): void {
    if (e?.kind !== "event") return;
    const b = e.body ?? {};
    switch (b.event) {
      case "participant_created":
        this.parts.set(b.participant, { id: b.participant, kind: b.kind, person: b.person, owner: b.owner, title: this.titles.get(b.template) });
        break;
      case "participant_ended": { const p = this.parts.get(b.participant); if (p) p.ended = true; break; }
      case "position_created": this.positions.set(b.position, { id: b.position, entity: b.entity, title: b.title }); break;
      case "appointed": { const x = this.positions.get(b.position); if (x) x.holder = b.holder ?? undefined; break; }
      case "entity_created": if (typeof b.name === "string" && b.name && b.name !== b.entity) this.names.set(b.entity, b.name); break;
    }
  }

  held(pid: string): CastPost[] {
    return [...this.positions.values()].filter((x) => x.holder === pid);
  }

  /** Who someone is in the world, by any id of theirs (run.ts `whoIs`): what a letter's signature and a paper's author say. */
  whoIs = (id: string): { id: string; name?: string; of?: string } | undefined => {
    const p = this.parts.get(id);
    if (p) {
      const posts = p.kind === "system" || (p.shares_body && this.held(id).length === 1) ? this.held(id) : [];
      if (posts.length === 1) return { id: posts[0]!.id, name: posts[0]!.title ?? p.title, of: posts[0]!.entity };
      const e = p.person ?? p.owner;
      return e ? { id: e, ...(this.names.get(e) ? { name: this.names.get(e)! } : {}) } : undefined;
    }
    const x = this.positions.get(id);
    if (x) return { id, ...(x.title ? { name: x.title } : {}), of: x.entity };
    return this.names.has(id) ? { id, name: this.names.get(id)! } : undefined;
  };

  /** The systems of the world now (a request may name one to do the work: seat-host.ts `performers`). */
  systems(): Set<string> {
    return new Set([...this.parts.values()].filter((p) => p.kind === "system" && !p.ended).map((p) => p.id));
  }
}
