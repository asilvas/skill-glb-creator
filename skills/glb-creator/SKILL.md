---
name: glb-creator
description: Create textured, rigged, animated 3D GLB assets procedurally with Bun — no Blender. One command builds, validates, and renders a labeled multi-view contact sheet for fast visual iteration. Use for 3D asset authoring, iteration, and inspection.
---

# glb-creator

Write a recipe, run `dev`, view the sheet, edit. The API below is sufficient for ordinary assets; inspect implementation only to diagnose a blocking error. Run `bun run setup` in this folder once if dependencies are missing.

## Build and inspect

```sh
bun run dev -- tmp/asset.ts
bun run dev -- tmp/asset.ts --size=512
bun run dev -- tmp/asset.ts --out=/absolute/model.glb --sheet=sheet.webp
bun run dev -- tmp/model.glb --no-sheet
```

Recipe paths and `--out` resolve from the skill folder. Sheets resolve within `GLB_CREATOR_TMP` (default skill `tmp/`). Set that variable to your output folder for isolated jobs; set `GLB_CREATOR_CLEANUP=off` to retain benchmark artifacts. PowerShell: `$env:GLB_CREATOR_TMP='C:/path/to/output'`.

`dev` writes the GLB and prints one JSON line: `ok`, paths, bytes, triangles, Khronos errors/warnings/issues, materials, texture/joint counts, clips, `rest` dimensions, sheet tile/blank flags, and build/validate/render milliseconds. **View the sheet image**; a validator cannot judge appearance. Failed renders or blank tiles fail `dev`. Use `--no-sheet` for intentional validation-only work. Never print image base64 or GLB bytes.

Default sheet: front/left/back at rest, then 30%/55%/85% of the first animation, with camera framing frozen across the clip. Override with `--views="0,0,front;0,1.57,left;.5,-.6,impact"` (time seconds, yaw radians, label).

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

Fallback palette (exported as `palette`): basalt, edge, wood, grain, moss, ivory, eye (emissive), mouth; unknown names use gray. `import * as T from 'three'` is available. Preview plays the first animation.

For cutout foliage, set a mask after loading: `a.surfaces.get('leaf')!.alphaCutoff=.4`. Opaque materials ignore image alpha.

Small smooth accents often need only `[10,6]` ellipsoid segments: `a.ell(mat,c,r,bone,seed,false,[0,0,0],[10,6])`. Keep higher resolution on large silhouette forms; inspect the sheet before accepting reduced detail.

## Visual decisions

Before detail, estimate reference ratios: shoulder span/body height, head/body height, arm reach, stance width, and depth/lean. Check `rest.height`, `rest.size`, `rest.minY`. Headgear contributes to height; `scale(f)` resizes the entire rig.

Build large masses, then directional medium forms. Rotate and overlap layered plates; use curved strands with varied thickness instead of disconnected round lumps. Keep face and focal details visible from the reference view. Match material regions before scattered accents. Vary seed, rotation, size and spacing purposefully.

For armored organic subjects, form the face from angled slabs framing inset eye sockets, rather than a dark ball with eyes on its surface. Let major plates break the silhouette; avoid an even necklace of similar boulders. Concentrate growth on ledges and crevices so the armor beneath remains readable.

Give moving masses separate joints. Animate anticipation → impact → recovery, use identical start/end rotations, and leave planted feet unrotated unless a step is requested. Inspect phase tiles for gaps, ground penetration and silhouette loss. Check target engine import rules separately from Khronos validity.

Edit recipes with file tools; shell quoting can corrupt `$` and backticks. Tint cannot exceed 1. Avoid geometry with no visible benefit.

## Extra tools

`bun run test` / `bun run check` verify the library. `bun run preview -- tmp/model.glb --serve` starts an optional loopback renderer; its printed receipt and `tmp/preview-server.json` give PID/URL. POST `/asset` GLB bytes, `/frame` `{time,yaw,size,format}`, `/sheet` `{views,tile}`, `/analyze` frame options. Requests serialize; stop the recorded PID afterward. Scratch files expire after seven days unless cleanup is disabled. Move final deliverables out of scratch.
