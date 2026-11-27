# Inherent risks

Risks that come with what this app is and does. These are not bugs to fix (those are in [TODO.md](TODO.md)); they are things anyone using, sharing or deploying the app should know. Each one lists what the app already does about it and what is left to the user.

## 1. Safety and false confidence

| Risk | What the app does | What remains |
| --- | --- | --- |
| **A game is not training.** Doing well in a drill can make someone feel prepared for a real break-in when they are not. Real intruders do not follow the simulation's rules. | States on the home, setup and debrief screens that it is a training game, not security advice. Scoring rewards avoiding confrontation, escaping and calling for help. | Users may still over-trust it. It should not replace advice from police or a security professional. |
| **The intruder model is invented.** Nerve, breach times, police arrival (about 45–60 s) and how deterrents work are game-balance numbers, not statistics. Real police response is often many minutes. | — | Do not use drill results to decide what security equipment to buy or to estimate real response times. |
| **Confrontation options.** Pepper spray and shouting are available. In the game they can work; in reality confronting an intruder can escalate violence. | Spray is labelled a last resort; being seen lowers the score; the debrief warns against seeking the intruder out. | The option exists and can be "won" with. |
| **Legal differences.** Pepper spray is restricted or illegal in some countries and regions; self-defence law varies widely. | — | The app does not check or explain local law. |

## 2. Privacy and security of the floor plan

A plan of your home that marks doors, windows, hiding spots and where the valuables are is sensitive information.

| Risk | What the app does | What remains |
| --- | --- | --- |
| **Share links contain the whole plan.** The plan is encoded in the link itself. Anyone who gets the link gets the plan; links can end up in chat history, browser history and sync. | The plan sits after `#`, so it is not sent to the web server when the link is opened. | No password, expiry or revocation. Treat a share link like a house key. |
| **Stored unencrypted on the device.** The plan and settings are kept in the browser's local storage. | Nothing is uploaded; there is no account or server database. | Anyone with access to the unlocked device or browser profile can read it. Exported JSON files are plain text. |
| **Camera footage of your home.** | Video is analysed on the device and never uploaded; the recognition model is bundled with the app rather than fetched from a third party. | The recorded video file stays in the phone's gallery if the user recorded it there. |
| **Scanning someone else's home.** The app cannot tell whose home is being scanned, so it could be used to plan against a property rather than defend it. | — | Inherent to any floor-plan tool. Only scan homes you live in or have permission to scan. |
| **Hosting.** The site is served by Vercel, which sees ordinary web request data (IP address, pages requested). | No analytics or tracking is included. | Subject to the host's own logging. |

## 3. Accuracy

| Risk | What the app does | What remains |
| --- | --- | --- |
| **Scans are estimates.** Room sizes from video depend on an assumed camera height and tilt, a steady turn, and a visible floor line. Errors of tens of centimetres are expected; cluttered, dim or plain white rooms can be far off. | Shows the estimate for editing, warns when less than a full turn was tracked, and offers the sensor-based corner scan. | Never use the plan for building work, furniture orders, insurance or legal purposes. |
| **Furniture recognition is rough.** Categories can be wrong, objects can be missed, and objects seen through a doorway can be placed in the wrong room. | Each recognised item can be unticked before adding, and edited afterwards. | — |
| **Untested on real hardware and real footage** at the time of writing (see TODO.md). | — | Behaviour on an actual iPhone or Quest may differ from the desktop tests. |

## 4. Physical and wellbeing

| Risk | What the app does | What remains |
| --- | --- | --- |
| **Moving while looking at a screen.** Scanning means turning on the spot while watching the phone. | Instructions say to stand still in one place. | Trip and collision hazards, especially near stairs. |
| **VR.** Stick movement and snap turning can cause motion sickness; a headset blocks the view of the real room. | Snap turning rather than smooth turning. | Use a cleared play area; stop if unwell. No seated-mode or comfort settings yet. |
| **Flashing lights.** Alarm strobe and police lights flash red and blue. | — | May be unsuitable for people with photosensitive epilepsy. There is no setting to turn flashing off. |
| **Distressing content.** The scenario is a break-in of the player's own home at night, with an intruder who can chase and catch them. | No graphic violence; being caught ends the drill with a red fade only. | Can be frightening, particularly for children or anyone who has experienced a burglary or assault. Not designed for children. |

## 5. Technical and operational

| Risk | What the app does | What remains |
| --- | --- | --- |
| **Third-party code.** Depends on three.js, TensorFlow.js and a pretrained COCO-SSD model. | Versions are pinned by the lockfile; the model is self-hosted. | Dependencies need periodic updates; `npm audit` currently reports advisories in dev dependencies. |
| **Model limits.** The recognition model was trained on general photos and reflects that data's gaps. | Only furniture categories are used; detections of people are discarded. | — |
| **Offline cache.** The installed app caches itself and may keep showing an old version briefly after an update. | Cache refreshes in the background on each visit. | A fix may take one extra launch to appear. |
| **Performance.** Real-time 3D with many lights is demanding. | Lower pixel ratio on touch devices; reduced shadow work in VR. | Battery drain and heat on phones; possible low frame rate on a headset. |
| **No automated tests on pull requests.** Only the Vercel build runs. | Unit tests exist and run locally and in the GitLab pipeline config. | A regression could be merged if tests are not run by hand. |
| **Data loss.** Plans live only in one browser's storage. | Export to file and share link. | Clearing site data or uninstalling the app deletes the plan. |
