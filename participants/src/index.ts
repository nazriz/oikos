export * from "./contracts";
export * from "./module";
export { manifests, paramErrors, type Manifest } from "./manifests";
export * from "./rng";
export { slip, slipPpm, slipRow, type SlipRow, type SlipTable, type Slipper, type SlipOptions } from "./slip";
export * from "./law";
export * from "./canon";
export * from "./money";
export * as calls from "./calls";
export * as forms from "./forms";
export { View } from "./view";
export { ASKING, CONSULT_THINGS } from "./behaviour/citizen";
export { drawPerson, drawValues, NEEDS, VALUES, type PopulationValues } from "./behaviour/mind";
export { Inner, innerParams, INNER_DEFAULTS, raisedValues, UPBRINGING, type InnerParams, type Outlook } from "./behaviour/inner";
export { MOURNING } from "./behaviour/citizen";
export { repayment } from "./behaviour/credit";
export { draftLaw, figureGiven, figureWords, heldIn, heldValue, type LawFigure, type LawFigures, type LawSchedule } from "./behaviour/common";
export { annualTax, chargesInWords, chargesOn, dayPayPeriod, returnsInWords, taxLawOf, withheld, withholding, withholdingInWords, type Band, type Charge, type IncomeTaxLaw } from "./behaviour/tax";
export { dueFrom, nextReturn, returnDayWords, returnRuleInWords, returnRulesOf, returnsOf, MONTH_WORDS, type ReturnDue, type ReturnRule } from "./behaviour/returns";
export { declarationFor, forAge, forHousehold, forOutOfWork, paymentsInWords, stopsWorkAt, supportLaw, type Declared, type PaymentRule } from "./behaviour/payments";
export { adultAgeBands, drawHousehold, drawSavings, bedroomsNeeded, OCCUPANCY, type DrawnHousehold, type Extension, type HouseholdSpec, type OccupancyStandard } from "./behaviour/household";
export { yearsOfSchooling, type SchoolingSpec } from "./behaviour/school";
export { linesInWords, tabledLines, votedWords, yearInDays } from "./behaviour/government";
export { Roster, type RosterNow } from "./behaviour/roster";
export { Tally, type BallotCount } from "./behaviour/tally";
export { DayBook, DAYBOOK_MAX, LISTED_DAYS } from "./behaviour/daybook";
export { decisionLaw, decisionsInWords, KIND as DECISION_KIND, Reconsiderations, Waits, type DecisionLaw, type Need as DecisionNeed } from "./behaviour/decisions";
export { particularsOf } from "./behaviour/frictions";
export { diaryText } from "./behaviour/diary";
export { planLaw, planLawWords, POSSESSION_ANSWER, CLAIM_EVIDENCE, CONFIRMATION_ANSWER, REVIEW_REQUEST, possessionOrderFor } from "./behaviour/papers";
import type { BehaviourModule } from "./module";
import { answering } from "./behaviour/common";
import { bankPaymentSystem } from "./behaviour/bank";
import { disposal, exportDemand, funding, grants, idle, migration, statistics, trade, transfers, valuer, weather } from "./behaviour/world";
import { lending } from "./behaviour/credit";
import { organiser } from "./behaviour/union";
import { citizen } from "./behaviour/citizen";
import { employer, landlord } from "./behaviour/firms";
import { producer } from "./behaviour/producer";
import { retailer } from "./behaviour/retailer";
import { vendor } from "./behaviour/automation";
import { builder, childProtection, inspector, landRegistry, planningOfficer, registry } from "./behaviour/institutions";
import { councilClerk, councillor, financeOfficer, mayorCode, ratesOfficer, taxClerk, works } from "./behaviour/government";
import { environment } from "./behaviour/environment";
import { bodyPayroll } from "./behaviour/payroll";
import { electoralOffice } from "./behaviour/elections";
import { newspaper } from "./behaviour/news";
import { principal } from "./behaviour/school";
import { practice } from "./behaviour/health";
import { member, registrar } from "./behaviour/tribunal";
import { desk } from "./behaviour/desk";
import { founded } from "./behaviour/founded";
import { energy, water } from "./behaviour/utilities";
import { station } from "./behaviour/police";
import { retirementFund } from "./behaviour/fund";
import { booked, clerk, Clerk, keepers, officeOf } from "./behaviour/books";
import * as openbooks from "./behaviour/openbooks";
import * as venueBooks from "./behaviour/openbooks-venues";
import * as townBooks from "./behaviour/openbooks-townhall";
export { firstDueOf } from "./behaviour/openbooks";
export { BOOKS, booksPaper, Clerk, officeOf } from "./behaviour/books";

/** A module that keeps books (`books`), run as its office's staff (`part: "staff"`): the staff's clerk keeps them too,
 * and files what has changed when the staff's own work for the wake is done (docs/behaviour/office-books.md). */
/** Each office's books, by the module that runs it (behaviour/openbooks.ts): what its clerk reads. */
const BOOKS_OF: { [module: string]: BehaviourModule["books"] } = {
  "firm.landlord": openbooks.landlordBooks,
  "world.transfers": openbooks.supportBooks,
  "tribunal.member": venueBooks.tribunalMemberBooks,
  "tribunal.registrar": venueBooks.tribunalRegistrarBooks,
  "office.desk": venueBooks.deskBooks,
  "union.organiser": venueBooks.unionBooks,
  "bank.lending": venueBooks.lendingBooks,
  "city.finance_officer": townBooks.financeBooks,
  "city.mayor_code": townBooks.mayorBooks,
  "city.works": townBooks.worksBooks,
  "city.environment": townBooks.environmentBooks,
  "city.planning_officer": townBooks.planningBooks,
  "city.council_clerk": townBooks.clerkBooks,
};
function keepingBooks<M extends BehaviourModule>(given: M): M {
  const m = BOOKS_OF[given.name] ? { ...given, books: BOOKS_OF[given.name] } : given;
  if (!m.books) return m;
  return { ...m, create: (ctx) => {
    const c = m.create(ctx);
    return ctx.params?.part === "staff" ? booked(c, new Clerk(ctx.entity, officeOf(ctx.position), m.books!({ ...ctx, position: officeOf(ctx.position) }))) : c;
  } };
}

/** Every behaviour module available to worlds, by the name used in controller.impl. */
export const modules: { [name: string]: BehaviourModule & { source: string } } = Object.fromEntries(
  (
    [
      [bankPaymentSystem, "behaviour/bank.ts"],
      [exportDemand, "behaviour/world.ts"],
      [idle, "behaviour/world.ts"],
      [migration, "behaviour/world.ts"],
      [trade, "behaviour/world.ts"],
      [transfers, "behaviour/world.ts"],
      [funding, "behaviour/world.ts"],
      [weather, "behaviour/world.ts"],
      [valuer, "behaviour/world.ts"],
      [statistics, "behaviour/world.ts"],
      [grants, "behaviour/world.ts"],
      [disposal, "behaviour/world.ts"],
      [lending, "behaviour/credit.ts"],
      [organiser, "behaviour/union.ts"],
      [citizen, "behaviour/citizen.ts"],
      [landlord, "behaviour/firms.ts"],
      [employer, "behaviour/firms.ts"],
      [producer, "behaviour/producer.ts"],
      [retailer, "behaviour/retailer.ts"],
      [vendor, "behaviour/automation.ts"],
      [planningOfficer, "behaviour/institutions.ts"],
      [inspector, "behaviour/institutions.ts"],
      [builder, "behaviour/institutions.ts"],
      [registry, "behaviour/institutions.ts"],
      [landRegistry, "behaviour/institutions.ts"],
      [childProtection, "behaviour/institutions.ts"],
      [mayorCode, "behaviour/government.ts"],
      [councilClerk, "behaviour/government.ts"],
      [councillor, "behaviour/government.ts"],
      [financeOfficer, "behaviour/government.ts"],
      [taxClerk, "behaviour/government.ts"],
      [ratesOfficer, "behaviour/government.ts"],
      [works, "behaviour/government.ts"],
      [environment, "behaviour/environment.ts"],
      [bodyPayroll, "behaviour/payroll.ts"],
      [electoralOffice, "behaviour/elections.ts"],
      [newspaper, "behaviour/news.ts"],
      [principal, "behaviour/school.ts"],
      [practice, "behaviour/health.ts"],
      [member, "behaviour/tribunal.ts"],
      [registrar, "behaviour/tribunal.ts"],
      [desk, "behaviour/desk.ts"],
      [founded, "behaviour/founded.ts"],
      [water, "behaviour/utilities.ts"],
      [energy, "behaviour/utilities.ts"],
      [station, "behaviour/police.ts"],
      [retirementFund, "behaviour/fund.ts"],
      [clerk, "behaviour/books.ts"],
    ] as const
  // (An office that says how it answers a letter, and has no standing report of its own, acknowledges each: `answering`.)
  ).map(([m, src]) => [m.name, { ...keepingBooks(answering(m)), source: new URL(`./${src}`, import.meta.url).pathname }]),
);
for (const m of Object.values(modules)) if (m.books) keepers.set(m.name, m);
export * as reading from "./behaviour/reading";
export * as culture from "./behaviour/culture";
export * as townmemory from "./behaviour/townmemory";
