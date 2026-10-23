---
name: glb-creator
description: Create textured, rigged, animated GLB assets with Bun, inspect every clip, optimize delivery with rendered quality feedback, and build local web reviews. Use for procedural 3D authoring, previews, variants and asset inspection.
---

# glb-creator 2.1

Read [DESIGN.md](DESIGN.md) for quality, complete-delivery time and token/cost priorities. Write a recipe, run `dev`, view the sheet, then revise. Run `bun run setup` in this folder if dependencies are missing. Blender and learned models are not runtime requirements.

Use the supplied reference to establish proportions, pose, material regions and focal details. A single view leaves hidden surfaces ambiguous; keep them coherent and disclose consequential inference. The packaged helpers are procedural tools, not a promised automatic replica pipeline. Inspect actual geometry, materials and requested animations before treating a master as finished.

## Build and inspect

```sh
bun run dev -- tmp/asset.ts
bun run dev -- tmp/asset.ts --out=/absolute/master.glb --sheet=sheet.webp
bun run dev -- /absolute/master.glb --no-sheet
```

Recipe paths and `--out` resolve from the skill folder. Sheets resolve within `GLB_CREATOR_TMP` (default skill `tmp/`). Set that variable to isolate a job; use `GLB_CREATOR_CLEANUP=off` to retain scratch evidence. Move final deliverables out of scratch before its seven-day expiry.

`dev` prints one JSON summary with validity, size, triangles, dimensions, joints, clips, sheet flags and component timings. **View the sheet image**; validity cannot judge appearance. Failed renders and blank tiles fail the command. `--no-sheet` is intentional validation-only work. Default sheets show three rest directions and30%/55%/85% of every clip, with one framing envelope. No clip is silently omitted. Use `Preview.setClip(name|index|false)` or `frame({clip,time})` for other key/contact/extreme times and true endpoints. Finite samples do not prove motion correctness.

## Recipe

Coordinates: metres, **Y up, +Z forward**. Geometry and joints use world bind space. Euler rotations are XYZ radians, quaternions XYZW. Shapes bind rigidly to their joint; overlap surfaces to keep articulation connected.

```ts
import {Asset, type V} from '../scripts/geometry'; // adjust to recipe location

export default async function build() {
  const a = new Asset();
  a.joint('root', [0,0,0]);
  a.joint('body', [0,1.2,0], 'root'); // parents first
  a.joint('arm', [.5,1.7,0], 'body');
  // {materials:{skin:{baseColor:'c.jpg',normal:'n.png',roughness:'r.png'}}}
  // Image paths resolve from manifest; original bytes are embedded unchanged.
  await a.loadSurfaces('/absolute/textures/materials.json');
  // Or aliases: await a.loadSurfaces(path, {skin:'bark',armor:'stone'});
  a.ell('skin', [0,1.2,0], [.5,.8,.4], 'body');
  a.curve('skin', [[.45,1.7,0],[.8,1.2,.1],[.9,.7,.2]], [.2,.12], 'arm');
  const clip = a.doc.createAnimation('attack');
  a.channel(clip, 'arm', [0,.3,.55,.85,1.2],
    [[0,0,0],[-.8,0,-.3],[1.1,0,.2],[.25,0,0],[0,0,0]]);
  return a; // dev exports a.bytes()
}
```

## API

`V` means `[number,number,number]`. Methods are on `Asset` unless indicated.

| Method | Behavior |
|---|---|
| `joint(name, at:V, parent?)` | Joint at world position; parents before children. First joint is skin root. |
| `ell(mat, center:V, radii:V, bone, seed=0, rock=false, rotation:V=[0,0,0], segments?)` | Warped ellipsoid; `rock` gives faceted surfaces. Rotation is around center. Optional `[longitude,latitude]` resolution, default `[18,12]` smooth / `[9,6]` rock. |
| `plate(mat, center:V, size:V, bone, seed=0, rotation:V=[0,0,0])` | Fractured bevelled slab; local +Z is exposed face. Size gives approximate half-extents. |
| `tube(mat, points:V[], radii:number[], bone, sides=7)` | Capped polyline tube. `[base,tip]` interpolates taper; one radius gives constant width. |
| `curve(mat, points:V[], radii:number[], bone, sides=7, segments=16)` | Centripetal Catmull-Rom tube through control points; same taper convention. 2–256 segments. |
| `add(mat, bone, positions:V[], faces:number[][], flat=false, uvs?)` | Outward triangle faces; optional `[u,v]` per vertex. Smooth geometry retains indices. |
| `loadSurfaces(manifestPath, aliases?)` | Async PBR loading; defaults to manifest names. Aliases map recipe name → manifest key. Returns asset. |
| `surfaces.set(mat, surface)` | `{baseColor:Uint8Array, normal?, roughness?, normalScale?, tint?:V, alphaCutoff?}`. Albedo sRGB, other maps linear; roughness G channel. Tint/alpha cutoff 0..1. |
| `channel(clip, bone, times:number[], eulers:V[])` | LINEAR quaternion rotation tracks; strictly increasing times and matching key counts. |
| `scale(f)` | Positive uniform resize of geometry, joints and bind poses at export. |
| `await bytes()` | Export once per fresh asset: weld, deduplicate, prune, ground minimum Y at zero. Exact rigid weights use normalized bytes; indices use bytes up to 256 joints, then ushort. |
| `doc` | glTF Transform Document for blended weights, morphs or advanced geometry. |

Fallback palette (exported as `palette`): basalt, edge, wood, grain, moss, ivory, eye (emissive), mouth; unknown names use gray. `import * as T from 'three'` is available. Preview initially plays the first animation; `setClip(name|index|false)` or `frame({clip,time})` selects another or the original rest state.

For cutout foliage, set a mask after loading: `a.surfaces.get('leaf')!.alphaCutoff=.4`. Opaque materials ignore image alpha.

Small smooth accents often need only `[10,6]` ellipsoid segments: `a.ell(mat,c,r,bone,seed,false,[0,0,0],[10,6])`. Keep higher resolution on large silhouette forms; inspect the sheet before accepting reduced detail.


## Delivery variants

Create and visually accept the master first, then run delivery. Preserve its original bytes. With no requested sizes, the final step chooses one smallest-found tested variant retaining at least90% of the rendered appearance proxy. Any number of fixed sizes or percentages instead choose the highest measured retention within each budget; percentages always refer to the original master.

```sh
bun run dev -- /absolute/master.glb --deliver --delivery-out=/absolute/new-delivery
bun run optimize -- /absolute/master.glb --out=/absolute/automatic
bun run variants -- /absolute/master.glb --out=/absolute/variants --targets=10MB,25MB,25%,50%
```

All production variants use bounded adaptive quality search. Invalid, blank or failed evaluations are excluded, and every attempted candidate remains in the receipt. The result is the best tested selection, not a proven global minimum. Explicit tight budgets can fall below90%; use `--min-retention=.9` for a hard floor and inspect unmet targets.

**The proxy is not perceived quality.** Compare the selected delivery against its preserved master in matched views, focal detail, relighting and every requested clip. Reject a default with more than10% judged perceived loss even if the proxy passes; retry conservatively in a fresh folder or use a verified lossless fallback. Deliver one accepted default alongside the master. Verify target-engine import/deformation separately. Read [delivery variants](references/delivery-variants.md) for API, controls, receipts and codec limits.

## Local web review

```sh
bun run review -- /absolute/master.glb /absolute/variant.glb --out=/absolute/review --serve
```

Open the printed loopback URL. The viewer supports every clip, play/pause, scrubbing, rest, loop/speed, wireframe, lighting, orbit, PNG capture and comparison. A manifest adds shared fixed perspective PNGs and unavailable historical entries. Clip selection never modifies the GLB. Meshopt and WebP are bundled without a CDN; other codecs may need a separately supported inspection derivative. Read [web review](references/web-review.md) for manifests and the browser API.

`bun run test` verifies library and feature behavior, including native preview tests. `bun run check` checks package/skill consistency. Use `bun run preview -- model.glb --serve` for optional loopback frame transport and stop its recorded PID afterward. Never print GLB or image base64 into agent context.
