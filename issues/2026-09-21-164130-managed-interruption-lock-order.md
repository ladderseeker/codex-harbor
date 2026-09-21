# Managed administrator interruption takes child locks before conversations

- Severity: High; managed interruption can encounter lock inversion while draining.
- Owner: Awaiting owner selection under existing managed deployment obligations.
- Status: Open; outside the selected personal VPS correction.
- Recorded: 21 September 2026, Asia/Shanghai.

Source inspection during P024's shared persistence correction found that `infra/deploy/database.ts` action `interrupt` updates turn operations before updating related sessions and approvals. `infra/deploy/control.py` invokes it from `maintenance(interrupt=True)` before stopping API/supervisor services, and from `recover_runtime` before the service stop. There is no enforced stopped-service prerequisite at those callsites. A concurrent session-first runtime writer can therefore contend in the opposite session/operation order. This is a source-supported finding; no dedicated managed installation reproduction was run.

The path also mutates preview/terminal/schedule records under the separate managed control contract. It is not invoked by the owner-selected personal VPS promotion, which drains active work and stops the exact services before its matched backup and immutable switch. P024 does not change this file or claim the managed administrator path fixed. Managed installation, interruption, restore and protected backup acceptance remain explicitly unverified in the [deployment guide](../docs/developer/deployment.md).

A future selected correction must audit the complete managed control resource order, prelock affected parent/conversation rows before child writes without weakening authority or uncertainty, and run actual managed interruption/recovery contention acceptance. Do not infer that services have stopped, retry arbitrary effect transactions, or clear uncertain reservations. Retain this obligation until that scoped gate and independent reviews pass.
