# Body model credits

The contestant body in `bodyMesh.js` is built from **Futuristic 3D Soldier** by rickomax,
released into the public domain under CC0 on OpenGameArt:
<https://opengameart.org/content/futuristic-3d-soldier> (posted 2020-10-26, "Futuristic 3D
Soldier for a canceled project"). Checked 2026-10-29: the page still lists License(s): CC0.
One comment there (2022-07-17) asks whether the model is really public domain; the owner chose
to use the model anyway (2026-10-29).

- Download: the page's file link, shown as `soldier.zip` (574.6 KB), is
  <https://opengameart.org/sites/default/files/soldier_1.zip>.
- SHA-256 of that zip (574,605 bytes):
  `7e79569e9361ab21d82b3e8744a56ba16014c7ffed857df54ee05f5ef5679541`
- It holds `model.FBX`, `diffuse.png` and `normal.png`, with no license file. The build uses
  `model.FBX` and `diffuse.png`. The zip is not in this repo.

`tools/build_body.mjs` converts it: it rescales the mesh to the game's capsule, weights it to
the game's skeleton, names color regions from the texture (so every body takes its own armor
and trim colors), curls the fingers into a grip, thickens the upper arms, shows the undersuit at
the backs of the knees and thighs, recomputes the normals and bakes a shade per vertex
(occlusion, darker plate edges). The model's helmet is left out. The helmet (after Halo's Mark
VI, with its big gold visor and ear discs), the neck seal, the light strips and the smoker
canister with its ember ring are built by the tool and are original to this game. Nothing is
fetched at runtime.

The body can only be changed through the tool (`bodyMesh.js` is generated). To rebuild: unzip
`soldier_1.zip` and run

```bash
node tools/build_body.mjs path/to/model.FBX path/to/diffuse.png
```

The output is the same on every run. Add `--debug out.json` to also dump the mesh (positions,
triangles, regions, weights, normals, shade) for inspection.
