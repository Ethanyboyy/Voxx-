# Suit model assets

Drop a real `.glb`/`.gltf` file here (e.g. `mk-vii.glb`) to have a suit render
from an actual scanned/authored 3D asset instead of the procedural
`SuitRig` visualization.

To use one: set `LabSuit.modelUrl` to `/models/suits/<file>.glb` (via the
suit edit form or directly). `HolographicModel` checks for this field —
when present it loads the file with drei's `useGLTF`; when absent (the
default for every suit today, since no real asset exists yet) it falls back
to the procedural render and is labeled as a concept visualization.

No file in this directory is fabricated or assumed to exist — this
directory is empty by default and stays that way until a real asset is
placed here.
