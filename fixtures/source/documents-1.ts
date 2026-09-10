import type { DocSpec } from "../types";

/** Documents 1 to 6: Northstar, Redwood Transit, Orchard Valley, Meridian Water (audit), Larkspur, Kestrel. */
export const DOCUMENTS_1: DocSpec[] = [
  // -------------------------------------------------------------------------------------------
  // OPS-2026-004: superseded by a PDF v2 (corrected amount). No planted uncertainty in v1.
  // -------------------------------------------------------------------------------------------
  {
    key: "OPS-2026-004",
    format: "pdf",
    slug: "northstar-operational-review",
    display_name: "Northstar Dock Optimization Program operational review",
    title: "Operational Review of the Dock Optimization Program",
    org: "Northstar Distribution Cooperative",
    dateLine: "Publication date: 12 March 2026",
    dateIso: "2026-03-12",
    document_type: "operational_review",
    typePhrase: "operational review",
    entities: [{ name: "Dock Optimization Program" }, { name: "Ashford Crossdock Facility" }, { name: "Cardinal Fleet Services" }],
    summary: [
      "This operational review examines the Dock Optimization Program at the Ashford Crossdock Facility during the thirteen weeks ending 28 February 2026. The program was launched to reduce trailer dwell time and to improve carrier compliance reporting. The review concludes that dwell time improved by 18 percent against the baseline but that carrier reporting from Cardinal Fleet Services remained inconsistent throughout the period.",
      "The total program cost to date is $1.25 million, against an approved budget of $1.4 million. Four findings and three recommendations are set out below. The highest rated finding concerns detention charges that have not been reconciled against gate records, and the review asks the finance team to resolve the disputed balance before any further payment is released.",
    ],
    background: [
      "Northstar Distribution Cooperative operates four crossdock facilities serving grocery retailers in the northern region. The Ashford Crossdock Facility handles roughly 620 inbound trailers per week and was selected as the pilot site for the Dock Optimization Program in September 2025 because it had the longest average dwell time in the network.",
      "Cardinal Fleet Services is the primary contracted carrier for the Ashford site and is required under its service agreement to submit weekly compliance reports covering on-time arrival, detention and trailer condition. The program introduced an appointment scheduling system and a yard management dashboard, both supplied under the same contract, and trained 44 dock staff in the new appointment process.",
    ],
    findings: [
      {
        finding: "Detention charges of $212,000 invoiced by Cardinal Fleet Services during the review period had not been reconciled against gate records.",
        severity: "high",
        detail: "The finance team could match only 61 percent of the invoiced detention hours to gate timestamps, and the remainder is disputed.",
      },
      {
        finding: "Carrier compliance reporting was delivered late in seven of thirteen weeks.",
        severity: "medium",
        detail: "Late reports were typically received four to nine days after the contractual deadline, which prevented timely escalation of missed appointments.",
      },
      {
        finding: "Average trailer dwell time fell from 3.4 hours to 2.8 hours after the appointment system went live.",
        severity: "info",
        detail: "The improvement was consistent across day and night shifts and is attributed to the appointment system rather than to seasonal volume.",
      },
      {
        finding: "Yard management dashboard uptime was 96.2 percent, below the 99 percent service level in the contract.",
        severity: "low",
        detail: "Outages were concentrated in the first three weeks of the period and no single outage exceeded four hours.",
      },
    ],
    recommendations: [
      { recommendation: "Reconcile all detention invoices from Cardinal Fleet Services against gate records before payment.", target_entity: "Northstar Finance Department", status_if_stated: "In progress" },
      { recommendation: "Amend the carrier service agreement to attach a service credit to late compliance reports.", target_entity: "Northstar Procurement Office", status_if_stated: "Not started" },
      { recommendation: "Extend the appointment scheduling system to the remaining three crossdock facilities by the end of 2026.", target_entity: "Dock Optimization Program Office", status_if_stated: "Approved" },
    ],
    financialIntro: "The financial position of the program is summarised below and reconciled to the cooperative's project ledger.",
    amounts: [
      { amount: 1250000, currency: "USD", context: "total Dock Optimization Program cost to date", sentence: "Program spending to date totals $1.25 million, comprising software licences, dock equipment and training." },
      { amount: 1400000, currency: "USD", context: "approved Dock Optimization Program budget", sentence: "The approved program budget is $1.4 million." },
      { amount: 212000, currency: "USD", context: "disputed detention charges invoiced by Cardinal Fleet Services", sentence: "Disputed detention charges invoiced by Cardinal Fleet Services amount to $212,000." },
      { amount: 95000, currency: "USD", context: "estimated annual yard labour saving from reduced dwell time", sentence: "Reduced dwell time is estimated to save USD 95,000 per year in yard labour." },
    ],
    appendix: [
      "Appendix B: Dwell time by week. Weekly average dwell time ranged from 3.6 hours in week one to 2.6 hours in week thirteen, with the largest single week reduction recorded in week five when the appointment system went live.",
      "Appendix C: Reporting log. The compliance reporting log records the contractual deadline and the actual receipt date for each of the thirteen weekly reports from Cardinal Fleet Services, together with the name of the Northstar coordinator who logged the receipt.",
    ],
    uncertain: [],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // OPS-2026-009: negation in a finding.
  // -------------------------------------------------------------------------------------------
  {
    key: "OPS-2026-009",
    format: "pdf",
    slug: "redwood-transit-operational-review",
    display_name: "Redwood Transit fleet maintenance operational review",
    title: "Operational Review of Bus Fleet Maintenance Scheduling",
    org: "Redwood Transit District",
    dateLine: "Publication date: 3 February 2026",
    dateIso: "2026-02-03",
    document_type: "operational_review",
    typePhrase: "operational review",
    entities: [{ name: "Fleet Maintenance Division" }, { name: "Willow Street Depot" }, { name: "Pinecrest Parts Supply" }],
    summary: [
      "This operational review assesses how the Fleet Maintenance Division schedules and completes preventive maintenance across the district's 214 buses. It was commissioned after the board noted a rise in road calls during the autumn of 2025. The review covers the period from July to December 2025 and both depots operated by the district.",
      "The review finds that inspections were overdue on a significant share of the fleet, that the backlog is driven by technician availability rather than by parts supply, and that overtime at the Willow Street Depot is well above budget. Three recommendations are made, one of which has already been completed.",
    ],
    background: [
      "Redwood Transit District operates fixed route and paratransit services from the Willow Street Depot and the Harlan Avenue Depot. The Fleet Maintenance Division employs 37 technicians and follows a manufacturer based inspection interval of 6,000 miles for each bus.",
      "Pinecrest Parts Supply holds the district's annual parts contract and is required to deliver stocked items within five working days of an order. Depot managers had suggested to the board that late parts deliveries were the main cause of the inspection backlog, and the review tested that explanation directly.",
    ],
    findings: [
      {
        finding: "Preventive maintenance inspections were overdue on 14 percent of the active fleet at the end of December 2025.",
        severity: "high",
        detail: "The overdue share had risen from 6 percent in July, and 11 buses were more than 2,000 miles past their interval.",
      },
      {
        finding: "The review found no evidence of a shipment delay attributable to Pinecrest Parts Supply during the review period.",
        severity: "info",
        detail: "All 46 parts orders sampled were delivered within the contractual five working days, and depot records attribute the backlog to technician availability rather than to parts supply.",
      },
      {
        finding: "Technician overtime at the Willow Street Depot exceeded the budgeted level by 22 percent.",
        severity: "medium",
        detail: "Overtime was concentrated in the night shift, where two vacancies had been open since August 2025.",
      },
      {
        finding: "Work order closure notes were incomplete for roughly one third of the sampled records.",
        severity: "low",
        detail: "Missing notes made it impossible to tell whether a repeat defect had been inspected or simply reset.",
      },
    ],
    recommendations: [
      { recommendation: "Introduce a rolling twelve week inspection calendar with weekly exception reporting to the depot managers.", target_entity: "Fleet Maintenance Division", status_if_stated: "In progress" },
      { recommendation: "Recruit two additional certified technicians for the Willow Street Depot night shift.", target_entity: "Redwood Transit District Human Resources", status_if_stated: null },
      { recommendation: "Require a minimum closure note on every work order before it can be closed in the maintenance system.", target_entity: "Fleet Maintenance Division", status_if_stated: "Completed" },
    ],
    financialIntro: "The costs below were taken from the district's payroll and contract ledgers for the 2025 calendar year.",
    amounts: [
      { amount: 380000, currency: "USD", context: "unbudgeted technician overtime in 2025", sentence: "Unbudgeted technician overtime for the year totalled USD 380,000." },
      { amount: 1600000, currency: "USD", context: "annual parts supply contract with Pinecrest Parts Supply", sentence: "The annual parts supply contract with Pinecrest Parts Supply is valued at $1.6 million." },
      { amount: 52000, currency: "USD", context: "estimated annual cost of road calls caused by overdue inspections", sentence: "Road calls attributable to overdue inspections are estimated to have cost USD 52,000 in towing and replacement service." },
    ],
    appendix: [
      "Appendix B: Parts order sample. The 46 sampled orders were placed between 4 August and 19 December 2025 and covered brake components, filters, belts and electrical parts, with an average delivery time of 3.2 working days.",
      "Appendix C: Overdue inspections by depot. At the end of December 2025, 19 overdue buses were assigned to the Willow Street Depot and 11 to the Harlan Avenue Depot.",
    ],
    uncertain: [
      {
        field_path: "key_findings[1]",
        kind: "negation",
        reason: "The finding is a negative statement; a naive reading drops the negation and reports a shipment delay that the review did not find.",
        extractor_value: { finding: "The review found evidence of a shipment delay attributable to Pinecrest Parts Supply during the review period.", severity: "info" },
        extractor_quotes: ["The review found no evidence of a shipment delay attributable to Pinecrest Parts Supply during the review period."],
        extractor_ambiguity: null,
        verifier: {
          status: "unsupported",
          corrected_value: { finding: "The review found no evidence of a shipment delay attributable to Pinecrest Parts Supply during the review period.", severity: "info" },
          contradiction_detected: true,
          evidence_specificity: 1,
        },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // AUD-2026-003: conflicting amount (summary vs appendix) and weak evidence for an entity.
  // -------------------------------------------------------------------------------------------
  {
    key: "AUD-2026-003",
    format: "pdf",
    slug: "orchard-valley-audit-report",
    display_name: "Orchard Valley procurement card audit",
    title: "Internal Audit of Procurement Card Controls",
    org: "Orchard Valley Regional Hospital",
    dateLine: "Publication date: 27 January 2026",
    dateIso: "2026-01-27",
    document_type: "audit_report",
    typePhrase: "internal audit",
    entities: [{ name: "Orchard Valley Regional Hospital" }, { name: "Procurement Office" }, { name: "Ridgeline Medical Supplies" }],
    summary: [
      "This internal audit tested the design and operation of procurement card controls at Orchard Valley Regional Hospital for the 2025 fiscal year. The audit examined card issuance, monthly statement approval, spending limits and supplier payments made through the card programme.",
      "Overpayments to Ridgeline Medical Supplies identified by the audit total USD 480,000. The audit rates two findings as high, concerning cards that remained active after staff departures and duplicate payments to a single supplier. Three recommendations are made and one has been completed during the audit.",
    ],
    background: [
      "Orchard Valley Regional Hospital is a 410 bed teaching hospital with an annual operating budget of USD 610 million. The Procurement Office administers 212 active cards across 38 departments. The office also maintains the approved supplier list and issues the monthly statements.",
      "Ridgeline Medical Supplies is the hospital's largest card supplier for consumables and received 1,140 card payments during the year. The audit was the first review of the card programme since the hospital moved to a new card management system in 2023.",
    ],
    findings: [
      {
        finding: "Nine procurement cards remained active for staff who had left the hospital.",
        severity: "high",
        detail: "Two of the nine cards recorded transactions after the cardholder's departure date, totalling USD 3,900.",
      },
      {
        finding: "Monthly card statements were approved by the cardholder's own line manager in only 58 percent of cases sampled.",
        severity: "medium",
        detail: "In the remaining cases statements were approved by a delegate or by the cardholder, contrary to the card policy.",
      },
      {
        finding: "Ridgeline Medical Supplies was paid twice for 31 invoices between June and November 2025.",
        severity: "high",
        detail: "The duplicates arose when invoices were paid by card and later paid again through the accounts payable system.",
      },
      {
        finding: "Card spending limits had not been reviewed since 2022.",
        severity: "low",
        detail: "Twenty six cards carried monthly limits above USD 20,000 although their average monthly spend was below USD 4,000.",
      },
    ],
    recommendations: [
      { recommendation: "Deactivate procurement cards within two working days of an employee's departure.", target_entity: "Procurement Office", status_if_stated: "Completed" },
      { recommendation: "Recover the duplicated payments from Ridgeline Medical Supplies and offset any remaining balance against future invoices.", target_entity: "Orchard Valley Finance Department", status_if_stated: "In progress" },
      { recommendation: "Review all card spending limits annually and document the review.", target_entity: "Procurement Office", status_if_stated: null },
    ],
    financialIntro: "The financial figures below are drawn from the card management system and the general ledger; the recoverable overpayment is addressed in Appendix B.",
    amounts: [
      { amount: 512000, currency: "USD", context: "recoverable overpayment to Ridgeline Medical Supplies", sentence: "Following reconciliation of the March credit notes, the recoverable overpayment to Ridgeline Medical Supplies is revised to USD 512,000, not USD 480,000 as stated in the Executive Summary.", inBody: true },
      { amount: 2300000, currency: "USD", context: "annual procurement card spend in the 2025 fiscal year", sentence: "Annual spending on procurement cards was $2.3 million in the 2025 fiscal year." },
      { amount: 45000, currency: "USD", context: "estimated cost of the card management system upgrade", sentence: "The card management system upgrade needed to enforce approval routing is estimated to cost USD 45,000." },
    ],
    appendix: [
      "Appendix B: Correction. Following reconciliation of the March credit notes, the recoverable overpayment to Ridgeline Medical Supplies is revised to USD 512,000, not USD 480,000 as stated in the Executive Summary. The revised figure includes 31 duplicated invoices and four partial credits that had not been applied when the summary was drafted.",
      "Appendix C: Sample design. The audit sampled 120 monthly statements and 260 individual transactions using a stratified random sample weighted towards departments with the highest card spend.",
    ],
    uncertain: [
      {
        field_path: "monetary_amounts[0]",
        kind: "conflicting_amount",
        reason: "The Executive Summary states USD 480,000 but Appendix B corrects the recoverable overpayment to USD 512,000; the truth holds the appendix figure.",
        extractor_value: { amount: 480000, currency: "USD", context: "recoverable overpayment to Ridgeline Medical Supplies" },
        extractor_quotes: ["Overpayments to Ridgeline Medical Supplies identified by the audit total USD 480,000."],
        extractor_ambiguity: null,
        verifier: {
          status: "unsupported",
          corrected_value: { amount: 512000, currency: "USD", context: "recoverable overpayment to Ridgeline Medical Supplies" },
          contradiction_detected: true,
          evidence_specificity: 0.75,
        },
        expect_routed: true,
      },
      {
        field_path: "subject_entities[1]",
        kind: "weak_evidence",
        reason: "The entity is correct but the cited sentence refers only to 'the office' and does not name it.",
        extractor_value: { name: "Procurement Office" },
        extractor_quotes: ["The office also maintains the approved supplier list and issues the monthly statements."],
        extractor_ambiguity: "The cited sentence does not name the office.",
        verifier: { status: "supported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.4 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // AUD-2026-011: abbreviation before organization name; exact duplicate PDF exists.
  // -------------------------------------------------------------------------------------------
  {
    key: "AUD-2026-011",
    format: "pdf",
    slug: "meridian-water-audit-report",
    display_name: "Meridian Water chemical procurement audit",
    title: "Audit of Chemical Procurement and Inventory Controls",
    org: "Meridian Water Authority",
    orgLine: "Issued by MWA (Meridian Water Authority)",
    dateLine: "Publication date: 19 February 2026",
    dateIso: "2026-02-19",
    document_type: "audit_report",
    typePhrase: "this audit",
    entities: [{ name: "Meridian Water Authority" }, { name: "Stonebridge Treatment Plant" }, { name: "Clearwell Chemicals" }],
    summary: [
      "This audit examined how MWA, the Meridian Water Authority, procures, receives and stores treatment chemicals at its three plants during 2025. It focused on the Stonebridge Treatment Plant, which accounts for more than half of chemical consumption, and on the framework agreement with Clearwell Chemicals.",
      "The audit found that inventory records did not agree with physical counts, that a material share of supplier invoices were paid without a receiving report, and that emergency purchases were being made outside the framework agreement. Three recommendations are made.",
    ],
    background: [
      "The Meridian Water Authority supplies drinking water to about 380,000 customers and operates the Stonebridge, Larch Hill and Bexley treatment plants. Chlorine, sodium hydroxide and coagulant are purchased under a three year framework agreement with Clearwell Chemicals that began in January 2024.",
      "Chemical deliveries are received by plant operators who are expected to complete a receiving report before the invoice is approved for payment by the accounts payable team. Inventory balances are held in the maintenance management system and are meant to be reconciled monthly to physical counts.",
    ],
    findings: [
      {
        finding: "Chlorine inventory records at the Stonebridge Treatment Plant differed from physical counts by 11 percent.",
        severity: "medium",
        detail: "The difference had accumulated over nine months because monthly counts had been recorded but never reconciled.",
      },
      {
        finding: "Clearwell Chemicals invoices were paid without a receiving report in 27 of 90 sampled cases.",
        severity: "high",
        detail: "In these cases the accounts payable team relied on the delivery note attached to the invoice rather than on plant confirmation.",
      },
      {
        finding: "Emergency purchases were made outside the framework agreement on four occasions.",
        severity: "low",
        detail: "Each purchase was justified by a low stock alert that would have been avoided had the inventory records been accurate.",
      },
    ],
    recommendations: [
      { recommendation: "Perform monthly physical counts of treatment chemicals and reconcile them to the inventory system within five working days.", target_entity: "Stonebridge Treatment Plant", status_if_stated: "In progress" },
      { recommendation: "Require a signed receiving report before any chemical invoice is approved for payment.", target_entity: "Meridian Water Authority Accounts Payable", status_if_stated: "Not started" },
      { recommendation: "Consolidate emergency purchases into the framework agreement with Clearwell Chemicals.", target_entity: "Meridian Water Authority Procurement Unit", status_if_stated: null },
    ],
    financialIntro: "The amounts below are taken from the authority's accounts payable ledger for the 2025 calendar year.",
    amounts: [
      { amount: 3100000, currency: "USD", context: "annual chemical spending across all plants in 2025", sentence: "Annual chemical spending across all plants was $3.1 million in 2025." },
      { amount: 148000, currency: "USD", context: "Clearwell Chemicals invoices paid without a receiving report", sentence: "Invoices paid without a receiving report totalled USD 148,000." },
      { amount: 22000, currency: "USD", context: "emergency purchases outside the framework agreement", sentence: "Emergency purchases outside the framework agreement totalled USD 22,000." },
    ],
    appendix: [
      "Appendix B: Inventory count results. The physical count at the Stonebridge Treatment Plant on 8 December 2025 recorded 41.2 tonnes of chlorine against a system balance of 46.3 tonnes; counts at the Larch Hill and Bexley plants were within 2 percent of the system balance.",
      "Appendix C: Invoice sample. The 90 sampled invoices were selected at random from 612 Clearwell Chemicals invoices paid in 2025 and covered all three plants.",
    ],
    uncertain: [
      {
        field_path: "issuing_organization",
        kind: "abbreviation",
        reason: "The title block introduces the abbreviation MWA before the full organization name; a naive reading returns the abbreviation.",
        extractor_value: "MWA",
        extractor_quotes: ["Issued by MWA (Meridian Water Authority)"],
        extractor_ambiguity: "Title block uses the abbreviation MWA.",
        verifier: { status: "partially_supported", corrected_value: "Meridian Water Authority", contradiction_detected: false, evidence_specificity: 0.75 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // EVL-2026-002: DOCX, superseded by a DOCX v2; unrelated monetary distractor in the appendix.
  // -------------------------------------------------------------------------------------------
  {
    key: "EVL-2026-002",
    format: "docx",
    slug: "larkspur-telehealth-evaluation",
    display_name: "Larkspur rural telehealth evaluation",
    title: "Evaluation of the Rural Telehealth Access Program",
    org: "Larkspur Health Network",
    dateLine: "Publication date: 5 January 2026",
    dateIso: "2026-01-05",
    document_type: "evaluation",
    typePhrase: "this evaluation",
    entities: [{ name: "Rural Telehealth Access Program" }, { name: "Larkspur Health Network" }, { name: "Brightwater Analytics" }],
    summary: [
      "This evaluation assesses the first three years of the Rural Telehealth Access Program operated by Larkspur Health Network across nine rural clinics. It considers uptake, patient attendance, platform reliability and clinician readiness, and draws on activity data, platform logs and interviews with clinic managers.",
      "Uptake grew strongly and attendance improved, but the video platform supplied by Brightwater Analytics missed its availability target in two quarters and clinician training remains incomplete. The evaluation recommends renegotiating the platform agreement, making training mandatory and extending the program to the remaining clinics.",
    ],
    background: [
      "Larkspur Health Network serves a dispersed rural population of about 240,000 people. The Rural Telehealth Access Program began in January 2023 with grant funding and a platform contract awarded to Brightwater Analytics after a competitive tender.",
      "Each participating clinic received video consultation rooms, a scheduling integration and access to the platform helpdesk. Clinicians were expected to complete a four hour training module before conducting telehealth consultations, although completion was not enforced in the scheduling system.",
    ],
    findings: [
      {
        finding: "Telehealth consultations increased from 1,900 to 6,400 per quarter over the evaluation period.",
        severity: "info",
        detail: "Growth was strongest in the three clinics furthest from the regional hospital.",
      },
      {
        finding: "Patient no-show rates for telehealth appointments were 9 percent compared with 21 percent for in-person visits.",
        severity: "low",
        detail: "The difference persisted after adjusting for appointment type and time of day.",
      },
      {
        finding: "The video platform supplied by Brightwater Analytics failed to meet its availability target in two of four quarters.",
        severity: "medium",
        detail: "Recorded availability was 98.1 percent and 97.6 percent in the affected quarters against a contractual target of 99.5 percent.",
      },
      {
        finding: "Clinician training completion was 71 percent against a target of 95 percent.",
        severity: "medium",
        detail: "Untrained clinicians generated a disproportionate share of helpdesk calls during consultations.",
      },
    ],
    recommendations: [
      { recommendation: "Renegotiate the platform service level agreement with Brightwater Analytics to include availability credits.", target_entity: "Larkspur Health Network Contracts Office", status_if_stated: "In progress" },
      { recommendation: "Make platform training mandatory for all clinicians before telehealth scheduling rights are granted.", target_entity: "Larkspur Clinical Education Unit", status_if_stated: "Not started" },
      { recommendation: "Expand the program to the three remaining rural clinics in 2027.", target_entity: "Rural Telehealth Access Program Office", status_if_stated: "Proposed" },
    ],
    financialIntro: "Program finances are summarised from the grant acquittal statements and the platform contract.",
    amounts: [
      { amount: 820000, currency: "USD", context: "annual platform contract with Brightwater Analytics", sentence: "The annual platform contract with Brightwater Analytics is valued at USD 820,000." },
      { amount: 2400000, currency: "USD", context: "program funding over the three year evaluation period", sentence: "Program funding over the three year evaluation period totalled $2.4 million." },
      { amount: 310000, currency: "USD", context: "estimated annual avoided patient travel cost", sentence: "Avoided patient travel is estimated at USD 310,000 per year." },
    ],
    appendix: [
      "Appendix B: Platform availability by quarter. Recorded availability was 99.7 percent, 98.1 percent, 99.6 percent and 97.6 percent for the four quarters of 2025, with the two shortfalls caused by a data centre migration and a certificate expiry.",
      "Appendix C: Funding context. For context only, the regional telehealth grant program administered by the state health department has a separate ceiling of USD 5 million per applicant, which does not apply to this evaluation and is not a cost or benefit of the program.",
    ],
    uncertain: [
      {
        field_path: "monetary_amounts[3]",
        kind: "distractor_amount",
        reason: "Appendix C mentions a grant ceiling that is not an amount of this report; a naive extractor may list it.",
        extractor_value: { amount: 5000000, currency: "USD", context: "regional telehealth grant program ceiling per applicant" },
        extractor_quotes: ["For context only, the regional telehealth grant program administered by the state health department has a separate ceiling of USD 5 million per applicant, which does not apply to this evaluation and is not a cost or benefit of the program."],
        extractor_ambiguity: null,
        verifier: { status: "unsupported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.4 },
        expect_routed: true,
      },
    ],
    distractors: [
      {
        kind: "unrelated_amount",
        text: "a separate ceiling of USD 5 million per applicant",
        note: "Grant program ceiling cited for context in Appendix C; not a monetary amount of this evaluation.",
      },
    ],
  },

  // -------------------------------------------------------------------------------------------
  // EVL-2026-007: duplicate recommendation expressed twice in different wording.
  // -------------------------------------------------------------------------------------------
  {
    key: "EVL-2026-007",
    format: "pdf",
    slug: "kestrel-apprenticeship-evaluation",
    display_name: "Kestrel composite technician apprenticeship evaluation",
    title: "Evaluation of the Composite Technician Apprenticeship",
    org: "Kestrel Aerospace Training Academy",
    dateLine: "Publication date: 8 April 2026",
    dateIso: "2026-04-08",
    document_type: "evaluation",
    typePhrase: "this evaluation",
    entities: [{ name: "Kestrel Aerospace Training Academy" }, { name: "Composite Technician Apprenticeship" }, { name: "Falcon Ridge Aerostructures" }],
    summary: [
      "This evaluation reviews the Composite Technician Apprenticeship delivered by the Kestrel Aerospace Training Academy in partnership with Falcon Ridge Aerostructures. It covers the 2023 and 2024 cohorts and examines completion, mentoring, assessment practice and cost per completer.",
      "Completion exceeded target, but mentor allocation was poorly documented and assessment results were recorded late. The evaluation panel makes three recommendations and notes that the employer partner supports a larger intake in 2027.",
    ],
    background: [
      "The Kestrel Aerospace Training Academy trains technicians for the regional aerospace cluster. The Composite Technician Apprenticeship is a two year programme combining classroom instruction at the academy with supervised placement at Falcon Ridge Aerostructures, the principal employer partner.",
      "Each apprentice is meant to be assigned a workplace mentor at the start of the placement, and assessment outcomes are meant to be entered into the academy registry so that progress can be tracked by the programme board.",
    ],
    findings: [
      {
        finding: "Apprentice completion was 84 percent for the 2024 cohort against a target of 80 percent.",
        severity: "info",
        detail: "Completion for the 2023 cohort was 79 percent, and most non-completers left for employment before finishing.",
      },
      {
        finding: "Mentor allocation was undocumented for 19 of the 52 apprentices placed with Falcon Ridge Aerostructures.",
        severity: "medium",
        detail: "Interviews indicated that mentors were usually assigned informally but that the assignment was not recorded anywhere.",
      },
      {
        finding: "Assessment results were recorded on average 27 days after the assessment date.",
        severity: "low",
        detail: "Late recording meant that the programme board reviewed out of date progress information at two of its four meetings.",
      },
    ],
    recommendations: [
      { recommendation: "Publish a written mentor allocation standard and record the assigned mentor for every apprentice.", target_entity: "Kestrel Aerospace Training Academy", status_if_stated: "In progress" },
      { recommendation: "Record assessment results in the registry within five working days of each assessment.", target_entity: "Kestrel Aerospace Training Academy Registry", status_if_stated: "Not started" },
      { recommendation: "Increase the 2027 intake to 70 apprentices subject to confirmed employer demand.", target_entity: "Falcon Ridge Aerostructures", status_if_stated: "Under discussion" },
    ],
    financialIntro: "Programme costs are drawn from the academy's management accounts for 2025.",
    amounts: [
      { amount: 640000, currency: "USD", context: "annual apprenticeship delivery cost in 2025", sentence: "Annual delivery cost of the apprenticeship was USD 640,000 in 2025." },
      { amount: 12500, currency: "USD", context: "cost per completing apprentice", sentence: "The cost per completing apprentice was USD 12,500." },
    ],
    appendix: [
      "Appendix B: Cohort data. The 2023 cohort enrolled 48 apprentices and the 2024 cohort enrolled 52; both cohorts were placed with Falcon Ridge Aerostructures at its Millbrook and Stanton plants.",
      "Appendix C: Panel note. The panel reiterates that the Academy should adopt a documented mentor allocation standard so that every apprentice has a named mentor on record. This point was raised by the employer partner as well as by apprentices interviewed during the evaluation.",
    ],
    uncertain: [
      {
        field_path: "recommendations[3]",
        kind: "duplicate_recommendation",
        reason: "Appendix C restates Recommendation 1 in different wording; the truth lists the recommendation once but an extractor may emit it twice.",
        extractor_value: { recommendation: "Adopt a documented mentor allocation standard so that every apprentice has a named mentor on record.", target_entity: "Kestrel Aerospace Training Academy", status_if_stated: null },
        extractor_quotes: ["The panel reiterates that the Academy should adopt a documented mentor allocation standard so that every apprentice has a named mentor on record."],
        extractor_ambiguity: null,
        verifier: { status: "partially_supported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.75 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },
];
