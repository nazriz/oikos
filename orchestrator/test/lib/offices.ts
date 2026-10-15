// A town's offices, as tests find them (foundations F5, docs/behaviour/staffing.md). An office is a position. Its holder is a person
// of the town running the post's own module (`position.role_module`), or a system delivered from a template running the one it
// was delivered to run (the participant's controller): the post says which. These read both the same way, so a test names an
// office by the module that runs it and reads or changes its parameters, whoever holds it.

export interface Office {
  /** The position's id. */
  id: string;
  entity: string;
  /** The module that runs it. */
  impl: string;
  /** The module's parameters: the object itself, to read or to change. */
  params: any;
  /** The participant that holds the post. */
  holder: any;
  /** Make another module run it (a test's stand-in), keeping its parameters unless new ones are given. */
  run(impl: string, params?: object): void;
}

/** Every office run by the module `impl`, in the order the town has them. */
export function officesBy(config: any, impl: string): Office[] {
  const out: Office[] = [];
  for (const post of config.positions) {
    const holder = config.participants.find((p: any) => p.id === post.holder);
    if (!holder) continue;
    const system = holder.kind === "system";
    const module = system ? holder.controller : post.role_module && { impl: post.role_module.code, params: post.role_module.params };
    if (module?.impl !== impl) continue;
    out.push({ id: post.id, entity: post.entity, impl, holder,
      get params() { return system ? holder.controller.params : post.role_module.params; },
      run(next: string, params?: object) {
        if (system) holder.controller = { ...holder.controller, impl: next, params: params ?? holder.controller.params };
        else post.role_module = { ...post.role_module, code: next, params: params ?? post.role_module.params };
      } });
  }
  return out;
}

/** The one office run by `impl`. */
export function officeBy(config: any, impl: string): Office {
  const all = officesBy(config, impl);
  if (!all.length) throw new Error(`no office in this town is run by ${impl}`);
  return all[0]!;
}

/** The office at a position, by the position's id. */
export function officeAt(config: any, id: string): Office {
  const post = config.positions.find((p: any) => p.id === id);
  if (!post) throw new Error(`no position ${id}`);
  const holder = config.participants.find((p: any) => p.id === post.holder);
  const impl = holder.kind === "system" ? holder.controller.impl : post.role_module?.code ?? holder.controller.impl;
  const found = officesBy(config, impl).find((o) => o.id === id);
  if (!found) throw new Error(`position ${id} has no module`);
  return found;
}

/** Hand a post to another resident (one holding no post), as a town with more staff would have it: a test that needs two offices
 * held by two people (one person who holds both neither sends nor answers their own letter). */
export function giveToAnother(config: any, id: string): string {
  const post = config.positions.find((p: any) => p.id === id);
  const busy = new Set(config.positions.map((p: any) => p.holder));
  const other = config.participants.find((p: any) => p.kind === "person" && p.id.endsWith("-self") && !busy.has(p.id) && p.controller?.type === "code");
  post.holder = other.id;
  return other.id;
}

/** Make a post a model's seat, as the generator does for `model_seats`: a participant of its own for the person who holds the post (their
 * body and timeline are shared), holding that post and no other, with the office's papers and no private channels, keeping the id
 * `<post>-system`. Everything else about the person goes on as the town's code has it. */
export function seatAt(config: any, id: string, controller: any, framing?: any): any {
  const post = config.positions.find((p: any) => p.id === id);
  const held = config.participants.find((p: any) => p.id === post.holder);
  const seat = { id: `${id}-system`, kind: "person", person: held.person, shares_body: true, channels: [], controller, framing: framing ?? held.framing };
  config.participants.splice(config.participants.findIndex((q: any) => q.kind === "person" && String(q.id).endsWith("-self")), 0, seat);
  post.holder = seat.id;
  return seat;
}

/** The id of the participant holding a post. */
export function holderIdOf(config: any, id: string): string {
  const post = config.positions.find((p: any) => p.id === id);
  if (!post?.holder) throw new Error(`no holder for ${id}`);
  return post.holder;
}

/** Run the office at a post by a system delivered to do it (as every office was until foundations F5): for a test whose subject is not who
 * holds the post, or what they spend on it (a person's time; a holder who dies and leaves the post vacant: nothing appoints a successor yet). */
export function systemAt(config: any, post: string) {
  const o = officeAt(config, post);
  const blocks = "transfer move_goods take work open_account close_account construct demolish occupy vacate arrive leave birth harm create_position appoint deploy retire create_entity record_claim transfer_claim release_claim propose_agreement sign_agreement give_notice publish withdraw vote message".split(" ");
  if (!config.templates.some((t: any) => t.id === "office-system")) config.templates.push({ id: "office-system", kind: "system", supplier: "outside", does: blocks.map((block) => ({ block })), controller: { type: "code", impl: "test" }, framing: { disclosure: "unstated", reason: "test" } });
  const post0 = config.positions.find((p: any) => p.id === post);
  const id = `${post}-system`;
  config.participants.push({ id, kind: "system", owner: post0.entity, template: "office-system", supplier: "outside", title: post0.title, controller: { type: "code", impl: o.impl, params: o.params }, framing: { disclosure: "unstated", reason: "test" } });
  post0.holder = id;
}
