export * from "./contracts";
export * from "./module";
export { manifests, paramErrors, type Manifest } from "./manifests";
export * from "./rng";
export { slip, slipPpm, slipRow, type SlipRow, type SlipTable, type Slipper, type SlipOptions } from "./slip";
export * from "./law";
export * from "./canon";
export * from "./money";
export * from "./calendar";
export * from "./identity";
export * as calls from "./calls";
export * as forms from "./forms";
export { View } from "./view";
export { CONSULT_THINGS } from "./shared/citizen";
export { drawPerson, drawValues, NEEDS, VALUES, type PopulationValues } from "./shared/mind";
export { raisedValues, UPBRINGING  } from "./shared/inner";

export { draftLaw, figureGiven, figureWords, heldIn, type LawFigure, type LawFigures, type LawSchedule } from "./shared/common";
export { annualTax, chargesOn, dayPayPeriod, taxLawOf, withheld, withholding, type Band, type Charge, type IncomeTaxLaw } from "./shared/tax";
export { dueFrom, nextReturn, returnRuleInWords, returnRulesOf, returnsOf, MONTH_WORDS, type ReturnDue, type ReturnRule } from "./shared/returns";
export { declarationFor, forAge, forHousehold, forOutOfWork, stopsWorkAt, type Declared, type PaymentRule } from "./shared/payments";
export { adultAgeBands, drawHousehold, drawSavings, bedroomsNeeded, OCCUPANCY, type DrawnHousehold, type Extension, type HouseholdSpec, type OccupancyStandard } from "./shared/household";
export { yearsOfSchooling, type SchoolingSpec } from "./shared/school";
export { tabledLines, votedWords, yearInDays } from "./shared/government";
export { Roster, type RosterNow } from "./readers/roster";
export { Tally, type BallotCount } from "./readers/tally";
export { DayBook, LISTED_DAYS } from "./readers/daybook";
export { KIND as DECISION_KIND, type DecisionLaw, type Need as DecisionNeed } from "./shared/decisions";
export { particularsOf } from "./shared/frictions";
export { diaryText } from "./readers/diary";
export { planLaw, planLawWords, POSSESSION_ANSWER, CLAIM_EVIDENCE, CONFIRMATION_ANSWER, REVIEW_REQUEST, TAX_CREDIT_CLAIM, TAX_ACCOUNT_REQUEST, possessionOrderFor } from "./shared/papers";
import type { BehaviourModule } from "./module";
// (The kinds whose TypeScript actors were deleted at the cut-over: what is still read of each, the engine runs them.)
import { bankPaymentSystem, bodyPayroll, disposal, electoralOffice, energy, exportDemand, founded, funding, grants, idle, migration, newspaper, producer, retailer, retirementFund, statistics, taxCollector, trade, transfers, valuer, water, weather } from "./engine-kinds";
import { lending } from "./kinds/credit";
import { organiser } from "./kinds/union";
import { citizen } from "./kinds/citizen";
import { employer, landlord } from "./kinds/firms";
import { vendor } from "./kinds/automation";
import { assistant, provider } from "./kinds/assistants";
import { builder, childProtection, inspector, landRegistry, planningOfficer, registry } from "./kinds/institutions";
import { councilClerk, councillor, financeOfficer, mayorCode, ratesOfficer, taxClerk, works } from "./kinds/government";
import { environment } from "./kinds/environment";
import { principal } from "./kinds/school";
import { practice } from "./kinds/health";
import { member, registrar } from "./kinds/tribunal";
import { desk } from "./kinds/desk";
import { auditor } from "./kinds/auditor";
import { station } from "./kinds/police";
import { clerk } from "./kinds/books";
import { keepers  } from "./readers/books";
import * as openbooks from "./readers/openbooks";
import * as venueBooks from "./readers/openbooks-venues";
import * as townBooks from "./readers/openbooks-townhall";
export { firstDueOf } from "./readers/openbooks";
export { BOOKS  } from "./readers/books";

/** A module that keeps books (`books`), run as its office's staff (`part: "staff"`): the staff's clerk keeps them too,
 * and files what has changed when the staff's own work for the wake is done (docs/behaviour/office-books.md). */
/** Each office's books, by the module that runs it (readers/openbooks.ts): what its clerk reads. */
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
  return m;
}

/** Every behaviour module available to worlds, by the name used in controller.impl. */
export const modules: { [name: string]: BehaviourModule & { source: string } } = Object.fromEntries(
  (
    [
      [bankPaymentSystem, "engine-kinds.ts"],
      [exportDemand, "engine-kinds.ts"],
      [idle, "engine-kinds.ts"],
      [migration, "engine-kinds.ts"],
      [trade, "engine-kinds.ts"],
      [transfers, "engine-kinds.ts"],
      [funding, "engine-kinds.ts"],
      [weather, "engine-kinds.ts"],
      [valuer, "engine-kinds.ts"],
      [taxCollector, "engine-kinds.ts"],
      [statistics, "engine-kinds.ts"],
      [grants, "engine-kinds.ts"],
      [disposal, "engine-kinds.ts"],
      [lending, "kinds/credit.ts"],
      [organiser, "kinds/union.ts"],
      [citizen, "kinds/citizen.ts"],
      [landlord, "kinds/firms.ts"],
      [employer, "kinds/firms.ts"],
      [producer, "engine-kinds.ts"],
      [retailer, "engine-kinds.ts"],
      [vendor, "kinds/automation.ts"],
      [provider, "kinds/assistants.ts"],
      [assistant, "kinds/assistants.ts"],
      [planningOfficer, "kinds/institutions.ts"],
      [inspector, "kinds/institutions.ts"],
      [builder, "kinds/institutions.ts"],
      [registry, "kinds/institutions.ts"],
      [landRegistry, "kinds/institutions.ts"],
      [childProtection, "kinds/institutions.ts"],
      [mayorCode, "kinds/government.ts"],
      [councilClerk, "kinds/government.ts"],
      [councillor, "kinds/government.ts"],
      [financeOfficer, "kinds/government.ts"],
      [taxClerk, "kinds/government.ts"],
      [ratesOfficer, "kinds/government.ts"],
      [works, "kinds/government.ts"],
      [environment, "kinds/environment.ts"],
      [bodyPayroll, "engine-kinds.ts"],
      [electoralOffice, "engine-kinds.ts"],
      [newspaper, "engine-kinds.ts"],
      [principal, "kinds/school.ts"],
      [practice, "kinds/health.ts"],
      [member, "kinds/tribunal.ts"],
      [registrar, "kinds/tribunal.ts"],
      [desk, "kinds/desk.ts"],
      [auditor, "kinds/auditor.ts"],
      [founded, "engine-kinds.ts"],
      [water, "engine-kinds.ts"],
      [energy, "engine-kinds.ts"],
      [station, "kinds/police.ts"],
      [retirementFund, "engine-kinds.ts"],
      [clerk, "kinds/books.ts"],
    ] as const
  // (An office that says how it answers a letter, and has no standing report of its own, acknowledges each: `answering`.)
  ).map(([m, src]) => [m.name, { ...keepingBooks(m), source: new URL(`./${src}`, import.meta.url).pathname }]),
);
for (const m of Object.values(modules)) if (m.books) keepers.set(m.name, m);
export * as reading from "./shared/reading";
export * as culture from "./shared/culture";
export * as townmemory from "./shared/townmemory";
