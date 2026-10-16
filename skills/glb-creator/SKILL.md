---
name: glb-creator
description: Build textured, skinned GLB assets with Bun and glTF Transform, and inspect fast in-memory animation and turntable previews. Use for direct procedural 3D asset authoring and iteration.
---

# GLB creator

## Setup and scratch work

Run `bun run setup` from this skill's folder. It installs pinned packages into ignored `node_modules/`, with the installation cache under ignored `tmp/`. Bun is required; Blender is not required by this skill.

Keep `scripts/` for reusable tools. Write asset-specific recipes, temporary inputs, GLBs, logs and optional captures under `tmp/`. Move accepted deliverables to the user's chosen destination before cleanup. Reference images and textures are supplied inputs; image generation is outside this skill.

## Build toward the reference

Inspect the reference first. Identify silhouette, proportions, asymmetry, connected surfaces, material regions, and animation anticipation, impact and recovery. Set a visual target before comparing time or tokens. A textured blockout still needs anatomical and silhouette iteration.

From `tmp/your-asset.ts`, import `Asset` from `../scripts/geometry`. It supplies world-space triangle batches, bevelled plates, ellipsoids, curved tubes, joints, inverse bind matrices, and quaternion animation channels. Coordinates are **metres, Y up, +Z forward**, quaternions XYZW. Add parents before children and wind triangles outward. Each convenience shape is assigned to one joint; use explicit weights for blended deformation. Animation times must strictly increase.

`Asset.surfaces` maps material names to `{baseColor, normal?, roughness?, normalScale?, tint?, alphaCutoff?}` byte inputs. Albedo is sRGB; normal and packed metallic/roughness maps are linear, with roughness in G and metallic in B. Embed PNG/JPEG maps and author UVs. Keep smooth root tangents continuous and hard stone normals distinct. Inspect seams, caps and alpha cutouts. Normals approximated from albedo are not equivalent to authored height or scanned normals.

`await asset.bytes()` returns GLB bytes without writing a file. Use a fresh builder per revision. Export welds, deduplicates and prunes resources, and lifts below-ground bind geometry with its joints. `Asset.doc` exposes glTF Transform for richer materials, custom weights, morphs and hierarchy. For features beyond the helpers, use a glTF Transform `Document` directly and consult [its API](https://gltf-transform.dev/). Apply compression only when the target consumer supports its decoder, then revalidate appearance and motion.

## Preview in memory

```ts
// In tmp/your-asset.ts; buildAsset is your own recipe.
import { Preview } from '../scripts/preview';
const preview = await Preview.create();
try {
  await preview.load(await buildAsset());
  const frame = await preview.frame({
    time: 0.47, yaw: -0.38, size: 256, format: 'webp', analyze: true
  });
  // Forward frame.bytes directly to the host's image-display tool.
  // frame.stats and frame.timing are ordinary data.
} finally { await preview.dispose(); }
```

Reuse one renderer across revisions and poses. `load` decodes embedded maps from GLB bytes and caches sampled whole-clip bounds. `frame` samples absolute seconds; `framing:'pose'` fits a closer single pose. Inspect front/side/back, grounding, animation phases, joint connections and recovery. Statistics can detect blank frames; judge likeness by visually comparing the rendered image with the reference.

Default output is PNG bytes in memory. WebP reduces image transport size; JPEG and raw RGBA are also supported. `capture:'history/pose.png'` explicitly writes under `tmp/`; record dimensions for raw captures. Do not print base64 into model context: forward bytes inside tool orchestration to an image emitter. Save history selectively.

For persistent tool access, run `bun run preview -- tmp/your-asset.glb --serve` from the skill folder, or pass an absolute GLB path. Read `tmp/preview-server.json`. The loopback service serializes GPU work: POST `/asset` accepts GLB bytes, `/frame` accepts frame options and returns image bytes, and `/analyze` returns statistics and timings. `bun run frame -- 0.47` emits a 256px WebP transport envelope over stdout. Stop the exact receipt PID after use.

The native renderer supports embedded PBR maps, alpha masks, skins, shadows and the first animation clip. Multiple-clip selection is not implemented. Actual custom shader hooks fail explicitly. The adapter only removes Three's unchanged empty prototype hook to accommodate Bun's comment stripping. Platform/native binding compatibility must be tested after dependency changes.

## Validate, retain and clean

Run `bun run test` and `bun run check`. Import `validate` from `scripts/validate.ts` for Khronos diagnostics and texture, skin and clip inventories. Check evaluated deformation, return pose, framing and actual texture readers; validate target application import rules separately.

Setup, successful export and load automatically dispatch a detached, hidden background cleanup worker at most daily. It removes regular files older than **seven days** under `tmp/`, prunes stale empty directories, skips links and preserves live preview receipts. It does not wait in the render path. Retain wanted work outside `tmp/`; root dependencies survive. `GLB_CREATOR_TMP` can select a dedicated caller-owned scratch directory. Set it before importing the skill. `GLB_CREATOR_CLEANUP=off` disables dispatch for controlled measurements. `bun run clean` previews expiry; `--apply` deletes or `--background` dispatches now.

Report runtime, setup/development overhead, artifact bytes, visual quality and token cost separately. The [standalone demo](https://github.com/asilvas/skill-glb-creator-codex-demo) records one host's runtime advantage and renderer comparison. Source token counts are a proxy; general agent-token savings and matched-reference quality are not established.
