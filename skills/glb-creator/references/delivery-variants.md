# Quality-guided master delivery

Create and visually accept the highest-quality master before delivery. Every accepted master receives automatic optimization; scratch previews do not. Original master bytes stay unchanged and a byte-exact copy is retained. Existing outputs are never overwritten.

```sh
bun run dev -- /absolute/accepted.glb --deliver --delivery-out=/absolute/new-delivery
bun run optimize -- /absolute/master.glb --out=/absolute/auto
bun run variants -- /absolute/master.glb --out=/absolute/budgets --targets=10MB,25MB,25%,50%
```

The default strategy is `auto`. With **no targets**, exactly one delivery is selected: the smallest tested valid file with rendered retention at least0.90, meaning at most10% loss under this estimated appearance metric. If nothing smaller passes, retain the measured master. This is not a calibrated guarantee of90% human perceived quality, an absolute quality/10 score, or a proof of the theoretical smallest file.

With **explicit byte/percentage targets**, select the highest measured retention inside each budget, breaking equal-retention ties by smaller bytes. A tight budget can fall below0.90 and is visibly flagged `belowDefaultRetention`; add `--min-retention=.9` to require both budget and quality floor. If no tested candidate meets both, return `unmet`, with budget and quality acceptance recorded separately. `MB` is decimal and each percentage refers to the original input to this call, never a previously downsized sibling.

## Measured adaptive search

The bounded search probes lossless packing, quantization, geometry, texture resolution and color coding independently. It then interleaves all reduction axes with local, single-axis byte/quality crossing refinement and measured hybrid tests. Exploration uses passing Pareto anchors with quality margin, so a barely-passing texture reduction cannot consume the budget or hide a better geometry branch with larger textures. Every candidate starts from the original master. No fixed profile order supplies a perceptual rating, and no first feasible result ends the search. The best tested observation wins; finite sampling cannot prove a global optimum. Quality is not assumed monotonic.

`--max-evaluations=18` defaults to18 candidate trials (valid range4–128). This excludes the measured master baseline. More trials can improve the tested frontier but cost additional transforms/renders; inspect retained attempts before increasing the limit. `--image-format=webp|core` defaults to WebP. `core` keeps PNG data maps and uses JPEG only for opaque lossy color. Meshopt remains required; quantized candidates may also require `KHR_mesh_quantization`.

The native renderer caches a master-only framing envelope over every required sample. Candidates cannot refit their cameras to disguise geometric loss. Default views include four rest directions, their opposite-light counterparts, two true512px upper-center closeups, and every embedded clip's bounded key/phase samples plus a rear relit sample. Missing/changed clip inventory, negligible foreground, missing alpha background, invalid dimensions and non-finite observations fail closed. No clip is silently omitted to fit the frame budget.

For each frame, transparent background pixels are excluded. Retention is the minimum of silhouette IoU, foreground structural/color/edge appearance, the lower tail of object-patch similarity, and **independent luminance-edge and RGB-edge retention**. Final retention is the **worst required frame**, so color agreement or a good average cannot hide blur or a damaged view/pose. These hand-designed terms still need broader calibration. Generic upper-center closeups are not semantic face detection. Finite frames do not establish hidden-surface, mip, collision or target-engine correctness.

After selection, compare the actual delivery and unchanged master in identical views, closeups, opposite light and every clip. A default with more than10% judged perceived loss is rejected even if its proxy passes. Retry a stricter floor in a fresh output folder or use a verified lossless fallback; retain the rejected receipt. The agent delivers one accepted default, not every trial. Library/API completion records a finished bounded search, not independent perceptual acceptance. A90% render threshold is not a universal90% human-quality guarantee.

## API and retained evidence

```ts
import {generateVariants} from '@asilvas/glb-creator/variants';
const receipt = await generateVariants('/absolute/master.glb', {
  outDir: '/absolute/new-delivery',
  // Omit targets for one >=90%-retention default delivery.
  targets: ['10MB', '25%'],
  maxEvaluations: 18,
  // Optional hard floor for explicitly requested budgets:
  minRetention: .9,
  qualityOptions: {
    size: 384, maxAnimationSamples: 5, maxFrames: 512,
    captureDir: '/absolute/evaluation-pngs'
  }
});
```

`optimizeVariants` is also exported from `@asilvas/glb-creator/optimize`. `createQualityEvaluator` and the pure `compareQualityFrames` are exported from `@asilvas/glb-creator/quality-metric`. API callers may inject `evaluator: {evaluate(bytes), dispose?, protocol?}`; each observation must provide `{valid,retention}` with a finite0–1 value. A custom evaluator is responsible for its own calibration; its protocol remains visible in the receipt.

`variants.json` and `optimization.json` record the master/copy hashes, quality protocol, complete baseline/search timings, every candidate and reason, constraints, selected profile, retained skins/clips and explicit failures. Generated candidate GLBs remain under `candidates/`; `captureDir` optionally retains the actual evaluated PNGs and frozen camera protocol. 

`totalSeconds` includes baseline setup/rendering, all attempted transforms/renders/checks and output writes. `candidateSeconds` is only the selected attempt and excludes prior search/setup. These times are not complete source authoring or accepted-asset throughput. No source quality/10 rating is inherited onto a variant; retention is a separate metric relative to the master.

Structural checks retain skin joint sets, clip names/times/interpolation, morph counts and material factors/bindings. Explicit lossless candidates additionally preserve decoded accessor bytes and full-resolution texture pixels. Resized tangent normals are renormalized, while packed data maps use lossless channel encoding at their chosen resolution.

## Inspecting codecs

The bundled web viewer supports Meshopt and native WebP without a CDN. KTX2/BasisU and Draco are not used or claimed. Some DCC importers require a separate decoded inspection derivative:

```sh
bun run decode -- /absolute/delivery.glb --out=/absolute/inspection.glb
```

This leaves the actual compressed delivery unchanged. Its smaller byte denominator belongs to the delivered file, not the decoded inspection copy. Decoding cannot restore detail removed by a lossy transform.

Primary methods: [glTF Transform simplify](https://gltf-transform.dev/modules/functions/functions/simplify), [quantize](https://gltf-transform.dev/modules/functions/functions/quantize), [Meshopt compression](https://gltf-transform.dev/modules/extensions/classes/EXTMeshoptCompression), [meshoptimizer](https://github.com/zeux/meshoptimizer/tree/master/js). The image guard and adaptive selection are implementation choices, not guarantees from those libraries.

## Content-aware search and exact reuse

The search inspects source data before proposing reductions. Texture resolution is inactive when no source texture can shrink; color-image coding is inactive when there is no eligible opaque color image. Geometry remains independently searchable. A profile changing absent data is not a useful experiment. Each transformed byte stream is SHA256-keyed within one frozen evaluator; an exact repeated output reuses its measured observation and records that reuse. This cache never transfers observations between masters, cameras, lighting protocols or different bytes.

Quantized profiles can pack finite linear FLOAT vertex colors in [0,1] to normalized U16. Their maximum scalar rounding error is 1/131070; existing integer colors and explicitly lossless profiles preserve their original values. This is distinct from material-image color coding, and remains subject to full rendered acceptance. Already compressed inputs are decoded into a fresh writable accessor buffer before re-encoding; the input master is preserved byte-for-byte. Receipts expose activeAxes, renderedCandidates, reusedMeasurements, floatColorBits and per-candidate encoding details.

A single effective reduction axis with no requested byte budgets uses independent packing/reduction seeds, a remote probe and measured local quality-crossing refinement. It stops at bounded parameter resolution or the trial limit, rather than spending the entire budget on distant rejected reductions. This is a best-tested result; nonmonotonic quality and unseen better solutions remain possible. Multi-axis and explicit-budget searches retain their independent exploration and repair logic.
