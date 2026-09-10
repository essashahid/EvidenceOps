import type { DocSpec } from "../types";

/** Documents 7 to 11: Tidewater, Granite Peak, Cobalt Ridge, Silverline Rail, Bluefin. */
export const DOCUMENTS_2: DocSpec[] = [
  // -------------------------------------------------------------------------------------------
  // INV-2026-005: missing publication date (an extractor may guess the fieldwork date).
  // -------------------------------------------------------------------------------------------
  {
    key: "INV-2026-005",
    format: "pdf",
    slug: "tidewater-port-investigation",
    display_name: "Tidewater Berth 6 weight discrepancy investigation",
    title: "Investigation into Verified Gross Mass Discrepancies at Berth 6",
    org: "Tidewater Port Authority",
    dateLine: null,
    dateIso: null,
    document_type: "investigation",
    typePhrase: "this investigation",
    entities: [{ name: "Tidewater Port Authority" }, { name: "Berth 6 Container Terminal" }, { name: "Harbor Point Logistics" }],
    summary: [
      "This investigation was opened by the Tidewater Port Authority after two shipping lines reported that declared container weights at the Berth 6 Container Terminal did not match the weights recorded on loading. The terminal is operated under concession by Harbor Point Logistics.",
      "The investigation compared declared verified gross mass with weighbridge readings for every export container handled at Berth 6 between November 2025 and April 2026. It found a material rate of discrepancy, expired calibration certificates and a pattern of unexplained overrides of weight alerts in the terminal operating system.",
    ],
    background: [
      "Berth 6 is the largest of the four container berths at the port and handled 218,000 export containers in 2025. Harbor Point Logistics has operated the terminal since 2019 and is responsible under the concession for weighbridge calibration and for the terminal operating system.",
      "Shippers must declare a verified gross mass for every packed container before loading. The terminal weighs each container on arrival and the operating system raises an alert when the declared and measured weights differ by more than five percent. Fieldwork concluded on 18 May 2026.",
    ],
    findings: [
      {
        finding: "Declared container weights differed from weighbridge readings by more than five percent for 312 of 4,100 containers examined.",
        severity: "high",
        detail: "The discrepancies were concentrated among six shippers and were mostly under-declarations.",
      },
      {
        finding: "Weighbridge calibration certificates at Berth 6 had expired in October 2025.",
        severity: "medium",
        detail: "The two weighbridges continued in use for six months without recertification, although test weights applied during the investigation showed them to be within tolerance.",
      },
      {
        finding: "Harbor Point Logistics staff overrode weight alerts in the terminal system on 88 occasions without recording a reason.",
        severity: "high",
        detail: "The override function was available to every planner and no supervisory approval was required.",
      },
      {
        finding: "Vessel stability calculations remained within safe margins for every sailing examined.",
        severity: "info",
        detail: "The stowage plans for all 61 sailings in the period were recalculated using measured weights and none breached the stability limits.",
      },
    ],
    recommendations: [
      { recommendation: "Recalibrate and recertify the Berth 6 weighbridges and set a calendar reminder ninety days before each expiry.", target_entity: "Berth 6 Container Terminal", status_if_stated: "Completed" },
      { recommendation: "Require a written reason for every weight alert override and review overrides weekly.", target_entity: "Harbor Point Logistics", status_if_stated: "In progress" },
      { recommendation: "Refer the 312 discrepant declarations to the shipping lines concerned for correction.", target_entity: "Tidewater Port Authority Compliance Unit", status_if_stated: null },
    ],
    financialIntro: "The financial figures below were assembled from the concession accounts and the port authority's claims register.",
    amounts: [
      { amount: 74000, currency: "USD", context: "cost of weighbridge recalibration and recertification", sentence: "Recalibration and recertification of the weighbridges cost USD 74,000." },
      { amount: 1900000, currency: "USD", context: "estimated annual exposure from misdeclared weights", sentence: "The estimated annual exposure from misdeclared weights is $1.9 million in potential penalties and claims." },
    ],
    appendix: [
      "Appendix B: Discrepancy distribution. Of the 312 discrepant containers, 241 were under-declared by between five and ten percent, 58 by between ten and twenty percent, and 13 by more than twenty percent.",
      "Appendix C: Override log. The 88 overrides were recorded by 14 different planners; 52 of them were entered during the night shift, when no supervisor was rostered in the planning office.",
    ],
    uncertain: [
      {
        field_path: "publication_date",
        kind: "missing_date",
        reason: "The title block has no publication date; a naive extractor may report the fieldwork completion date instead.",
        extractor_value: "2026-05-18",
        extractor_quotes: ["Fieldwork concluded on 18 May 2026."],
        extractor_ambiguity: "No publication date is printed; the fieldwork date was used.",
        verifier: { status: "unsupported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.4 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // INV-2026-012: ambiguous recommendation owner (two possible owners).
  // -------------------------------------------------------------------------------------------
  {
    key: "INV-2026-012",
    format: "pdf",
    slug: "granite-peak-conveyor-investigation",
    display_name: "Granite Peak Conveyor 4 belt failure investigation",
    title: "Investigation of the Conveyor 4 Belt Failure",
    org: "Granite Peak Mining",
    dateLine: "Publication date: 22 May 2026",
    dateIso: "2026-05-22",
    document_type: "investigation",
    typePhrase: "this investigation",
    entities: [{ name: "Granite Peak Mining" }, { name: "Conveyor 4" }, { name: "Ironvale Belting Services" }],
    summary: [
      "This investigation examines the failure of the Conveyor 4 belt at the Granite Peak Mining primary crushing plant on 9 April 2026. The failure stopped ore delivery to the mill for 31 hours. Nobody was injured, and the emergency stop system operated as designed.",
      "The investigation attributes the failure to a splice installed by Ironvale Belting Services shortly before the event, compounded by belt tension sensor faults that had been reported for three weeks and were not carried across shift handovers. Three recommendations are made, two of which were completed before publication.",
    ],
    background: [
      "Granite Peak Mining operates an open pit copper mine with a primary crushing plant connected to the mill by four overland conveyors. Conveyor 4 is 1.9 kilometres long and carries about 2,400 tonnes per hour when the plant is at full rate.",
      "Ironvale Belting Services holds the belt maintenance contract for the site and performs splices, belt replacements and sensor calibration. Belt tension sensors on each conveyor report to the plant control system, where faults are shown on the operator screen but are not automatically added to the shift handover log.",
    ],
    findings: [
      {
        finding: "The belt splice that failed had been installed by Ironvale Belting Services eleven days before the failure.",
        severity: "high",
        detail: "Laboratory examination found that the splice adhesive had not cured fully because the cure time was cut short to return the conveyor to service.",
      },
      {
        finding: "Belt tension sensors on Conveyor 4 had reported intermittent faults for three weeks before the failure.",
        severity: "high",
        detail: "The faults were acknowledged on the operator screen 43 times but no work order was raised.",
      },
      {
        finding: "No injuries occurred and the emergency stop functioned as designed.",
        severity: "info",
        detail: "The belt came to rest within nine seconds of the trip and the area was clear of personnel.",
      },
      {
        finding: "The shift handover log did not mention the sensor faults on any of the 21 shifts before the failure.",
        severity: "medium",
        detail: "Operators interviewed said they assumed the faults were known to the maintenance planners.",
      },
    ],
    recommendations: [
      { recommendation: "Inspect every splice installed by Ironvale Belting Services in the last twelve months and replace any that fail a cure test.", target_entity: "Granite Peak Mining Maintenance Department", status_if_stated: "Completed" },
      {
        recommendation: "Replace the belt tension sensors on Conveyor 4 with units that raise a work order automatically on fault.",
        target_entity: null,
        status_if_stated: "Not started",
        targetText: "Target: the Maintenance Superintendent or the Site Engineering Manager, to be confirmed by the plant manager.",
      },
      { recommendation: "Add open sensor faults to the mandatory shift handover checklist.", target_entity: "Granite Peak Mining Operations", status_if_stated: "Completed" },
    ],
    financialIntro: "The cost of the event is summarised below from the production accounts and the maintenance contract.",
    amounts: [
      { amount: 410000, currency: "USD", context: "lost production during the 31 hour outage", sentence: "Lost production during the 31 hour outage is valued at USD 410,000." },
      { amount: 58000, currency: "USD", context: "belt replacement and splice repair cost", sentence: "Belt replacement and splice repair cost USD 58,000." },
      { amount: 21000, currency: "USD", context: "estimated cost of replacing the belt tension sensors", sentence: "Replacing the belt tension sensors is estimated at USD 21,000." },
    ],
    appendix: [
      "Appendix B: Timeline. The splice was installed on 29 March 2026, the first tension sensor fault was logged on 19 March 2026, and the belt failed at 02:14 on 9 April 2026 during the night shift.",
      "Appendix C: Persons interviewed. The investigation interviewed the four operators on shift, the maintenance planner, the Ironvale Belting Services crew leader and the plant manager.",
    ],
    uncertain: [
      {
        field_path: "recommendations[1]",
        kind: "ambiguous_owner",
        reason: "The recommendation names two possible owners and says the owner is to be confirmed; the truth records no target entity.",
        extractor_value: { recommendation: "Replace the belt tension sensors on Conveyor 4 with units that raise a work order automatically on fault.", target_entity: "Maintenance Superintendent", status_if_stated: "Not started" },
        extractor_quotes: ["Target: the Maintenance Superintendent or the Site Engineering Manager, to be confirmed by the plant manager."],
        extractor_ambiguity: "Two owners are named and the assignment is to be confirmed.",
        verifier: {
          status: "partially_supported",
          corrected_value: { recommendation: "Replace the belt tension sensors on Conveyor 4 with units that raise a work order automatically on fault.", target_entity: null, status_if_stated: "Not started" },
          contradiction_detected: false,
          evidence_specificity: 0.75,
        },
        expect_routed: true,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // GDN-2026-001: DOCX with abbreviated date "4 Sept. 26"; exact duplicate DOCX exists.
  // -------------------------------------------------------------------------------------------
  {
    key: "GDN-2026-001",
    format: "docx",
    slug: "cobalt-ridge-vendor-guidance",
    display_name: "Cobalt Ridge vendor onboarding guidance note",
    title: "Guidance Note on Vendor Onboarding and Due Diligence",
    org: "Cobalt Ridge Energy",
    dateLine: "Publication date: 4 Sept. 26",
    dateIso: "2026-09-04",
    document_type: "guidance",
    typePhrase: "guidance note",
    entities: [{ name: "Cobalt Ridge Energy" }, { name: "Vendor Onboarding Portal" }, { name: "Brightwater Analytics" }],
    summary: [
      "This guidance note sets out the minimum due diligence that business units of Cobalt Ridge Energy must complete before a new vendor is added to the Vendor Onboarding Portal. It replaces the 2023 procedure and responds to weaknesses identified in a compliance self assessment completed in June 2026.",
      "The self assessment found incomplete onboarding files, sanctions screening that was never repeated after onboarding, and a portal that does not enforce the tax identification field. The guidance sets out three actions with named owners and explains the screening service provided by Brightwater Analytics.",
    ],
    background: [
      "Cobalt Ridge Energy operates wind and solar assets in three states and engages about 900 active vendors, ranging from turbine manufacturers to local civil contractors. All vendors are registered through the Vendor Onboarding Portal, which collects registration documents, bank details and compliance declarations.",
      "Sanctions and adverse media screening is performed through a subscription service supplied by Brightwater Analytics. Under the 2023 procedure, screening was run once at onboarding and there was no requirement to repeat it while the vendor remained active.",
    ],
    findings: [
      {
        finding: "Onboarding files were incomplete for 23 percent of vendors added in 2025.",
        severity: "medium",
        detail: "Missing items were most often the signed code of conduct and evidence of insurance.",
      },
      {
        finding: "Sanctions screening was not repeated after initial onboarding for any active vendor.",
        severity: "high",
        detail: "Some vendors had been active for more than seven years without rescreening.",
      },
      {
        finding: "The Vendor Onboarding Portal does not enforce a mandatory tax identification field.",
        severity: "low",
        detail: "The field was blank for 61 vendors, which delayed year end tax reporting.",
      },
    ],
    recommendations: [
      { recommendation: "Implement a quarterly vendor scorecard for all strategic vendors covering compliance status, insurance and performance.", target_entity: "Cobalt Ridge Energy Supply Chain Group", status_if_stated: "Not started" },
      { recommendation: "Repeat sanctions screening every twelve months for every active vendor using the Brightwater Analytics screening service.", target_entity: "Cobalt Ridge Energy Compliance Team", status_if_stated: "In progress" },
      { recommendation: "Make the tax identification field mandatory in the Vendor Onboarding Portal.", target_entity: "Cobalt Ridge Energy IT Services", status_if_stated: "Completed" },
    ],
    financialIntro: "The costs of the screening service and the portal changes are set out below.",
    amounts: [
      { amount: 65000, currency: "USD", context: "annual screening service fee payable to Brightwater Analytics", sentence: "The annual screening service fee payable to Brightwater Analytics is USD 65,000." },
      { amount: 120000, currency: "EUR", context: "onboarding portal enhancement budget for 2026", sentence: "The onboarding portal enhancement budget for 2026 is EUR 120,000, funded from the European subsidiary's technology allocation." },
    ],
    appendix: [
      "Appendix B: Required onboarding documents. Every new vendor must supply a certificate of incorporation, a signed code of conduct, evidence of insurance, bank verification and a completed tax identification form before the portal record is activated.",
      "Appendix C: Screening workflow. The Brightwater Analytics service returns a screening result within one working day; any potential match must be reviewed by the compliance team and the outcome recorded in the portal before the vendor is activated or retained.",
    ],
    uncertain: [
      {
        field_path: "publication_date",
        kind: "abbreviated_date",
        reason: "The date is written as 4 Sept. 26 with a two digit year; the reading 2026-09-04 is correct but should be flagged as uncertain.",
        extractor_value: "2026-09-04",
        extractor_quotes: ["Publication date: 4 Sept. 26"],
        extractor_ambiguity: "Year is written with two digits and the month is abbreviated.",
        verifier: { status: "supported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.75 },
        expect_routed: false,
      },
    ],
    distractors: [],
  },

  // -------------------------------------------------------------------------------------------
  // GDN-2026-006: unrelated monetary distractor in the appendix (statutory penalty ceiling).
  // -------------------------------------------------------------------------------------------
  {
    key: "GDN-2026-006",
    format: "pdf",
    slug: "silverline-rail-safety-guidance",
    display_name: "Silverline Rail contractor safety induction guidance",
    title: "Guidance Note on Contractor Safety Induction",
    org: "Silverline Rail",
    dateLine: "Publication date: 30 June 2026",
    dateIso: "2026-06-30",
    document_type: "guidance",
    typePhrase: "guidance note",
    entities: [{ name: "Silverline Rail" }, { name: "Eastgate Yard" }, { name: "Trackwise Contracting" }],
    summary: [
      "This guidance note explains the induction that every contractor worker must complete before entering a Silverline Rail operational site. It was prepared after an induction records check at Eastgate Yard found a substantial number of contractor staff working without a valid induction record.",
      "The note describes the records check, sets out the induction standard that applies from 1 August 2026, and confirms the cost of re-inducting active contractor staff. Trackwise Contracting is cited as an example of full compliance.",
    ],
    background: [
      "Silverline Rail operates 640 kilometres of freight railway and three maintenance yards. Eastgate Yard is the largest yard and hosts an average of 60 contractor staff on any working day, drawn from nine contracting companies.",
      "Contractor staff must complete a site induction covering track access rules, isolation procedures and emergency response before their access card is activated. The induction module is owned by the safety directorate and delivered by site management at each yard.",
    ],
    findings: [
      {
        finding: "Contractor induction records were missing for 41 of 260 contractor staff who worked at Eastgate Yard in 2025.",
        severity: "high",
        detail: "In most cases the access card had been activated on the strength of a verbal confirmation from the contracting company.",
      },
      {
        finding: "Trackwise Contracting completed inductions for all of its staff before mobilisation.",
        severity: "info",
        detail: "Trackwise Contracting maintains its own induction register and provides a copy to site management every month.",
      },
      {
        finding: "Induction content had not been updated to reflect the 2025 track access rules.",
        severity: "medium",
        detail: "The module still described the superseded lookout arrangements withdrawn in March 2025.",
      },
    ],
    recommendations: [
      { recommendation: "Refuse site access to any contractor worker without a valid induction record in the access system.", target_entity: "Eastgate Yard Site Management", status_if_stated: "Completed" },
      { recommendation: "Update the induction module for the 2025 track access rules and re-induct all active contractor staff.", target_entity: "Silverline Rail Safety Directorate", status_if_stated: "In progress" },
    ],
    financialIntro: "The financial figures below are stated in pounds sterling and were confirmed by the finance business partner for infrastructure.",
    amounts: [
      { amount: 96000, currency: "GBP", context: "expected cost of re-inducting all active contractor staff", sentence: "Re-inducting all active contractor staff is expected to cost GBP 96,000." },
      { amount: 2200000, currency: "GBP", context: "contractor spending at Eastgate Yard in 2025", sentence: "Contractor spending at Eastgate Yard was GBP 2.2 million in 2025." },
    ],
    appendix: [
      "Appendix B: Records check method. The check compared the 260 contractor access cards activated at Eastgate Yard in 2025 with the induction register and with the training records held by each contracting company.",
      "Appendix C: Regulatory reference. For reference, the statutory penalty ceiling for a safety induction breach under the Rail Operations Act is GBP 500,000 per incident; no penalty has been assessed and the figure is not a cost identified by this note.",
    ],
    uncertain: [
      {
        field_path: "monetary_amounts[2]",
        kind: "distractor_amount",
        reason: "Appendix C cites a statutory penalty ceiling that is not a monetary amount of this report.",
        extractor_value: { amount: 500000, currency: "GBP", context: "statutory penalty ceiling for a safety induction breach" },
        extractor_quotes: ["For reference, the statutory penalty ceiling for a safety induction breach under the Rail Operations Act is GBP 500,000 per incident; no penalty has been assessed and the figure is not a cost identified by this note."],
        extractor_ambiguity: null,
        verifier: { status: "unsupported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.4 },
        expect_routed: true,
      },
    ],
    distractors: [
      {
        kind: "unrelated_amount",
        text: "GBP 500,000 per incident",
        note: "Statutory penalty ceiling cited for reference in Appendix C; no penalty was assessed and it is not a monetary amount of this note.",
      },
    ],
  },

  // -------------------------------------------------------------------------------------------
  // MEM-2026-008: document_type "other" (briefing memorandum); weak evidence for an entity.
  // -------------------------------------------------------------------------------------------
  {
    key: "MEM-2026-008",
    format: "pdf",
    slug: "bluefin-cold-chain-memorandum",
    display_name: "Bluefin summer harvest cold chain memorandum",
    title: "Briefing Memorandum on Cold Chain Performance for the Summer Harvest",
    org: "Bluefin Aquaculture",
    dateLine: "Publication date: 15 July 2026",
    dateIso: "2026-07-15",
    document_type: "other",
    typePhrase: "briefing memorandum",
    entities: [{ name: "Bluefin Aquaculture" }, { name: "Halvorsen Cold Chain Logistics" }, { name: "Seabright Processing Plant" }],
    summary: [
      "This briefing memorandum summarises cold chain performance for the Bluefin Aquaculture summer harvest between April and June 2026 for the attention of the executive committee. It is not an audit or a formal evaluation and draws on shipment logs, rejection notices and plant throughput data.",
      "Temperature excursions occurred on a small but costly share of shipments handled by Halvorsen Cold Chain Logistics, and the value of product rejected on arrival exceeded the level planned for the season. The memorandum proposes two actions, one of which the contractor has already agreed to.",
    ],
    background: [
      "Bluefin Aquaculture harvests farmed salmon from six sea sites and processes it at the Seabright Processing Plant before shipping chilled product to wholesale customers. The contractor collected product from the plant six days per week. Halvorsen Cold Chain Logistics has held the cold chain contract since 2024 and operates a fleet of 22 refrigerated trailers on Bluefin routes.",
      "Chilled product must remain at or below 4 degrees Celsius from packing to delivery. Customers reject any consignment whose temperature record shows an excursion above that limit for more than thirty minutes.",
    ],
    findings: [
      {
        finding: "Temperature excursions above 4 degrees Celsius were recorded on 17 shipments handled by Halvorsen Cold Chain Logistics.",
        severity: "medium",
        detail: "Eleven of the excursions occurred on the longest route, where trailers were held at a customer dock for more than two hours.",
      },
      {
        finding: "Product rejected on arrival totalled 3.1 percent of harvest volume against a seasonal plan of 1.5 percent.",
        severity: "medium",
        detail: "Rejections were driven almost entirely by temperature excursions rather than by quality defects at packing.",
      },
      {
        finding: "The Seabright Processing Plant achieved a packing throughput of 42 tonnes per day, above the plan of 38 tonnes.",
        severity: "info",
        detail: "The higher throughput reflects the second packing line commissioned in March 2026.",
      },
    ],
    recommendations: [
      { recommendation: "Install continuous temperature loggers on every Halvorsen Cold Chain Logistics trailer used for Bluefin shipments.", target_entity: "Halvorsen Cold Chain Logistics", status_if_stated: "Agreed" },
      { recommendation: "Hold a rejection review meeting with the cold chain contractor within 48 hours of each rejected shipment.", target_entity: "Bluefin Aquaculture Quality Team", status_if_stated: null },
    ],
    financialIntro: "The financial effect of the season is summarised below in the currencies of the underlying contracts.",
    amounts: [
      { amount: 265000, currency: "USD", context: "value of product rejected on arrival during the summer harvest", sentence: "Product rejected on arrival during the summer harvest was valued at USD 265,000." },
      { amount: 1100000, currency: "USD", context: "annual cold chain contract with Halvorsen Cold Chain Logistics", sentence: "The annual cold chain contract with Halvorsen Cold Chain Logistics is valued at $1.1 million." },
      { amount: 38000, currency: "CAD", context: "quoted cost of continuous temperature loggers for the trailer fleet", sentence: "Continuous temperature loggers for the trailer fleet are quoted at CAD 38,000 by the Canadian supplier." },
    ],
    appendix: [
      "Appendix B: Excursions by route. The 17 excursions were distributed across four routes, with 11 on the coastal route, 4 on the inland route and 1 on each of the two metropolitan routes.",
      "Appendix C: Rejection notices. Customers issued 23 rejection notices during the season, of which 21 cited a temperature excursion and 2 cited packaging damage.",
    ],
    uncertain: [
      {
        field_path: "subject_entities[1]",
        kind: "weak_evidence",
        reason: "The entity is correct but the cited sentence refers only to 'the contractor' and does not name it.",
        extractor_value: { name: "Halvorsen Cold Chain Logistics" },
        extractor_quotes: ["The contractor collected product from the plant six days per week."],
        extractor_ambiguity: "The cited sentence does not name the contractor.",
        verifier: { status: "supported", corrected_value: null, contradiction_detected: false, evidence_specificity: 0.4 },
        expect_routed: true,
      },
    ],
    distractors: [],
  },
];
