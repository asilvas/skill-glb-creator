# Local asset review

```sh
bun run review -- /absolute/master.glb /absolute/delivery.glb --out=/absolute/review --serve
```

The command creates `review.html`, a bundled local viewer, metadata/hashes and copies of the provided assets. It binds only loopback and prints the URL/PID. Use Ctrl+C to stop. `--port=4182` selects a port; otherwise one is assigned. Without `--serve`, the bundle can be hosted on any local HTTP server. The file picker also opens a GLB without uploading it.

For fixed views, labels, notes and historical entries whose GLB is missing, use `--manifest=/absolute/review-spec.json`. Paths in a manifest resolve relative to that manifest:

```json
{
  "title": "Forest Warden delivery review",
  "description": "Master and delivery variants under the same inspection views.",
  "models": [{
    "id": "master", "label": "Original master", "glb": "master.glb",
    "views": [
      {"label":"Reference three-quarter", "path":"front.png"},
      {"label":"Opposite three-quarter", "path":"right.png"},
      {"label":"Rear three-quarter", "path":"rear.png"},
      {"label":"Opposite rear three-quarter", "path":"left.png"}
    ],
    "notes": ["Static material quality and complete-asset acceptance are separate."]
  }]
}
```

```ts
import {createReview,serveReview} from '@asilvas/glb-creator/review';
const result=await createReview({outDir:'/absolute/review',models:[
  {label:'Master',glb:'/absolute/master.glb',views:[/* four shared perspective PNGs */]}
]});
const server=serveReview(result.reviewDir);
```

The viewer reads all clips from the GLB; there is no first-clip-only restriction. Start from rest, choose a clip, inspect key/extreme/contact times, play at several speeds, and test each real endpoint. Use Fit pose when a moving pose exceeds the rest framing. Camera orbit, material lighting and wireframe are inspection modes, not generated animation or automated correctness scores. Clip selection and scrub state do not modify the source GLB.

Review copies can be large; keep them local. Regenerate the web bundle from its manifest when needed. Missing local GLBs are labeled unavailable while retained views and notes still render. Built-in browser decoding covers Meshopt and WebP. Draco/KTX2 inputs need a separately configured decoder or a supported inspection derivative; failure is shown explicitly.

The reusable browser class lives in `@asilvas/glb-creator/review-viewer`: `new AssetReviewViewer(host,{onStatus,onClips})`, `await viewer.load(url)`, `viewer.dispose()`. It initializes GPU work only when the caller constructs it. Bundling from source includes the decoder, Three.js and studio environment without a CDN.
