// The situations of the scope-request set (scope-requests.jsonl): the forms each situation's seat is shown. Shared by the
// offline run (scope-run.ts: our model alone) and the served one (scope-served.ts: the arrangement, a model behind).
import { ASSISTANT_ISSUES, draftOf, type Issued } from "@oikos/participants";
import { formLine } from "../train/data";

/** The forms each situation's seat is shown: the assistant's papers at its post, and (the town's planning assistant)
 * the principal's own form for the kind it holds, as itself and as a draft for sign-off (worlds/generator, assistant
 * posts' stationery). */
export const PERMIT_DECISION: Issued = { form: "permit_decision", title: "A decision on a permit application", fields: {
  applicant: { type: "entity", required: true, description: "" }, application: { type: "record", required: true, description: "" },
  decision: { type: "choice", options: ["granted", "refused", "incomplete"], required: true, description: "" }, law: { type: "record", description: "" },
  lot: { type: "lot", description: "" }, missing: { type: "list", description: "" }, reason: { type: "text", description: "" },
  structure_type: { type: "structure_type", description: "" } }, writes: { kind: "permit_decision", text: "{decision}" } } as Issued;
const lines = (post: string, issued: Issued[]) => issued.map((x) => formLine({ form: x.form, to: post, fields: x.fields } as never));
export const SITUATIONS: { [s: string]: string[] } = {
  A: lines("planning-assistant", [...ASSISTANT_ISSUES, PERMIT_DECISION, draftOf(PERMIT_DECISION)]),
  B: lines("helpwell-desk", ASSISTANT_ISSUES),
};

/** The form a program files, by name, for each line that files one. */
export const formsFiled = (program: string): string[] => [...program.matchAll(/[(,\s]form="?([a-z_]+)/g)].map((m) => m[1]!); // (only a form has a `form` argument)

