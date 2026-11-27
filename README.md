# Home Defence Sim

Film your home, turn it into a 2D floor plan, then rehearse how you would handle a break-in — in 3D, on a phone, a desktop or a VR headset.

It is an installable web app (PWA): open it in the browser and add it to the home screen. Everything runs on the device; video is never uploaded.

![Feature tour](docs/demo.mp4)

## What it does

| Step | Feature |
| --- | --- |
| **Scan** | **From video** – film one slow turn on the spot in each room. The app tracks how the walls slide past to measure rotation, finds the floor–wall line to measure distance, and fits the room outline. A small on-device model recognises furniture by rough category (couch, chair, table, bed, TV, fridge, toilet, plant…) and places it in the room. |
| | **Live corner scan** – aim the crosshair at each floor corner and tap. Uses the phone's compass and tilt sensors, so it is the more accurate option on a phone. |
| **Plan** | 2D editor: drag rooms together, resize by dragging corners, draw rooms, tap walls to add doors and windows, place furniture, hiding spots and valuables. Share a plan as a link or a JSON file (scan on the phone, play on the headset). |
| **Walk** | Daylight 3D walk-through of the plan, plus an orbiting 3D map. |
| **Drill** | Night-time home-invasion simulation in your own floor plan. Pick the intruder (opportunist, determined burglar, aggressive; 1–3 of them), spend a budget on 14 home defences, then respond in real time. |

### Ways to handle the invasion

Before it starts: deadbolts, window locks, alarm, alarm monitoring, cameras, motion floodlights, a dog, smart locks, a safe room, panic button, pepper spray, barricade bar, bolted safe, neighbourhood watch.

During it: call the police · lock, close or barricade doors · hide under beds or in wardrobes · sneak · torch · room lights · cut or restore power at the breaker · shout a warning · throw a distraction · panic siren · car alarm · smart-lock the whole house · pepper spray · climb out of a window and run.

The intruder path-finds through the weakest entry point, kicks in doors, hunts for valuables, reacts to noise and light, loses nerve under pressure and can chase you. Each run ends in one of six outcomes (deterred, driven off, arrested, escaped, burgled, caught) with a grade and a debrief.

> A planning and training game, not professional security advice. In a real emergency get to safety and call your local emergency number.

## Devices

- **iPhone 13 / phones** – touch controls (left thumb moves, drag to look), safe-area aware layout, portrait and landscape. Install with Share → *Add to Home Screen*.
- **Meta Quest 3** – open the site in the Quest browser and press **Enter VR**. Left stick moves, right stick snap-turns, point at the floating panel and pull the trigger to choose an option. The live camera scan needs phone sensors, so scan on a phone and open the share link on the headset.
- **Desktop** – WASD + mouse drag, number keys for options, `V` for the 3D map.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (plan geometry, scan maths, path-finding, simulation)
npm run build      # production build in dist/
npm run preview    # serve the build
```

Requires Node 20+. Camera and motion sensors need HTTPS (or `localhost`).

```
src/plan/     floor-plan model + 2D editor
src/scan/     video analysis, furniture recognition, live corner scan
src/game/     simulation (sim.js, nav.js – no rendering, unit-tested) and the three.js world, HUD, audio, WebXR
public/       PWA manifest, service worker, icons, bundled object-detection model, demo clip
scripts/      icon generator, demo-video recorder
```

## Deploy

**Vercel** – `vercel.json` is included (Vite preset, `dist/` output, cache and permission headers). With the repository connected to Vercel, every push deploys automatically.

**GitLab CI** – `.gitlab-ci.yml` runs `test → build → deploy`. The deploy jobs use the Vercel CLI and only run when these CI/CD variables are set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Branches get preview deployments; the default branch deploys to production. Leave the variables unset if Vercel's own Git integration already deploys the project.

## Known limits

- The video scan assumes a steady turn on the spot with the phone held at the stated height and tilt. Plain white rooms, clutter along the walls, mirrors and low light reduce accuracy. Rooms come out as rectangles — reshape L-shaped rooms in the editor.
- Furniture recognition gives the category and an approximate position only.
- The object-detection model adds about 18 MB, downloaded the first time a video is scanned.
