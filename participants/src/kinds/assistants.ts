import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";

/**
 * A provider of assistants (docs/behaviour/assistants.md; docs/design/delegation.md): it sells the work of its systems as a
 * service, at the profile's prices, delivers a system to an organisation that orders and pays the set-up, offers the
 * service agreement, and switches its systems off when the agreement ends or is not paid for. It owns nothing in the town.
 */
export const provider: BehaviourModule = {
  name: "firm.provider",
  answers: { office: "a provider of assistants", acts: "It publishes what it sells, sets up a service once its set-up is paid with an order (delivering a system to an organisation), offers the service agreement, and switches its systems off when the agreement ends or is not paid for. It takes no requests." },
  version: "0.1.0",
  doc: "docs/behaviour/assistants.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("firm.provider"),
};

/**
 * The assistant's code (docs/behaviour/assistants.md): it plays a provider's system when no model holds it, doing what
 * its principal hands it at the level asked (advice, a draft for sign-off, a request to go ahead, or the act), and reports.
 */
export const assistant: BehaviourModule = {
  name: "assistant",
  answers: { office: "an assistant", acts: "It does what it is handed, at the level it is asked: it advises, drafts for sign-off, asks to go ahead, or acts, and reports. It acts on nothing it is not handed." },
  version: "0.1.0",
  doc: "docs/behaviour/assistants.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("assistant"),
};
