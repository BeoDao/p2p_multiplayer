# P2P Multiplayer — browser tile-terrain team game

A 2D team-versus-team game that runs entirely in the browser. Destructible and buildable
tile terrain, three classes (knight, archer, builder), capture-the-flag rounds, water,
and item drops — synchronized between players with **hostless peer-to-peer deterministic
lockstep** and rendered with **2D skeletal animation** on PixiJS.

## Features

- **Serverless multiplayer.** Peers connect over WebRTC in a full mesh; signaling uses
  public relays (Trystero), so no game server is required. Any player can leave —
  including the one who created the room — and the match continues for everyone else.
- **Deterministic simulation.** The simulation uses integers only (fixed-point positions,
  integer trigonometry and square roots, seeded RNG). Every peer runs the same
  simulation from the same inputs; only 4 bytes of input per player per tick are sent.
- **Two-layer terrain.** Front tiles (dirt, stone, gold, wood, doors, ladders, spikes…)
  and a back-wall layer. Unsupported chunks collapse; trees fall and drop logs.
- **Water.** Integer cellular-automaton water that flows and levels out; swimming and
  drowning.
- **Item drops.** Resources and consumables drop on death or when trees are felled and
  can be picked up by walking over them.
- **Data-driven content.** Tiles, classes, items, skeleton, animation clips and skins are
  plain JSON; textures can be replaced with PNG files without touching code.
- **Localized UI.** English, Japanese, Russian, Chinese and Arabic, switchable in-game.

## Getting started

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static output in dist/ — host it anywhere
npm test        # determinism, netcode and gameplay tests
```

Open the page, enter a room code and press **Join / Create online**. Everyone who enters
the same code is connected automatically; share the URL (the code is in the `#hash`).
**Practice offline** starts a local single-player session.

Optional URL parameters: `?strategy=torrent` (WebTorrent tracker signaling instead of
Nostr), `?relays=wss://…` (custom relays), `?lang=ja` (force a UI language).

## Controls

| Action | Keys |
| --- | --- |
| Move / jump | `A` `D`, `W` or `Space` |
| Ladder up / down | `W` `S` |
| Attack / dig / build | Left mouse button (hold to charge the bow) |
| Shield (knight) | Right mouse button or `Shift` |
| Select item | `1`–`9` or mouse wheel |
| Change class (inside your base) | `F1` knight, `F2` archer, `F3` builder |
| Buy consumables / heal (on a workshop) | `E` |
| Scoreboard / chat / settings | `Tab` / `Enter` / `Esc` |

Carry the enemy flag to your own flag to score; three captures win the round.

## Project layout

```
src/
  data/     JSON game data (tiles, classes, items, skeleton, animations, skins) + loader
  sim/      deterministic simulation — integers only, no rendering dependencies
  net/      transport abstraction, WebRTC transport, hostless lockstep session
  render/   PixiJS renderer, skeletal animation, HUD, sound, i18n
  main.ts   menu, input, game loop
tests/      vitest suites
public/assets/  optional PNG / WAV overrides (see below)
```

### How synchronization works

- The world advances in fixed 30 Hz ticks. A tick runs only when the inputs of every
  active member for that tick have arrived (lockstep, two ticks of input delay).
- There is no host. The member with the lowest id acts as *coordinator* for admitting
  new players and announcing departures; because every peer holds the full state, the
  role passes instantly to the next member if the coordinator leaves.
- Late joiners receive a snapshot of the world at an agreed tick and replay inputs from
  there. State hashes are exchanged periodically to detect divergence and resynchronize.

### Customizing content

- **Textures:** drop PNG files into `public/assets/parts/` or `public/assets/tiles/` and
  list their keys in the folder's `manifest.json`. Sound effects go in
  `public/assets/sfx/` as `<name>.wav`.
- **New block:** add a tile to `tiles.json` and a `{ kind: "block" }` entry to
  `items.json`.
- **New skin:** add an entry to `skins.json` (skins can extend others and substitute
  part textures per bone) and reference it from `classes.json`.
- **Animation:** clips in `animations.json` are keyframed bone-rotation tracks; overlay
  clips affect only the listed bones.

## Tech stack

TypeScript, Vite, PixiJS 8, Trystero (WebRTC), vitest.

## License

All rights reserved unless a license file is added to this repository.
