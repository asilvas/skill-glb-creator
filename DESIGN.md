# glb-creator 2.1 design

## Product scope

Provide a self-contained Bun/TypeScript workflow for procedural GLB authoring, native preview, animation inspection, adaptive delivery variants and local web review. A supplied reference guides the agent's modeling decisions. The package does not claim automatic image reconstruction, a learned backend, universal rigging, or a demonstrated high-fidelity replica capability.

Preserve the existing geometry and joint helpers. Keep optional research in the separate demo repository. Blender, model downloads and hosted APIs are not runtime dependencies. New dependencies must have a concrete production role and retain applicable notices.

## Goals

1. Maximize quality: preserve reference silhouette, proportions, materials, focal detail and requested motion. Human visual acceptance and target-engine requirements remain the authority. Byte savings are useful at an accepted quality level.
2. Maximize productivity: minimize complete time to deliver N accepted assets, including setup, failed attempts, review and validation. Report cold setup separately. Claims about parallel authoring need identical inputs and four overlapping workers per arm.
3. Minimize cost: reduce complete agent-token use and measured runtime work. Distinguish cached/input/output tokens and measured costs; do not infer dollar savings from token totals alone.

Do not hide a quality regression inside a combined score. Historical Blender CLI, glb-creator v0.1 (Claude) and glb-creator v0.2 benchmark results remain historical; they do not establish 2.1.0 performance.

## Delivery contract

Keep an immutable highest-quality master. Each candidate is independently derived from those original bytes. With no requested breakpoints, produce one smallest-found tested output with at least90% rendered proxy retention, subject to subsequent visual acceptance. With any number of decimal-byte or original-master-percentage breakpoints, maximize tested quality within each budget. An explicitly supplied retention floor is an additional constraint. Record unmet budgets, invalid/blank render trials and the complete bounded search time; do not silently claim an optimum.

Search measured geometry, texture, coding and hybrid treatments adaptively. Do not route production variants through fixed first-fit downsizing profiles. Preserve skin/clip/morph/material semantics; verified lossless candidates additionally retain decoded accessor words and texture pixels. Meshopt/WebP require compatible loaders; codec decoding makes a separate inspection derivative and cannot restore discarded detail.

The image proxy is not perceived quality, an absolute quality/10 rating, or a reference-fidelity guarantee. Master-derived cameras, opposite lighting, focal crops and samples from every clip reduce blind spots but cannot prove continuous motion, hidden surfaces, collisions or engine behavior. The agent must inspect the selected delivery against its master and reject unacceptable visible loss.

## Inspection and evidence

Preview rest and every embedded clip. Absolute frame sampling includes true non-loop endpoints; web playback separately offers loop controls. The review page supports arbitrary clip inventories and retained fixed PNGs when local GLBs are missing. Orbiting a camera is an inspection mode, not skeletal animation.

Retain hashes, candidate settings, measurements, failures and timings sufficient to explain selection. Full asset-authoring time, priced cost and production acceptance must remain unknown unless measured. Tests and smoke assets validate implementation behavior; they are not evidence of improved art quality or accepted-asset throughput.
