# Harbor design

Decision: Draft for the detailed design · Delivery: Planned. The implementation direction is established; every feature remains unimplemented. Decision (`Draft`, `Accepted`, `Superseded`) and delivery (`Planned`, `In progress`, `Implemented`, `Verified`) are separate states. Existing session authorization governs work; metadata does not create a universal approval gate.

- [Architecture](architecture.md): system boundaries, identity, runtime/data contracts, local development, verification, self-development, and releases.
- [Feature proposals](proposals/README.md): complete user outcomes, dependencies, acceptance criteria, and implementation status.
- [Proposal template](proposal-template.md): the required structure for a new or revised feature proposal.
- [Developer guide](../docs/developer/development.md): development and verification workflow; listed commands are planned until implemented.

Keep architecture and feature decisions in `design/`. Keep user/developer guidance and verification reports in `docs/`. Track unresolved issues in `issues/` with severity, evidence, impact, and next steps.

A feature can depend on earlier accepted capabilities, but must be exercisable and verifiable in a fresh isolated environment without waiting for a future feature. Split proposals by complete outcomes, not frontend/backend layers or arbitrary size. Do not mark a feature complete from mock-only tests, a design review, or a successful build alone.
