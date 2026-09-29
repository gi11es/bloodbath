# BLOODBATH

A gory run-and-gun for the browser, built with three.js. It has a Metal Slug feel and modern movement. The goal is to make the Pale Legion bleed as much as possible.

**Play:** https://gi11es.github.io/bloodbath/

## Controls

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move | A / D | Left stick |
| Jump, double jump, wall jump | Space / W | A |
| Aim | Mouse (or arrows) | Right stick |
| Shoot | Left mouse / J | RT |
| Machete (deflects bolts) | Right mouse / K | X |
| Dash (invulnerable) | Shift / L | B / LT |
| Grenade | Q / G | LB |
| Execute a bleeding enemy | E | Y |
| Frenzy | F / R | RB |
| Pause (Esc again to quit) | Esc | Start |
| AI Director overlay | F3 | — |

### Touch screens (phones and tablets, landscape)

| Action | Touch |
|---|---|
| Move, crouch, slide, drop | Floating stick: put your left thumb anywhere on the left half and pull it down to crouch, slide or drop |
| Aim and shoot | Lock-on aim assist with auto-fire (can be turned off in Options). Drag on FIRE to aim by hand |
| Jump, double jump, wall jump | JUMP |
| Dash, machete, grenade | DASH, BLADE, NADE. BLADE turns into EXECUTE next to a bleeding enemy |
| Frenzy | The FRENZY button appears when the bar is full |
| Pause | The II button at the top |

On iPhone, use *Share → Add to Home Screen* to play fullscreen.

## Features

- **Blood is the score.** Wounds keep bleeding with the heartbeat. Limbs sever and leak. Blood pools on floors, and fresh blood heals you.
- **Cutout skeletal rigs.** Each character has a 16-joint skeleton with two-bone IK, planted feet and a spring-driven head. On death, a verlet ragdoll takes over.
- **Adaptive difficulty.** An AI Director measures your skill and stress. It paces the fight (build-up, peak, relax) and adjusts enemy mix, accuracy, damage and drops.
- **Roguelike stages.** Each run builds its stages from chunk templates. A reachability test proves that every seed can be completed.
- **Enemies.** Grunts, shotgunners, grenadiers, snipers, flamers, Leech drones, Leapers and Butchers, and a two-phase boss called the Hemarch.

## Development

```
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: director, scoring, level generator
npm run build
```

The checked-in phone paintings, compressed fonts, and title-drip lookup are
precomputed assets. After changing their sources, regenerate them with
`python3 tools/build_mobile_art.py`, `bash tools/build_fonts.sh`, and
`python3 tools/build_logo_edges.py`. The menu starts warming the first mission's
textures and common sounds once the title is visible.

Useful URL parameters: `?stage=stage1|stage2|boss|arena`, `?screen=intro`, `?bot=1` (autoplay), `?god=1`, and `?rigview=1` (rig inspector).

## Credits

- Art: OpenAI gpt-5.4-image-2 and Google Gemini 3 Pro Image
- Music: Google Lyria 3
- Voices: OpenAI gpt-audio
- Fonts: SIL OFL (Teko, Chakra Petch, Press Start 2P, Pirata One)
