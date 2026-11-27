# TODO

Known minor issues and follow-ups. None of these block using the app.

## Needs testing on real devices
- [ ] Run on a physical iPhone 13 (touch controls, camera + motion permissions, Add to Home Screen, offline start).
- [ ] Run on a Meta Quest 3 (Enter VR, stick movement, snap turn, action panel selection, frame rate).
- [ ] Try the video scan on real phone footage in several rooms and tune the floor-line detection thresholds.
- [ ] Run the GitLab pipeline once on GitLab (config is written but has never executed there).

## Scanning
- [ ] Furniture seen through an open doorway is added to the room being scanned (e.g. the kitchen table showed up in the living-room scan).
- [ ] Recognition picks the nearest category only — a boxy sofa was labelled "chair" in the test clip.
- [ ] Video scan always produces a rectangle; L-shaped rooms have to be reshaped in the editor.
- [ ] Camera height and tilt are typed in rather than measured; read tilt from the motion sensors when recording in-app.
- [ ] Live corner scan: compass heading gets jumpy when the phone is held almost vertical.

## Editor
- [ ] Room name and size labels overlap in small rooms.
- [ ] No undo / redo.
- [ ] Rooms do not snap to each other's walls while dragging (only to the 10 cm grid).

## 3D and game
- [ ] Room, flood and alarm lights have no shadows, so they leak through walls; the alarm strobe tints rooms very red.
- [ ] Roof is a flat slab per room; no pitched roof option.
- [ ] Trees and garden paths are decorative only (no collision).
- [ ] The intruder can spot the player through closed windows from outside at night more easily than is realistic.
- [ ] Action panel can get tall on small landscape screens when many options are available.
- [ ] No pause button during a drill.

## Project
- [ ] Add a GitHub Actions workflow (tests + build) so pull requests get a test check, not just the Vercel build.
- [ ] `npm audit` reports advisories in dev dependencies; review and update.
