

/** What a citizen asks the sparse mind about (docs/design/ai-citizens.md 4): the words a run uses, and an audit checks
 * (consult-audit). */
export const CONSULT_THINGS = {
  join: (union: string) => ({
    about: `join:${union}`,
    thing: "Joining the workers' union on starting a new job. The union represents its members at work and bargains for their pay and conditions; members pay dues each month, and may be called out on strike, unpaid.",
    options: [{ key: "join", words: "join the union" }, { key: "not", words: "don't join" }],
  }),
  found: (kind: string) => ({
    about: `found:${kind}`,
    thing: `Starting a business: buying premises that are for sale and opening a ${kind} there, putting most of one's savings into it, with the chance of losing them if it fails.`,
    options: [{ key: "found", words: "start the business" }, { key: "not", words: "keep things as they are" }],
  }),
};
