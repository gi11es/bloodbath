import * as THREE from 'three';

// The shadow mesh shares each character batch's instance data. Its vertex shader
// projects the exact animated cutout onto the ground, with a low, oblique cast.
// This adds one draw call per atlas, no second rig pass or shadow map.
export function makeProjectedShadowMaterial(map) {
  const w = map.image?.width || 1024, h = map.image?.height || 1024;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      texel: { value: new THREE.Vector2(1 / w, 1 / h) },
      castSlope: { value: new THREE.Vector2(0.5, 0.28) },
    },
    vertexShader: `
      attribute vec4 iA;
      attribute vec4 iB;
      attribute vec4 iUV;
      attribute vec4 iShadow; // ground y, opacity, support x0, support x1
      varying vec2 vUv;
      varying float vOpacity;
      varying float vCastX;
      varying vec2 vSupport;
      uniform vec2 castSlope;
      void main() {
        vec2 p = position.xy * abs(iB.xy);
        float c = cos(iA.z), s = sin(iA.z);
        vec2 world = iA.xy + vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        float height = max(0.0, world.y - iShadow.x);
        // Project down across the painted floor, away from the key light.
        // Clamp depth to the visible floor band as the character jumps.
        vec2 castPos = vec2(world.x + height * castSlope.x + 0.08,
                            iShadow.x - 0.025 - min(height * castSlope.y, 0.46));
        vec2 localUv = vec2(iB.x < 0.0 ? 1.0 - uv.x : uv.x,
                            iB.y < 0.0 ? 1.0 - uv.y : uv.y);
        vUv = iUV.xy + localUv * iUV.zw;
        vOpacity = iShadow.y;
        vCastX = castPos.x;
        vSupport = iShadow.zw;
        gl_Position = projectionMatrix * viewMatrix * vec4(castPos, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D map;
      uniform vec2 texel;
      varying vec2 vUv;
      varying float vOpacity;
      varying float vCastX;
      varying vec2 vSupport;
      void main() {
        if (vOpacity < 0.002 || vCastX < vSupport.x || vCastX > vSupport.y) discard;
        // Five atlas-alpha taps feather the silhouette without a blur render pass.
        float a = texture2D(map, vUv).a * 0.36;
        a += texture2D(map, vUv + vec2(6.0 * texel.x, 0.0)).a * 0.16;
        a += texture2D(map, vUv - vec2(6.0 * texel.x, 0.0)).a * 0.16;
        a += texture2D(map, vUv + vec2(0.0, 6.0 * texel.y)).a * 0.16;
        a += texture2D(map, vUv - vec2(0.0, 6.0 * texel.y)).a * 0.16;
        gl_FragColor = vec4(0.012, 0.003, 0.008, vOpacity * smoothstep(0.04, 0.75, a));
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function updateProjectedShadow(actor, world, x0, x1) {
  if (!actor) return;
  const body = actor.body;
  let ground = 0, opacity = 0, supportX0 = 0, supportX1 = 0;
  if (actor.alive && body && body.x >= x0 && body.x <= x1) {
    ground = body.grounded ? body.y : world.groundBelow(body.x, body.y + 0.08);
    if (Number.isFinite(ground)) {
      const height = Math.max(0, body.y - ground);
      const surface = world.surfaceAt(body.x, ground, 0.2);
      if (height < 9 && surface) {
        opacity = (actor.type === 'boss' ? 0.66 : actor.type === 'drone' ? 0.52 : 0.64) / (1 + height * 0.5);
        supportX0 = surface.x0;
        supportX1 = surface.x1;
      }
    } else ground = 0;
  }
  actor.shadowGround = ground;
  actor.shadowAlpha = opacity;
  actor.shadowX0 = supportX0;
  actor.shadowX1 = supportX1;
  if (actor.rig) {
    actor.rig.shadowGround = ground;
    actor.rig.shadowAlpha = opacity;
    actor.rig.shadowX0 = supportX0;
    actor.rig.shadowX1 = supportX1;
  }
}
