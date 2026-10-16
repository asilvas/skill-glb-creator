# glb-creator

A Bun-powered agent skill for building textured, animated GLBs directly with glTF Transform and inspecting them through fast, memory-first previews.

## Install

```sh
npx skills add https://github.com/asilvas/skill-glb-creator
```

Ask your agent to use `glb-creator`, then run `bun run setup` in the installed skill folder. [Bun](https://bun.com/) is required. The tested runtime is 1.4.4-canary.1 on Windows; native renderer compatibility on other hosts needs verification. Asset authoring and previews do not require Blender or an image-generation service.

## Why use it?

- Build and export GLB bytes directly, including UVs, embedded PBR maps, joints and a skinned animation.
- Reuse a renderer and inspect absolute animation times and turntable angles without launching a DCC process for each revision.
- Pass PNG, WebP, JPEG or raw RGBA bytes directly to an image-capable agent tool. Screenshots on disk are optional.
- Keep per-asset code and temporary files out of the reusable tools. Background cleanup expires scratch files after seven days.

In the [Codex monster experiment](https://github.com/asilvas/skill-glb-creator-codex-demo), median build/export plus five memory previews took **3.29 seconds with Bun versus 13.48 seconds with Blender CLI: 4.10× faster runtime iteration**. Warm frames were 123.26 ms versus 317.59 ms. Both assets had 80,694 triangles, 12 embedded maps, nine joints and one 1.2-second attack, with zero Khronos errors or warnings.

These are recorded results from three alternating trials on a Windows/Ryzen 9 9950X3D host with RTX 5090 adapters. The pipelines use different renderers/exporters; the chosen GPU and unrelated workload were not independently controlled. **Lower total agent-token cost and reference-quality parity remain unproven.** The demo preserves the method, assets, source-token proxies and limitations. No monster assets or benchmark code are included in this skill repository.

## Use

The agent instructions are in [skills/glb-creator/SKILL.md](skills/glb-creator/SKILL.md). From that folder:

```sh
bun run setup
# Write your asset recipe under tmp/ and export GLB bytes or tmp/asset.glb.
bun run preview -- tmp/asset.glb --serve
bun run frame -- 0.47
bun run test
bun run check
```

The preview service returns image bytes and statistics over loopback. Keep it alive across revisions and stop its recorded PID when finished. Supply reference images/textures separately; image generation is outside this skill.

`scripts/` contains reusable tools only. `tmp/` and `node_modules/` are ignored. A hidden detached worker runs at most daily after setup, export or load and removes regular scratch files older than seven days. Preserve deliverables outside scratch. `GLB_CREATOR_TMP` selects another dedicated scratch directory; `GLB_CREATOR_CLEANUP=off` disables dispatch for measurements. `bun run clean` previews cleanup, with `--apply` or `--background` for explicit execution.

For Bun programs, this repository also exposes `@asilvas/glb-creator`, with `/geometry`, `/preview` and `/validate` exports. Root package commands run the same skill checks. The installable skill includes its own pinned manifest/lockfile so it works when copied independently by a skill installer.

Limitations: the convenience geometry uses one joint per shape; custom weights require direct glTF authoring. Preview currently selects the first clip. Custom shaders are rejected by the native renderer. Check the actual application's import rules and inspect motion and materials before accepting an asset.

[MIT license](LICENSE).
