# EvidenceOps fixture corpus

Synthetic operational reports used to exercise the EvidenceOps pipeline end to end: upload and
deduplication, versioning, parsing, cited extraction, verification, review routing and RAG
evaluation. Every organization, facility, vendor, system and figure is fictional.

The corpus is fully described by the ground-truth JSON files. The PDF and DOCX files under
`corpus/` are *rendered from* that JSON by `generate.ts`, so the JSON is the source of truth and
the binary files are reproducible build artifacts.

## Layout

| Path | Contents |
| --- | --- |
| `types.ts` | TypeScript types for every JSON file here (`GroundTruth`, `PlantedIssue`, `Manifest`, `RagCase`). |
| `ground-truth/<KEY>.v<N>.json` | One file per document version: the correct `ReportRecord`, a verbatim evidence quote for every leaf field, the planted issues and the full body text. |
| `manifest.json` | The 20 corpus files in upload order with the expected ingestion outcome for each. |
| `corpus/` | Generated PDFs and DOCX files (16 PDF, 4 DOCX). |
| `extras/` | Generated negative cases: `scanned-like.pdf`, `corrupt.pdf`, `corrupt.docx`. |
| `eval/rag-questions.json` | 40 golden question-answering cases (32 answerable, 8 refusals). |
| `generate.ts` | Renders everything above and verifies it against the real parsers. |

## Composition

Sixteen logical documents, eighteen document versions, twenty corpus files.

| Logical key | Organization | Type | Format | Versions | Planted issues |
| --- | --- | --- | --- | --- | --- |
| OPS-2026-004 | Northstar Distribution | operational_review | pdf | v1, v2 (R1) | v1: 1, v2: 1 |
| OPS-2026-009 | Redwood Municipal Transit | operational_review | pdf | v1 | 1 |
| AUD-2026-011 | Meridian Water Authority | audit_report | pdf | v1 | 1 |
| AUD-2026-003 | Orchard Valley School District | audit_report | pdf | v1 | 1 |
| INC-2026-007 | Harbor Point Logistics | incident_report | pdf | v1 | 2 |
| INC-2026-012 | Granite Peak Energy Cooperative | incident_report | pdf | v1 | 0 |
| INC-2026-002 | Larkspur Health Network | incident_report | docx | v1 | 1 |
| FIN-2026-002 | Silverline Rail | financial_review | pdf | v1, v2 (R1) | v1: 1, v2: 1 |
| FIN-2026-006 | Bluefin Aquaculture | financial_review | pdf | v1 | 0 |
| FIN-2026-010 | Orchard Valley School District | financial_review | docx | v1 | 0 |
| CMP-2026-005 | Larkspur Health Network | compliance_assessment | pdf | v1 | 1 |
| CMP-2026-008 | Tidewater Port Authority | compliance_assessment | pdf | v1 | 0 |
| CMP-2026-013 | Cobalt Ridge Mining Services | compliance_assessment | docx | v1 | 1 |
| PSR-2026-009 | Kestrel Aerospace Components | project_status_report | pdf | v1 | 1 |
| PSR-2026-003 | Cobalt Ridge Mining Services | project_status_report | pdf | v1 | 1 |
| PSR-2026-006 | Meridian Water Authority | project_status_report | docx | v1 | 0 |

Manifest outcomes: 16 `processed` (all v1 files), 2 `new_version` (the two corrected editions,
listed after the versions they supersede) and 2 `duplicate` (byte-for-byte copies of
`AUD-2026-011` and `INC-2026-012` under different filenames, listed after their originals).

The two corrected editions (`OPS-2026-004.v2`, `FIN-2026-002.v2`) carry an `-R1` report number,
a later publication date, and an Executive Summary paragraph that states explicitly which figure
and which finding or recommendation they correct. They are the *current* versions of their
logical documents.

Shared entities for cross-document retrieval: Cardinal Fleet Services (OPS-2026-004,
INC-2026-007), Brightwater Controls (AUD-2026-011, PSR-2026-006), Sentinel Access Control
(CMP-2026-005, INC-2026-002). Four organizations issue two reports each (Larkspur, Orchard
Valley, Cobalt Ridge, Meridian).

## Document structure

Every body follows the same section order so that a real model has consistent cues: title block
(title, `Report No. ...`, `Issued by ...`, `Published D Month YYYY`), Executive Summary,
Background, Findings (`Finding N: ... Severity: X.`), Recommendations
(`Recommendation N: ... Priority: X.`), Financial Impact (one sentence per monetary amount, in
varied styles such as `$1.25 million`, `$316,400`, `USD 540,000`, `CAD 950,000`) and Appendix.
Bodies are 700 to 1,100 words and render to 2 or 3 PDF pages. All text is plain ASCII with
straight quotes so that `pdf-lib` can draw it and `normalizeText` leaves it unchanged.

`evidence` maps every leaf field path of the record (`report_title`,
`subject_entities[0].name`, `monetary_amounts[2].amount`, ...) to a quote that is an exact
substring of one body paragraph. Leaves of the same list item share a sentence. Severity and
priority quotes include the finding or recommendation statement so that they are unique within a
document even when several items share a rating.

## Planted issues

Fourteen issues are planted across thirteen versions (at most two per document). The record
always holds the correct value; `planted[]` describes the naive reading a mock extractor should
produce and the verdict a mock verifier should return.

| Kind | Where | What happens |
| --- | --- | --- |
| contradiction | OPS-2026-004.v1, OPS-2026-009, INC-2026-007, PSR-2026-009 | The Executive Summary states an older or transposed figure (or calls a Medium recommendation the top priority) while the authoritative section states the correct value. Extractor picks the summary; verifier returns `partially_supported` with the corrected value. |
| ambiguous_phrasing | INC-2026-007, FIN-2026-002.v2, INC-2026-002 | A severity sentence names both High and Critical; an internal draft date or the incident date competes with the publication date. |
| weak_evidence | FIN-2026-002.v1, CMP-2026-005, CMP-2026-013 | The severity or priority label is omitted and only implied ("serious control weakness", "without delay", "minor issue"). Extractor infers the right value; verifier returns `partially_supported`. |
| missing_evidence | AUD-2026-011, AUD-2026-003 | The extractor invents a fourth recommendation or a third monetary amount whose quote does not exist in the document; verifier returns `unsupported`. |
| formatting_variant | OPS-2026-004.v2, PSR-2026-003 | The Appendix restates an amount as `1.15m` or `CAD 0.95M`; the value is correct and `supported`. |

Documents with no planted issues (INC-2026-012, FIN-2026-006, FIN-2026-010, CMP-2026-008,
PSR-2026-006) are deliberately clean and unambiguous.

## RAG evaluation cases

`eval/rag-questions.json` holds exactly 40 cases. The 32 answerable cases cover amounts, dates,
findings, recommendations, entities and document type, including four cross-document "which
reports mention X" questions (each answered by two documents) and five questions whose answer
changed between v1 and v2 so that only the current version's figure counts. `expected_facts` are
short phrases that appear verbatim in the current version's body text. The 8 refusal cases sound
plausible but ask about organizations, topics or metrics that no document covers.

## Regenerating

```
pnpm fixtures:generate
```

The generator:

1. loads every `ground-truth/*.json`, validates the record against `reportRecordSchema`, and
   checks that every leaf has an evidence quote found in the body, that planted quotes are (or,
   for `missing_evidence`, are not) present, and that list sizes and word counts are in range;
2. renders PDFs with `pdf-lib` (Helvetica 11pt, Helvetica-Bold 13pt headings, 612x792 pages,
   54pt margins, manual word wrap, fixed metadata dates so output is byte-identical run to run)
   and DOCX files with the `docx` package (one paragraph per body paragraph, headings as
   `HEADING_1`/`HEADING_2`);
3. copies the two manifest duplicates byte for byte and writes the `extras/` negative cases;
4. re-parses every corpus file with `parsePdf`/`parseDocx` from `src/lib/pipeline/parse.ts` and
   asserts that every evidence quote is recoverable from a parsed block, that PDFs have 2 to 6
   pages, that the manifest is consistent (order, duplicates identical, 16 PDF + 4 DOCX), that the
   extras produce `unsupported` and `failed`, and that every eval fact is verbatim in its
   document;
5. prints a summary table and exits non-zero on any failure.

PDF output is deterministic. DOCX output embeds a timestamp and therefore differs between runs,
which is why the manifest duplicates are PDFs.
