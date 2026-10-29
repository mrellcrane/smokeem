# Body model credits

The contestant body in `bodyMesh.js` is built from **Futuristic 3D Soldier** by rickomax,
released into the public domain under CC0 on OpenGameArt:
<https://opengameart.org/content/futuristic-3d-soldier> (posted 2020-10-26, License(s): CC0).
The download is `soldier_1.zip` (`model.FBX`, `diffuse.png`, `normal.png`); the build uses
`model.FBX` and `diffuse.png`.

`tools/build_body.mjs` converts it: it rescales the mesh to the game's capsule, weights it to
the game's skeleton, names color regions from the texture (so every body takes its own armor
and trim colors), curls the fingers into a grip and recomputes the normals. The wraparound visor
band, the light strips and the smoker canister with its ember ring are added by the tool and are
original to this game. Nothing is fetched at runtime.

To rebuild after changing the tool: unzip `soldier_1.zip` and run

```bash
node tools/build_body.mjs path/to/model.FBX path/to/diffuse.png
```
