---
name: glb-creator
description: Create textured, rigged, animated 3D GLB assets procedurally with Bun — no Blender. One command builds, validates, and renders a labeled multi-view contact sheet for fast visual iteration. Use for 3D asset authoring, iteration, and inspection.
---

# glb-creator

Author GLB assets in TypeScript and see every revision in one image. The whole loop is two tool calls per revision: edit the recipe, run `dev`, read the sheet. **This file contains the complete API — do not read the `scripts/` sources.**

## Setup (once)

```sh
bun run setup   # from this skill folder; installs pinned deps (skip if node_modules/ exists)
```

## The iteration loop

1. Write/edit a recipe at `tmp/<asset>.ts` (skeleton below).
2. `bun run dev -- tmp/<asset>.ts` — builds, validates (Khronos), writes `tmp/<asset>.glb` and a contact sheet `tmp/<asset>-sheet.webp`, prints one JSON summary line.
3. **View the sheet with your image file reader** (e.g. Read tool). Judge it against the reference, fix the recipe, repeat.

Never print GLB bytes or image base64 into your context. The JSON summary plus the sheet image is everything you need.

## Recipe skeleton (complete and working)

```ts
// tmp/creature.ts
import { Asset, type V } from '../scripts/geometry';

export default async function build() {
  const a = new Asset();

  // Skeleton: add parents before children. First joint is the root.
  a.joint('Root', [0, 0, 0]);
  a.joint('Chest', [0, 1.4, 0], 'Root');
  a.joint('Head', [0, 2.2, .1], 'Chest');
  a.joint('ArmL', [-.7, 2.0, 0], 'Chest');

  // Optional PBR textures per material name (otherwise palette/gray fallback).
  a.surfaces.set('skin', {
    baseColor: new Uint8Array(await Bun.file('path/to/albedo.jpg').arrayBuffer()),
    normal: new Uint8Array(await Bun.file('path/to/normal.png').arrayBuffer()),      // optional
    roughness: new Uint8Array(await Bun.file('path/to/roughness.png').arrayBuffer()),// optional, G channel
    normalScale: .7,            // optional
    // tint: [1,.9,.8],         // optional albedo multiplier
    // alphaCutoff: .4,         // optional alpha-mask cutout
  });

  // Geometry: each call binds fully to one bone.
  a.ell('skin', [0, 1.4, 0], [.55, .8, .45], 'Chest');          // torso ellipsoid
  a.ell('skin', [0, 2.3, .1], [.3, .35, .3], 'Head');           // head
  a.tube('skin', [[-.7, 2, 0], [-1, 1.4, .1], [-1.1, .9, .2]], [.18, .14, .1], 'ArmL'); // arm
  a.plate('armor', [0, 1.6, .5], [.45, .5, .14], 'Chest', 1, [.1, 0, 0]);               // chest plate

  // Animation: rotation keys per bone; times strictly increase; end at rest for loops.
  const clip = a.doc.createAnimation('attack');
  a.channel(clip, 'ArmL', [0, .3, .5, .8, 1.1], [[0,0,0], [-.9,0,0], [1.1,0,.2], [.3,0,0], [0,0,0]]);
  a.channel(clip, 'Chest', [0, .3, .5, 1.1], [[0,0,0], [0,-.2,0], [0,.25,0], [0,0,0]]);

  return a; // dev runs a.bytes() and writes the GLB for you
}
```

## API reference (all of it)

Conventions: **metres, Y up, +Z forward** (the model faces +Z), Euler/quaternion XYZW, `V = [x,y,z]`.

| Call | What it makes |
|---|---|
| `a.joint(name, at:V, parent?)` | Skeleton joint at world position. Parents first; first joint is the skeleton root. |
| `a.ell(mat, center:V, radii:V, bone, seed=0, rock=false)` | Ellipsoid. `rock=true` → low-poly faceted boulder with surface warp. |
| `a.tube(mat, points:V[], radii:number[], bone, sides=7)` | Capped tube along a polyline (limbs, horns, roots, claws). Fewer radii than points interpolates along the path — `[base, tip]` is enough for a taper. For smooth curves, sample a `THREE.CatmullRomCurve3` into ~12–26 points. |
| `a.plate(mat, center:V, size:V, bone, seed=0, rotation:V=[0,0,0])` | Bevelled, fractured stone slab; local +Z is the exposed face. Vary `seed` per plate. |
| `a.add(mat, bone, positions:V[], faces:number[][], flat=false, uvs?)` | Raw triangles, outward winding, for anything else. |
| `a.channel(clip, bone, times:number[], eulers:V[])` | LINEAR rotation keys (radians, XYZ euler). Times strictly increase. |
| `a.surfaces.set(mat, surface)` | PBR maps for a material name — see skeleton above. Albedo is sRGB; normal/roughness linear; roughness lives in the **G** channel. `tint` and `alphaCutoff` must be within **0..1** (glTF range). |
| `a.scale(f)` | Uniformly resize the whole asset (geometry + skeleton) at export — the easy fix when the summary `rest.height` is off target. |
| `a.doc` | The glTF Transform `Document` — use for morphs, custom skin weights, extra material channels. |
| `await a.bytes()` | Welds, dedups, prunes, **grounds the model at Y=0**, returns GLB bytes. Use a fresh `Asset` per build. |
| `palette` | Built-in fallback colors by material name: basalt, edge, wood, grain, moss, ivory, eye (emissive), mouth. Unknown names render gray. |

Limits: each convenience shape is rigidly bound to one bone (blended weights need `a.doc` directly). Preview plays the first animation clip only. `import * as T from 'three'` is available for curves and math.

## dev command

```sh
bun run dev -- tmp/creature.ts                         # defaults
bun run dev -- tmp/creature.ts --size=512              # bigger tiles
bun run dev -- tmp/creature.ts --views="0,0,front;0,1.57,left;.45,-.6,impact"
bun run dev -- tmp/creature.glb --no-sheet             # validate an existing GLB only
```

- Default sheet: front/left/back at rest + three animation-phase tiles (3×2 grid). `--views` is `time,yaw[,label]` semicolon-separated; yaw 0 = front, π/2 = left, π = back.
- Summary JSON: `ok`, `glb`, `bytes`, `triangles`, Khronos `errors`/`warnings` (+ first `issues`), `materials`, `textures`, `joints`, `clips`, `rest` (`height`, `size` [x,y,z], `minY`, `heightWithClip`), `sheet.tiles` (with `blank` flags), `ms`.
- Use `rest.height`/`rest.size` to check dimensions numerically — no measuring scripts needed. `minY` should be 0 (export grounds the model).
- Exit code 1 and `ok:false` means fix the recipe or validation errors before continuing.

## Quality checklist (judge the sheet against your reference)

- **Silhouette and proportions first** — textures never rescue a weak blockout. Before the first build, note 4-6 proportion landmarks from the reference (shoulder width vs height, head size, arm reach, stance width, posture lean) and build to those numbers; it usually saves a whole revision.
- **Grounding and connection** — feet planted at Y=0, limbs visually connected to the body, no floating shells; overlap shapes generously, intersections are cheap.
- **Material regions** — distinct zones (e.g. armor vs hide vs claws) with distinct textures/colors read far better than one noisy material.
- **Animation** — anticipation → impact → recovery; keep start == end pose; check the phase tiles show real deformation (no `blank: true` tiles).
- **Scale of detail** — many medium shapes with varied seeds/rotations beat a few giant primitives; asymmetry sells organic forms.
- Keep Khronos errors at 0; verify the target engine's import rules separately.

## Pitfalls (each of these has cost an agent a build cycle)

- `tint` components above 1 fail validation — glTF clamps baseColorFactor to 0..1. The supplied albedo maps often render darker than painted concept art; that is expected, don't fight it with tint.
- Write recipes with your file-editing tool, not shell heredocs (quoting eats `$` and backticks).
- Horns/antlers count toward `rest.height`. If the summary shows you are over target, call `a.scale(f)` instead of scaling joints by hand (joint-level scale won't change the reported bounds).
- Iterate with `Edit` on the recipe rather than rewriting the file — full rewrites are where typos sneak in.
- Overlap shapes generously; intersections are free. Gaps at animated joints are what look broken.

## Persistent server (optional, for many fast frames)

```sh
bun run preview -- tmp/creature.glb --serve   # prints {pid, url}; also written to tmp/preview-server.json
```

POST `/asset` (GLB bytes), POST `/frame` `{time,yaw,size,format}` → image bytes, POST `/sheet` `{views,tile}` → sheet image, `/analyze` → stats. One renderer serves requests serially. Kill the recorded PID when done. Prefer plain `bun run dev` unless you need many frames per second.

## Housekeeping

`bun run test` and `bun run check` verify the library. Scratch files under `tmp/` are auto-cleaned after 7 days; move deliverables elsewhere. `GLB_CREATOR_TMP` relocates scratch; `GLB_CREATOR_CLEANUP=off` disables cleanup dispatch (useful during measurements).
