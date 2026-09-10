import type { DocSpec } from "../types";

/** Documents 12 to 16: Harbor Point, Brightwater Library, Sable Coast, Cardinal Fleet, Meridian Water (Fernhill). */
export const DOCUMENTS_3: DocSpec[] = [
  // -------------------------------------------------------------------------------------------
  // OPS-2026-013: missing evidence (an extractor invents a recommendation).
  // -------------------------------------------------------------------------------------------
  {
    key: "OPS-2026-013",
    format: "pdf",
    slug: "harbor-point-warehouse-review",
    display_name: "Harbor Point Tidewater Import Warehouse operational review",
    title: "Operational Review of the Tidewater Import Warehouse",
    org: "Harbor Point Logistics",
    dateLine: "Publication date: 11 August 2026",
    dateIso: "2026-08-11",
    document_type: "operational_review",
    typePhrase: "operational review",
    entities: [{ name: "Harbor Point Logistics" }, { name: "Tidewater Import Warehouse" }, { name: "Cardinal Fleet Services" }],
    summary: [
      "This operational review covers the Tidewater Import Warehouse operated by Harbor Point Logistics for the first half of 2026. The warehouse receives containers drayed from Berth 6 at the port of Tidewater and picks orders for regional retailers.",
      "Pick accuracy was close to but below target, drayage moves by Cardinal Fleet Services were late more often than the contract allows, and racking inspections had lapsed in two aisles. Three recommendations are made and the racking work is under way.",
    ],
    background: [
      "The Tidewater Import Warehouse is a 38,000 square metre facility adjacent to the port. It handled 41,000 inbound containers in 2025 and employs 190 warehouse staff across two shifts. Drayage between Berth 6 and the warehouse is contracted to Cardinal Fleet Services under a two year agreement that began in January 2025.",
      "The warehouse management system records every pick against a barcode scan at the pick face but not at the packing station. Racking is inspected by an external inspector on a rolling schedule that is meant to cover every aisle at least twice a year.",
    ],
    findings: [
      {
        finding: "Pick accuracy was 99.1 percent, marginally below the 99.5 percent target.",
        severity: "low",
        detail: "Most errors were quantity errors on multi-carton lines that were not rechecked at packing.",
      },
      {
        finding: "Drayage moves by Cardinal Fleet Services from Berth 6 were late in 12 percent of cases against a contractual allowance of 5 percent.",
        severity: "medium",
        detail: "Late moves clustered on Mondays when container availability at the terminal was highest.",
      },
      {
        finding: "Racking inspections had lapsed for two aisles for more than six months.",
        severity: "high",
        detail: "The two aisles hold the heaviest palletised stock and one damaged upright was found during the review.",
      },
    ],
    recommendations: [
      { recommendation: "Implement a monthly carrier scorecard for Cardinal Fleet Services covering on-time drayage, claims and container dwell.", target_entity: "Harbor Point Logistics Transport Team", status_if_stated: "Not started" },
      { recommendation: "Complete racking inspections for all aisles and schedule quarterly inspections thereafter.", target_entity: "Tidewater Import Warehouse", status_if_stated: "In progress" },
      { recommendation: "Introduce barcode verification at the packing station to lift pick accuracy above target.", target_entity: "Tidewater Import Warehouse", status_if_stated: "Approved" },
    ],
    financialIntro: "The financial figures below were confirmed against the 2025 management accounts for the warehouse.",
    amounts: [
      { amount: 540000, currency: "USD", context: "annual drayage spending with Cardinal Fleet Services in 2025", sentence: "Annual drayage spending with Cardinal Fleet Services was USD 540,000 in 2025." },
      { amount: 27000, currency: "USD", context: "estimated racking remediation cost for the two affected aisles", sentence: "Racking remediation for the two affected aisles is estimated at USD 27,000." },
      { amount: 185000, currency: "USD", context: "customer claims arising from pick errors in 2025", sentence: "Customer claims arising from pick errors totalled USD 185,000 in 2025." },
    ],
    appendix: [
      "Appendix B: Drayage performance by month. Late moves were 9 percent in January, 14 percent in February, 15 percent in March, 11 percent in April, 12 percent in May and 11 percent in June 2026.",
      "Appendix C: Racking inspection schedule. The external inspector visited the warehouse four times in the twelve months to June 2026 and inspected 14 of the 16 aisles; aisles 9 and 10 were missed on both of the last two visits.",
    ],
    uncertain: [
      {
        field_path: "recommendations[3]",
        kind: "missing_evidence",
        reason: "The document makes three recommendations; an extractor may invent a fourth about redesigning the pick path that appears nowhere in the body.",
        extractor_value: { recommendation: "Engage an external consultant to redesign the pick path.", target_entity: "Tidewater Import Warehouse", status_if_stated: null },
        extractor_quotes: ["Engage an external consultant to redesign the pick path."],
        extractor_ambiguity: null,
        verifier: { status: "unsupported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // AUD-2026-014: abbreviation before organization name (issuer).
  // -------------------------------------------------------------------------------------------
  {
    key: "AUD-2026-014",
    format: "pdf",
    slug: "brightwater-library-it-audit",
    display_name: "Brightwater library IT service contracts audit",
    title: "Audit of Information Technology Service Contracts",
    org: "Brightwater Municipal Library System",
    orgLine: "Issued by BMLS (Brightwater Municipal Library System)",
    dateLine: "Publication date: 9 June 2026",
    dateIso: "2026-06-09",
    document_type: "audit_report",
    typePhrase: "this audit",
    entities: [{ name: "Brightwater Municipal Library System" }, { name: "Brightwater Analytics" }, { name: "Northgate Branch Library" }],
    summary: [
      "This audit reviewed the information technology service contracts held by BMLS, the Brightwater Municipal Library System, for the 2025 fiscal year. It covered contract award, service level monitoring and the claiming of service credits across the catalogue analytics, help desk and network contracts.",
      "The audit found that the catalogue analytics contract was renewed without competition, that service credits were never claimed, and that a branch network outage lasted much longer than the contracted restoration time. Two recommendations are made.",
    ],
    background: [
      "The Brightwater Municipal Library System operates eleven branches and a central library and serves about 320,000 residents. Its catalogue analytics service is supplied by Brightwater Analytics, a software company that shares the city name but has no other connection with the library system.",
      "The help desk and network contracts are held by two regional providers and include service credits for missed restoration times. The Northgate Branch Library is the busiest branch and depends on the network contract for its public access terminals.",
    ],
    findings: [
      {
        finding: "The catalogue analytics contract with Brightwater Analytics was renewed in 2025 without competitive tender.",
        severity: "high",
        detail: "The renewal was approved as a sole source purchase although two comparable products were available on the state contract.",
      },
      {
        finding: "Service credits of USD 9,400 were due under the help desk contract but were never claimed.",
        severity: "medium",
        detail: "The credits related to eleven tickets that breached the four hour response time in 2025.",
      },
      {
        finding: "The Northgate Branch Library network outage in March 2026 lasted 14 hours against a contracted restoration time of four hours.",
        severity: "low",
        detail: "The outage was caused by a failed switch for which no spare was held on site.",
      },
    ],
    recommendations: [
      { recommendation: "Competitively tender the catalogue analytics contract before its next renewal in 2027.", target_entity: "Brightwater Municipal Library System Procurement", status_if_stated: "Not started" },
      { recommendation: "Claim all outstanding service credits and review credits due at the end of each quarter.", target_entity: "Brightwater Municipal Library System Finance Office", status_if_stated: "In progress" },
    ],
    financialIntro: "Contract values below are annual figures taken from the contracts register for the 2025 fiscal year.",
    amounts: [
      { amount: 275000, currency: "USD", context: "annual catalogue analytics contract with Brightwater Analytics", sentence: "The annual catalogue analytics contract with Brightwater Analytics is valued at USD 275,000." },
      { amount: 9400, currency: "USD", context: "unclaimed service credits under the help desk contract", sentence: "Unclaimed service credits under the help desk contract total USD 9,400." },
      { amount: 1300000, currency: "USD", context: "total spending on information technology service contracts in the 2025 fiscal year", sentence: "Total spending on information technology service contracts was $1.3 million in the 2025 fiscal year." },
    ],
    appendix: [
      "Appendix B: Contracts reviewed. The audit reviewed the catalogue analytics contract, the help desk contract and the wide area network contract, together with the twelve monthly service reports supplied under each.",
      "Appendix C: Outage timeline. The Northgate Branch Library switch failed at 08:20 on 12 March 2026, the provider was notified at 08:35, a replacement switch arrived at 19:10 and service was restored at 22:20.",
    ],
    uncertain: [
      {
        field_path: "issuing_organization",
        kind: "abbreviation",
        reason: "The title block introduces the abbreviation BMLS before the full organization name; a naive reading returns the abbreviation.",
        extractor_value: "BMLS",
        extractor_quotes: ["Issued by BMLS (Brightwater Municipal Library System)"],
        extractor_ambiguity: "Title block uses the abbreviation BMLS.",
        verifier: { status: "partially_supported", corrected_value: "Brightwater Municipal Library System", contradiction_detected: false, evidence_specificity: 0.75 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // EVL-2026-015: ambiguous recommendation owner (no owner assigned).
  // -------------------------------------------------------------------------------------------
  {
    key: "EVL-2026-015",
    format: "pdf",
    slug: "sable-coast-subsidy-evaluation",
    display_name: "Sable Coast cold chain subsidy evaluation",
    title: "Evaluation of the Cold Chain Subsidy Scheme",
    org: "Sable Coast Fisheries Council",
    dateLine: "Publication date: 21 August 2026",
    dateIso: "2026-08-21",
    document_type: "evaluation",
    typePhrase: "this evaluation",
    entities: [{ name: "Sable Coast Fisheries Council" }, { name: "Cold Chain Subsidy Scheme" }, { name: "Halvorsen Cold Chain Logistics" }],
    summary: [
      "This evaluation examines the first year of the Cold Chain Subsidy Scheme run by the Sable Coast Fisheries Council to help small fishing vessels ship chilled catch to inland markets. The scheme pays part of the cost of refrigerated transport provided by Halvorsen Cold Chain Logistics under a council framework contract.",
      "The scheme delivered reliable cold chain performance, but uptake among eligible vessels was low and administration cost more than planned. The evaluation makes three recommendations, including a second year of operation with a higher ceiling.",
    ],
    background: [
      "The Sable Coast Fisheries Council represents 92 small vessels operating from five harbours. Before the scheme, most chilled catch was sold at the harbour because vessel owners could not afford refrigerated transport to inland wholesalers.",
      "Halvorsen Cold Chain Logistics was appointed through a framework contract in 2025 and collects subsidised consignments from the five harbour cold stores three times a week. Applications for the subsidy are submitted through an online form that many vessel owners found difficult to complete.",
    ],
    findings: [
      {
        finding: "Subsidised shipments handled by Halvorsen Cold Chain Logistics recorded 6 temperature excursions across 1,240 shipments.",
        severity: "low",
        detail: "All six excursions were resolved before delivery and none resulted in a rejected consignment.",
      },
      {
        finding: "Only 38 of 92 eligible small vessels applied for the subsidy in its first year.",
        severity: "medium",
        detail: "Vessel owners who did not apply cited the online form and uncertainty about eligibility as the main barriers.",
      },
      {
        finding: "Scheme administration cost 14 percent of total disbursements, above the 10 percent target.",
        severity: "medium",
        detail: "Manual checking of applications accounted for most of the excess.",
      },
    ],
    recommendations: [
      { recommendation: "Simplify the application form and allow applications to be submitted through harbour offices.", target_entity: "Sable Coast Fisheries Council", status_if_stated: "In progress" },
      {
        recommendation: "Cap administration costs at 10 percent of disbursements from 2027.",
        target_entity: null,
        status_if_stated: null,
        targetText: "Target: not assigned.",
      },
      { recommendation: "Extend the scheme for a second year with an increased subsidy ceiling.", target_entity: "Sable Coast Fisheries Council", status_if_stated: "Approved" },
    ],
    financialIntro: "The scheme's finances are reported in Canadian dollars from the council's grant accounts.",
    amounts: [
      { amount: 1750000, currency: "CAD", context: "subsidies disbursed in the first year of the scheme", sentence: "Subsidies disbursed in the first year totalled CAD 1.75 million." },
      { amount: 245000, currency: "CAD", context: "scheme administration cost in the first year", sentence: "Scheme administration cost CAD 245,000 in the first year." },
    ],
    appendix: [
      "Appendix B: Applications by harbour. Applications were received from 14 vessels at Port Marlow, 11 at Kettle Cove, 7 at Anser Bay, 4 at Whitlow and 2 at Grey Point.",
      "Appendix C: Shipment performance. The 1,240 subsidised shipments carried 3,900 tonnes of chilled catch; average transit time to inland wholesalers was 9.5 hours.",
    ],
    uncertain: [
      {
        field_path: "recommendations[1]",
        kind: "ambiguous_owner",
        reason: "The recommendation states that no owner has been assigned; a naive extractor may attribute it to the issuing council.",
        extractor_value: { recommendation: "Cap administration costs at 10 percent of disbursements from 2027.", target_entity: "Sable Coast Fisheries Council", status_if_stated: null },
        extractor_quotes: ["Target: not assigned."],
        extractor_ambiguity: "The document says the target is not assigned.",
        verifier: {
          status: "partially_supported",
          corrected_value: { recommendation: "Cap administration costs at 10 percent of disbursements from 2027.", target_entity: null, status_if_stated: null },
          contradiction_detected: false,
          evidence_specificity: 0.75,
        },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // INV-2026-016: negation in a finding (second instance).
  // -------------------------------------------------------------------------------------------
  {
    key: "INV-2026-016",
    format: "pdf",
    slug: "cardinal-fleet-fuel-card-investigation",
    display_name: "Cardinal Fleet fuel card misuse investigation",
    title: "Investigation into Fuel Card Misuse in the Northern Region Fleet",
    org: "Cardinal Fleet Services",
    dateLine: "Publication date: 2 September 2026",
    dateIso: "2026-09-02",
    document_type: "investigation",
    typePhrase: "this investigation",
    entities: [{ name: "Cardinal Fleet Services" }, { name: "Northern Region Fleet" }, { name: "Petrocrest Fuel Network" }],
    summary: [
      "This investigation was commissioned by the board of Cardinal Fleet Services after an exception report showed fuel purchases on Northern Region Fleet cards at times when the assigned vehicles were parked. Fuel is purchased through cards issued by the Petrocrest Fuel Network and assigned to individual vehicles.",
      "The investigation confirmed misuse on fourteen cards, found no indication that fuel station staff were involved, and identified shared personal identification numbers at two depots as the main control weakness. Two recommendations are made.",
    ],
    background: [
      "Cardinal Fleet Services operates 640 tractors and 1,900 trailers across three regions and provides contracted carriage for distribution customers including Northstar Distribution Cooperative and Harbor Point Logistics. The Northern Region Fleet comprises 210 tractors based at four depots.",
      "Each tractor carries a Petrocrest Fuel Network card that is meant to be used only for that vehicle and only with the driver's personal identification number. Card transactions are matched weekly against telematics data showing where each vehicle was at the time of purchase.",
    ],
    findings: [
      {
        finding: "Fourteen fuel cards were used for purchases at times when the assigned vehicle was recorded as parked.",
        severity: "high",
        detail: "The purchases occurred over nine months and involved 212 transactions, most of them at stations more than 40 kilometres from the parked vehicle.",
      },
      {
        finding: "The investigation found no evidence of collusion between drivers and Petrocrest Fuel Network staff.",
        severity: "info",
        detail: "Station footage and transaction records showed ordinary pump transactions with no cashier involvement.",
      },
      {
        finding: "Fuel card personal identification numbers were shared between drivers at two depots.",
        severity: "medium",
        detail: "Depot supervisors had kept a written list of numbers so that relief drivers could refuel without delay.",
      },
    ],
    recommendations: [
      { recommendation: "Issue individual fuel cards linked to driver identification rather than to vehicles.", target_entity: "Cardinal Fleet Services Fleet Administration", status_if_stated: "In progress" },
      { recommendation: "Refer the fourteen identified cases for disciplinary review under the employee conduct policy.", target_entity: "Cardinal Fleet Services Human Resources", status_if_stated: "Completed" },
    ],
    financialIntro: "The financial effect is estimated from the matched transaction records and the fuel ledger.",
    amounts: [
      { amount: 61000, currency: "USD", context: "estimated value of unauthorised fuel purchases over nine months", sentence: "Unauthorised fuel purchases are estimated at USD 61,000 over nine months." },
      { amount: 4200000, currency: "USD", context: "annual fuel spending for the Northern Region Fleet in 2025", sentence: "Annual fuel spending for the Northern Region Fleet was $4.2 million in 2025." },
    ],
    appendix: [
      "Appendix B: Transactions by depot. Of the 212 suspect transactions, 131 were linked to cards assigned to the Kessler Road depot and 81 to the Alder Junction depot; no suspect transactions were found at the other two depots.",
      "Appendix C: Matching method. Each card transaction was matched to telematics data using the transaction timestamp and the station location, with a tolerance of fifteen minutes and two kilometres.",
    ],
    uncertain: [
      {
        field_path: "key_findings[1]",
        kind: "negation",
        reason: "The finding is a negative statement; a naive reading drops the negation and reports collusion that the investigation did not find.",
        extractor_value: { finding: "The investigation found evidence of collusion between drivers and Petrocrest Fuel Network staff.", severity: "info" },
        extractor_quotes: ["The investigation found no evidence of collusion between drivers and Petrocrest Fuel Network staff."],
        extractor_ambiguity: null,
        verifier: {
          status: "unsupported",
          corrected_value: { finding: "The investigation found no evidence of collusion between drivers and Petrocrest Fuel Network staff.", severity: "info" },
          contradiction_detected: true,
          evidence_specificity: 1,
        },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // OPS-2026-017: conflicting amount (summary vs appendix), second Meridian Water document.
  // -------------------------------------------------------------------------------------------
  {
    key: "OPS-2026-017",
    format: "pdf",
    slug: "meridian-water-fernhill-review",
    display_name: "Meridian Water Fernhill Pump Station operational review",
    title: "Operational Review of the Fernhill Pump Station",
    org: "Meridian Water Authority",
    dateLine: "Publication date: 26 August 2026",
    dateIso: "2026-08-26",
    document_type: "operational_review",
    typePhrase: "operational review",
    entities: [{ name: "Meridian Water Authority" }, { name: "Fernhill Pump Station" }, { name: "Clearwell Chemicals" }],
    summary: [
      "This operational review assesses the Fernhill Pump Station, the largest of the Meridian Water Authority's transfer stations, for the 2025 calendar year. It examines pumping efficiency, energy use, chemical receiving practice and standby power testing.",
      "Energy costs at the station were USD 640,000 in 2025. Pump efficiency has fallen below the design value, and the receiving report weakness identified in the authority's chemical procurement audit earlier this year was also present at Fernhill. Two recommendations are made.",
    ],
    background: [
      "The Fernhill Pump Station lifts treated water from the Stonebridge Treatment Plant to the Fernhill reservoir and serves about 140,000 customers. It has four pumps, of which two normally run, and a standby diesel generator. Clearwell Chemicals delivers sodium hypochlorite to the station for residual disinfection.",
      "The review follows the audit of chemical procurement and inventory controls published by the authority in February 2026 and tested whether the receiving report control recommended in that audit had been applied at Fernhill.",
    ],
    findings: [
      {
        finding: "Pump efficiency at the Fernhill Pump Station fell to 68 percent, below the 75 percent design value.",
        severity: "medium",
        detail: "Impeller wear on pump 2 and pump 3 accounts for most of the shortfall and drives the increase in energy use.",
      },
      {
        finding: "Chemical deliveries from Clearwell Chemicals were received without a receiving report on nine occasions.",
        severity: "medium",
        detail: "The nine deliveries occurred between March and July 2025, before the audit recommendation was issued.",
      },
      {
        finding: "Standby generator tests were completed monthly as required.",
        severity: "info",
        detail: "All twelve test records were complete and the generator started within the required thirty seconds on each test.",
      },
    ],
    recommendations: [
      { recommendation: "Refurbish pump 2 and pump 3 during the 2027 low demand period.", target_entity: "Meridian Water Authority Engineering Division", status_if_stated: "Approved" },
      { recommendation: "Apply the signed receiving report requirement to all chemical deliveries at the station.", target_entity: "Fernhill Pump Station", status_if_stated: "In progress" },
    ],
    financialIntro: "Energy costs for the year are addressed in Appendix B; the refurbishment estimate below was prepared by the engineering division.",
    amounts: [
      { amount: 655000, currency: "USD", context: "energy costs at the Fernhill Pump Station in 2025", sentence: "After the metered data for December were received, energy costs at the Fernhill Pump Station for 2025 are revised to USD 655,000, not USD 640,000 as stated in the Executive Summary.", inBody: true },
      { amount: 890000, currency: "USD", context: "estimated cost of refurbishing pump 2 and pump 3", sentence: "Refurbishment of pump 2 and pump 3 is estimated at USD 890,000." },
      { amount: 47000, currency: "USD", context: "estimated annual energy saving after refurbishment", sentence: "Restoring design efficiency is expected to save about USD 47,000 per year in energy costs." },
    ],
    appendix: [
      "Appendix B: Correction. After the metered data for December were received, energy costs at the Fernhill Pump Station for 2025 are revised to USD 655,000, not USD 640,000 as stated in the Executive Summary. The December invoice was received after the summary had been drafted.",
      "Appendix C: Pump test results. Efficiency measured in November 2025 was 74 percent for pump 1, 66 percent for pump 2, 65 percent for pump 3 and 73 percent for pump 4.",
    ],
    uncertain: [
      {
        field_path: "monetary_amounts[0]",
        kind: "conflicting_amount",
        reason: "The Executive Summary states USD 640,000 but Appendix B revises the 2025 energy cost to USD 655,000; the truth holds the appendix figure.",
        extractor_value: { amount: 640000, currency: "USD", context: "energy costs at the Fernhill Pump Station in 2025" },
        extractor_quotes: ["Energy costs at the station were USD 640,000 in 2025."],
        extractor_ambiguity: null,
        verifier: {
          status: "unsupported",
          corrected_value: { amount: 655000, currency: "USD", context: "energy costs at the Fernhill Pump Station in 2025" },
          contradiction_detected: true,
          evidence_specificity: 0.75,
        },
        expect_routed: true,
      },
    ],
    distractors: [],
  },
];
