export * from "./contracts";
export * from "./module";
export { manifests, paramErrors, type Manifest } from "./manifests";
export * from "./rng";
export * from "./law";
export * from "./canon";
export * from "./money";
export * as calls from "./calls";
export * as forms from "./forms";
export { View } from "./view";
export { ASKING, CONSULT_THINGS } from "./behaviour/citizen";
export { drawPerson, NEEDS, VALUES, type PopulationValues } from "./behaviour/mind";
export { repayment } from "./behaviour/credit";
export { draftLaw, figureGiven, figureWords, heldIn, heldValue, type LawFigure, type LawFigures, type LawSchedule } from "./behaviour/common";
export { annualTax, chargesInWords, chargesOn, taxLawOf, withheld, withholding, type Band, type Charge, type IncomeTaxLaw } from "./behaviour/tax";
export { forAge, forHousehold, forOutOfWork, paymentsInWords, stopsWorkAt, supportLaw, type Declared, type PaymentRule } from "./behaviour/payments";
export { adultAgeBands, drawHousehold, drawSavings, bedroomsNeeded, OCCUPANCY, type DrawnHousehold, type Extension, type HouseholdSpec, type OccupancyStandard } from "./behaviour/household";
export { yearsOfSchooling, type SchoolingSpec } from "./behaviour/school";
export { linesInWords, tabledLines, votedWords, yearInDays } from "./behaviour/government";
import type { BehaviourModule } from "./module";
import { bankPaymentSystem } from "./behaviour/bank";
import { disposal, exportDemand, funding, grants, idle, migration, statistics, trade, transfers, valuer, weather } from "./behaviour/world";
import { lending } from "./behaviour/credit";
import { organiser } from "./behaviour/union";
import { citizen } from "./behaviour/citizen";
import { employer, landlord } from "./behaviour/firms";
import { producer } from "./behaviour/producer";
import { retailer } from "./behaviour/retailer";
import { builder, childProtection, inspector, landRegistry, planningOfficer, registry } from "./behaviour/institutions";
import { councilClerk, councillor, financeOfficer, mayorCode, ratesOfficer, taxClerk, works } from "./behaviour/government";
import { environment } from "./behaviour/environment";
import { electoralOffice } from "./behaviour/elections";
import { newspaper } from "./behaviour/news";
import { principal } from "./behaviour/school";
import { practice } from "./behaviour/health";
import { member, registrar } from "./behaviour/tribunal";
import { energy, water } from "./behaviour/utilities";
import { station } from "./behaviour/police";
import { retirementFund } from "./behaviour/fund";

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
      [electoralOffice, "behaviour/elections.ts"],
      [newspaper, "behaviour/news.ts"],
      [principal, "behaviour/school.ts"],
      [practice, "behaviour/health.ts"],
      [member, "behaviour/tribunal.ts"],
      [registrar, "behaviour/tribunal.ts"],
      [water, "behaviour/utilities.ts"],
      [energy, "behaviour/utilities.ts"],
      [station, "behaviour/police.ts"],
      [retirementFund, "behaviour/fund.ts"],
    ] as const
  ).map(([m, src]) => [m.name, { ...m, source: new URL(`./${src}`, import.meta.url).pathname }]),
);
