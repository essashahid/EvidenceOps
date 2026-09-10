# Synthetic corpus

All demo documents are synthetic and generated in-repository.

Run `pnpm fixtures:generate`. The generator validates the manifest, truth, word/page counts, duplicate hashes, corrected editions and golden question distribution. PDF dates and DOCX ZIP/core dates are fixed for reproducibility.

- `source/`: authored report material and scenario definitions.
- `documents/`: 20 files, 16 PDF / 4 DOCX; 16 logical documents, 18 distinct versions, two exact duplicates and two corrections; 57 PDF pages including copies.
- `documents/manifest.json`: ordered ingest expectations.
- `documents/extras/`: corrupt PDF/DOCX and scanned-like PDF failure cases.
- `truth/`: expected records, source provenance and 17 planted uncertainties; 16 expected review routes.
- `golden/`: 40 questions (20 single-document, 10 cross-document, 10 unanswerable).

The mock provider intentionally consumes these truth files and golden cases. It is an implementation test double, not a quality benchmark for OpenAI. Previous generated fixture layouts were archived locally during the implementation audit and replaced by this single canonical corpus.
