# Installed release omits the served web assets

- Severity: High
- Status: In progress
- Owner: P009; P004/P006 installed-module integration implementer
- Affected files: `infra/deploy/package.py`, installed `apps/web/dist/`, deployment package and browser acceptance tests
- Acceptance: [P009-01](../design/proposals/009-portable-deployment-and-restore.md#independent-acceptance), with the [file/terminal integration](../docs/reports/2026-09-08-p004-p006-integration.md)

## Evidence — 8 September 2026

Fresh installed artifact `75ea68ec29f66fb5cb78adbd5650426f05127fa0937a609f10437f67939ea29f` passed backend readiness, but opening the authenticated application returned `INTERNAL_ERROR` JSON. The owner endpoint returned HTTP 200; the Add project UI never appeared, before any project mutation. The retained screenshot contains the bounded error envelope and no credentials; main inspected it independently.

The artifact manifest records source `3a81e2a96748e4d1675522cf9779b5a6803fdc28370535845f8106d3a2786a7a`, 954 files, and package implementation SHA-256 `25c0bc5dcc33715a66285e1ab84ed98a1c8262a8d7bd2c1f1de9b836b0044062`. Both the authenticated manifest and direct installed-file inspection show that `apps/web/dist/index.html` is absent. The disposable B run retains `modules-failure.png` and `modules-failure.json` under its owned `xfs-82139d57-2c46-40e0-a1e5-94d8be12c8bd` control directory.

The packager checks that a built web entry exists in the source, copies Git-selected source files, then separately copies only root `dist/`. Vite's actual output is ignored by Git at `apps/web/dist/`, so the check does not ensure those served bytes enter the immutable package. Main confirmed that omission in the source. Backend readiness alone did not exercise the browser document or its asset graph.

## Impact and next steps

The affected package cannot deliver Harbor's authenticated browser interface. This blocks the installed user outcome; earlier administrator/API/UID evidence remains limited to its recorded scope. The separately archived P009 review findings preserve their historical closure and do not establish that this newly tested installed UI worked.

Include the exact built web output in the immutable, hashed payload, validate required package contents before installation, and test the actual installed authenticated document and its scripts/styles/workers. Run the complete installed file/terminal outcomes on a fresh corrected artifact, then independently review the packaging change and matching evidence. Record artifact/source identities, commands, environment and limitations here before archiving this same issue. No in-place repair of the failed immutable release or successful backend-only rerun closes this finding.
