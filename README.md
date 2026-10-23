# glb-creator 2.1.0

Build textured, rigged, animated GLB assets with Bun and TypeScript. Preview every animation, compare assets in a local web review, and create delivery variants using measured quality feedback.

## Install and use

```sh
npx skills add https://github.com/asilvas/skill-glb-creator
# From the installed skill folder:
bun run setup
bun run dev -- tmp/asset.ts
```

Bun ≥ 1.4.4 is required. The native preview renderer has been exercised on Windows; verify it on other hosts. Blender, model weights, hosted services, and paid APIs are not runtime requirements. See [the skill](skills/glb-creator/SKILL.md) for the authoring API and a complete animated recipe.

## Delivery and review

Keep the highest-quality master unchanged. With no requested sizes, delivery selects exactly one smallest-found tested variant that retains at least 90% of the rendered appearance proxy. Any number of fixed sizes or percentages can instead request the best tested quality within each budget. Each candidate starts from the original master, and the search adapts geometry, texture and coding proposals using actual measurements.

```sh
bun run dev -- /absolute/master.glb --deliver --delivery-out=/absolute/new-delivery
bun run optimize -- /absolute/master.glb --out=/absolute/automatic
bun run variants -- /absolute/master.glb --out=/absolute/budgets --targets=10MB,25MB,25%,50%
bun run review -- /absolute/master.glb /absolute/automatic/variant-01-auto.glb --out=/absolute/review --serve
```

The loopback review page includes every embedded animation, rest pose, playback, scrubbing, speed, loop, wireframe, camera orbit, lighting, PNG capture and side-by-side comparison. A manifest can retain fixed perspective PNGs for assets whose local GLBs are missing. Meshopt and WebP decoding are bundled locally; no CDN is used.

The retention score is a proxy relative to the master, **not a human quality rating or a guarantee of 90% perceived quality**. Review the selected result against the preserved master, including focal detail, relighting and every requested clip. Reject visible loss beyond the requested tolerance even when the proxy passes. A bounded search finds the best tested candidates, not a proven global optimum. Explicit tight budgets can fall below the default floor; use `--min-retention=.9` to require both size and retention. Unmet targets and failed trials remain in the receipt.

Read [delivery controls and limits](skills/glb-creator/references/delivery-variants.md) and [web review manifests/API](skills/glb-creator/references/web-review.md).

## Commands and API

| Command | Purpose |
|---|---|
| `bun run dev -- <recipe.ts|asset.glb>` | Build, validate, measure and render rest plus all-clip sheets |
| `bun run dev -- <asset.glb> --no-sheet` | Intentional validation-only inspection |
| `bun run dev -- <asset.glb> --deliver` | Preserve master and run adaptive delivery search |
| `bun run variants` / `bun run optimize` | Budgeted variants or one automatic default |
| `bun run review` | Build and optionally serve a portable local review |
| `bun run decode` | Create a separate codec-decoded inspection derivative |
| `bun run preview` / `bun run frame` | Native preview and loopback frame transport |
| `bun run test` / `bun run check` | Library/feature tests and package/skill checks |
| `bun run clean` | Inspect or apply scratch cleanup |

Import `@asilvas/glb-creator` or its `/geometry`, `/preview`, `/validate`, `/variants`, `/optimize`, `/review`, `/review-viewer`, `/decode` and `/quality-metric` entry points. The browser viewer is a separate entry point so importing the authoring API does not create a WebGL context. Existing geometry helpers and rigid-joint authoring are preserved. Complex deformation and target-engine acceptance need their own validation.

Recipe paths resolve from the installed skill folder. `GLB_CREATOR_TMP` isolates scratch output; `GLB_CREATOR_CLEANUP=off` retains it. Move final deliverables out of scratch before its seven-day expiry. Original supplied PBR image bytes remain embedded by authoring; delivery transforms run only on separate copies.

## Historical v0.2 evidence

The following benchmark and media describe the earlier v0.2 release. They are retained unchanged as historical evidence and do not measure 2.1.0, the adaptive optimizer, or new quality/productivity/cost improvements.

<details>
<summary>Historical authoring comparison and same-recipe replay</summary>

![The reference and representative results from Blender CLI, glb-creator v0.1, and glb-creator v0.2](media/comparison.png)

**v0.2 builds the same recipe 1.51× faster and exports a 4.51% smaller GLB, with identical decoded triangle attributes and pixel-identical renders at all five tested animation times.** In the separate four-agent authoring experiment, v0.2 used 14.6% fewer total tokens and produced 26.8% smaller files than v0.1. Visual quality remained close; an improvement is not established.

![Three exported attack animations with identical preview settings and timing](media/attack-comparison.webp)

*Representative selection: the asset nearest each pipeline's mean quality score, with ties broken by run name. All twelve results are available in the [complete gallery](media/all-runs.png). Individual clips: [Blender CLI](media/blender-attack.webp), [glb-creator v0.1](media/v0.1-attack.webp), [glb-creator v0.2](media/v0.2-attack.webp).*

## Install

```sh
npx skills add https://github.com/asilvas/skill-glb-creator
```

Then, from the installed skill folder:

```sh
bun run setup
```

[Bun](https://bun.com/) ≥ 1.4.4 is required. Tested on Windows; the native renderer needs verification on other hosts.

## Controlled authoring comparison

Each pipeline received the identical prompt, reference, and prepared PBR texture bytes. **Four independent agents ran concurrently in every pipeline**, for twelve deliverables. All twelve used the same configured Codex model and reasoning effort (`gpt-6.1-sol`, `xhigh`); the v0.1 label credits the skill's author, not a different model in this experiment.

| Measure | Blender CLI | glb-creator v0.1 | glb-creator v0.2 |
|---|---:|---:|---:|
| Four-asset batch elapsed | 16.95 min | 10.57 min | **9.35 min** |
| Mean elapsed per worker | 14.28 min | **8.19 min** | 8.39 min |
| Mean total tokens¹ | 2,214,767 | 957,793 | **818,054** |
| Mean output tokens | 45,307 | **27,946** | 30,509 |
| Mean GLB size² | 23.69 MB | 21.97 MB | **16.08 MB** |
| Mean reference quality³ | 6.83 / 10 | 6.96 / 10 | 6.86 / 10 |
| Delivered / Khronos-valid | 4 / 3 | 4 / 4 | 4 / 4 |

¹ Input + output. Cached input is already included in input; reasoning is already included in output. These counts are not dollar costs. ² Decimal MB, with original PBR bytes embedded. ³ Three independent, arm-blinded AI rubric reviews; ratings are subjective.

### Time under load

![Batch elapsed time for Blender CLI, glb-creator v0.1, and glb-creator v0.2](media/time.svg)

v0.2 completed the four-asset batch **11.5% sooner than v0.1**. Its mean individual worker took **2.5% longer**. Batch completion depends on the slowest worker; this small experiment does not establish a general per-task speedup.

### Token use

![Mean agent token counts for the three pipelines](media/tokens.svg)

v0.2 used **14.6% fewer total tokens than v0.1**, while output tokens increased **9.2%**. Most input was cached. Dollar savings depend on the applicable input, cached-input, and output prices; parent development and review costs were excluded and unmetered.

### File size

![Mean exported GLB sizes for the three pipelines](media/bytes.svg)

The v0.2 authoring runs produced **26.8% smaller mean files than v0.1**, with different geometry generated by each worker. The same-recipe replay isolates a **4.51%** size reduction from the library itself.

### Reference fidelity

![Subjective reference fidelity scores, with a dot for each asset's mean rating](media/quality.svg)

Mean scores were **6.83, 6.96, and 6.86 / 10**. v0.2's score was 0.10 below v0.1. The rubric allocates 3 points to silhouette/proportions, 3 to material/shape integration, 2 to focal details, and 2 to animation/grounding. Inspect the [all-run gallery](media/all-runs.png) alongside the scores; human review takes precedence.

### Same-recipe replay

Seven alternating fresh-process builds per skill used the same recipe, images, geometry, and animation. Median build/export/write time fell from **162.8 ms to 108.0 ms (1.51× faster)**. File size fell from **8,624,064 to 8,235,352 bytes (4.51% smaller)**. Decoded triangle attributes had a maximum difference of zero. Renders at 0, 0.36, 0.66, 1.02, and 1.2 seconds were pixel-identical at 384 px. This compares v0.1 and v0.2; it is separate from agent authoring time.

<details>
<summary>Evidence, method, and limitations</summary>

- The [media evidence bundle](media/benchmark.json) contains all twelve run summaries, token categories, timing, size, validity, quality, representative selection, replay trials, and SHA-256 hashes of the source evidence, promoted skill files, and media. The full protocol, raw telemetry, recipes, GLBs, contact sheets, and individual reviews live in the [Codex demo repository](https://github.com/asilvas/skill-glb-creator-codex-demo), under `results/experiment/` and `runs/`.
- Input hashing verified the same task, reference, and all 26 supplied texture/manifest files across the twelve runs. Each pipeline's four workers overlapped. Dependencies were preinstalled, and each worker had the same four-attempt build/render budget. Failed validation remains in the denominator: Blender's second asset had 81 tangent errors.
- Every final GLB was imported into the same evaluation renderer with the same lighting, camera algorithm, resolution, and animation times. Reviewers saw anonymous IDs and did not receive pipeline identities or performance results.
- Authoring previews differed. All four Blender workers chose CPU Cycles with 24–64 samples and four threads; the skill used its native raster renderer. Timing includes API latency and these choices, so this is not a fastest-possible Blender runtime comparison.
- Measured on one Windows host with a Ryzen 9 9950X3D and Bun 1.4.4, October 2026. One creature task, four runs per pipeline, fixed pipeline order, possible host load, model variance, caching, and correlated AI reviewer preferences limit generalization. No confidence claim or dollar-cost percentage is inferred.
- The [earlier Claude demo](https://github.com/asilvas/skill-glb-creator-claude-demo) established v0.1. Its historical model, harness, timings, and scores differ; those numbers are not mixed into these graphs. The previous development-stage skill names are consolidated here as v0.1.

</details>


</details>

[MIT license](LICENSE). Dependencies retain their own licenses and notices.
