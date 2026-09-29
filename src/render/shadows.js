import * as THREE from 'three';

// A single instanced draw call for every actor's soft contact shadow.
// The ellipse is shaded procedurally, so there are no shadow maps or textures.
export class ContactShadows {
  constructor(scene, capacity = 128) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.instances = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.instances.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('shadowData', this.instances);
    geometry.instanceCount = 0;
    this.capacity = capacity;
    this.count = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec4 shadowData;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = shadowData.w;
          vec2 xy = vec2(shadowData.x, shadowData.y) + position.xy * vec2(shadowData.z, 0.40);
          gl_Position = projectionMatrix * viewMatrix * vec4(xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          // A broad cast shadow plus a compact, dark contact patch at the feet.
          // Both live in this one instance so extra actors do not add draw calls.
          float penumbra = pow(max(0.0, 1.0 - dot(p, p)), 1.35);
          vec2 contact = vec2((p.x + 0.28) * 1.75, p.y * 1.45);
          float core = pow(max(0.0, 1.0 - dot(contact, contact)), 1.15);
          float alpha = vAlpha * min(1.0, 0.65 * penumbra + 0.62 * core);
          gl_FragColor = vec4(0.018, 0.004, 0.009, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 39; // above the ground, below blood and actors
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  begin() { this.count = 0; }

  add(actor, world, x0, x1, hero = false) {
    if (!actor?.alive || this.count >= this.capacity) return;
    const body = actor.body;
    if (!body || body.x < x0 || body.x > x1) return;
    const ground = body.grounded ? body.y : world.groundBelow(body.x, body.y + 0.08);
    if (!Number.isFinite(ground)) return;
    const height = Math.max(0, body.y - ground);
    if (height > 9) return;
    const boss = actor.type === 'boss';
    const width = Math.max(boss ? 3.2 : 1.9, body.w * (boss ? 2.5 : 2.2)) / (1 + height * 0.13);
    const opacity = (boss ? 0.9 : actor.type === 'drone' ? 0.52 : hero ? 0.92 : 0.82) / (1 + height * 0.55);
    const i = this.count++ * 4;
    const a = this.instances.array;
    a[i] = body.x + 0.14 + Math.min(height * 0.12, 0.5);
    a[i + 1] = ground + 0.12;
    a[i + 2] = width;
    a[i + 3] = opacity;
  }

  end() {
    this.mesh.geometry.instanceCount = this.count;
    if (!this.count) return;
    this.instances.clearUpdateRanges();
    this.instances.addUpdateRange(0, this.count * 4);
    this.instances.needsUpdate = true;
  }
}
