# Bloodbath — design spec (2026-09-27)

## Intent

A browser game built with three.js. The player makes enemies bleed as much as possible.
The feel is Metal Slug (run-and-gun, chunky soldiers, arcade announcer, big explosions).
The gameplay is modern (dash, double jump, wall jump, slide, 360° aim, melee, executions).
The visual target is AAA 2D (Ori): painted parallax layers, dynamic light, fog, fluid blood.
The game adapts its difficulty to the player with an "AI Director".
The package includes a boot screen, a studio logo, an intro cinematic, menus, and results.

The session is non-interactive. The user asked for an end-to-end build, so decisions below
are the author's defaults.

## Story

The Pale Legion drains the living and stores the blood in cathedrals. The hero, "Red",
gives the blood back to the world. The enemies wear bone-white armour, so blood shows on them.

## Pillars

1. **Blood is the score.** The score is millilitres spilled. Wounds keep bleeding over time.
   Arterial spurts pulse with a heartbeat. Limbs sever and leak. Blood pools on the floor.
2. **Aggression heals.** The player absorbs fresh blood (walk through pools, executions).
   The "Frenzy" meter fills with blood spilled and gives slow motion plus double damage.
3. **Fluid motion.** Characters are cutout skeletal rigs with procedural animation at 60 fps,
   then verlet ragdolls on death.
4. **Fair adaptive challenge.** The Director measures skill and stress and changes pacing.

## Architecture

- Vite + vanilla ES modules + three.js 0.186. Vitest for pure logic.
- `src/core` — loop (fixed 120 Hz sim step, render interpolation), input (keyboard, mouse,
  gamepad), audio (WebAudio buses, synth SFX, music streams), assets, events, math, rng.
- `src/render` — renderer pipeline (scene render target at a pixel scale, then full-res
  post: bloom, grade, vignette, grain, chromatic aberration, optional CRT), lit sprite
  material (normal maps, wounds, rim light, 16 point lights), parallax, fog, particles,
  blood fluid (metaball render target with threshold shading), stains, pools, camera.
- `src/game` — world, level data, AABB physics, rig and ragdoll, player, enemies, weapons,
  projectiles, pickups, director, scoring, boss.
- `src/ui` — DOM overlay for menus and HUD (CSS animation, custom fonts).
- `src/scenes` — boot, intro, title, gameplay, results.

## Content

- Characters (AI cutout part sheets): Red (hero), Legion Grunt (rifle), Legion Butcher
  (heavy, cleaver + shield, 3x blood), Legion Leaper (fast knife rusher), boss "The Hemarch"
  (giant with a glass blood tank on the back).
- Stages: 1 "Ashen Outskirts" (burning village at dusk), 2 "Rust Cathedral" (gothic
  industrial interior), then the boss arena "The Reservoir".
- Weapons: default rifle (infinite), pickups H (heavy MG), S (shotgun), R (saw-disc ripper
  that ricochets), grenades, machete melee combo, execution.

## AI Director (difficulty auto-balancing)

- Inputs: damage taken, HP, time-to-kill, accuracy, dodges, deaths, close calls, blood/min.
- A skill estimate `skill` in [0,1] updates with an exponential moving average per event.
- A stress value `intensity` rises with damage and nearby threats and decays over time.
- The pacing state machine is BUILD_UP → PEAK → RELAX. RELAX starts when intensity passes a
  threshold or the peak lasts too long.
- Outputs: spawn interval, max concurrent enemies, enemy mix, enemy accuracy, reaction time,
  telegraph time, projectile speed, drop rates. Deaths lower `skill` (mercy).
- Options: "Adaptive" (default) or a fixed tier. F3 shows a debug overlay.

## Screens

Boot ("press any key", audio unlock) → studio logo → intro cinematic (painted panels, parallax,
narration with announcer voice) → title (animated logo, menu) → mission card → gameplay →
results (litres, dismemberments, executions, combo, time, rank) → next stage / title.
Pause menu, options, controls, credits, game over with arcade "CONTINUE?" countdown.

## Assets and models

- Images: `openai/gpt-5.4-image-2` and `google/gemini-3-pro-image` via OpenRouter.
- Music: `google/lyria-3-pro-preview` via OpenRouter.
- Voice lines: `openai/gpt-audio` via OpenRouter.
- SFX: procedural WebAudio synthesis.
- Normal maps: generated offline from sprite alpha and luminance (Python).

## Testing

- Vitest for director, scoring, physics, and rig math.
- Playwright screenshots of every screen, and an automated play session for errors.
