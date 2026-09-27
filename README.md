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

Useful URL parameters: `?stage=stage1|stage2|boss|arena`, `?screen=intro`, `?bot=1` (autoplay), `?god=1`, and `?rigview=1` (rig inspector).

## Credits

- Art: OpenAI gpt-5.4-image-2 and Google Gemini 3 Pro Image
- Music: Google Lyria 3
- Voices: OpenAI gpt-audio
- Fonts: SIL OFL (Teko, Chakra Petch, Press Start 2P, Pirata One)
