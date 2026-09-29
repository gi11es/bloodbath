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
          vec2 xy = vec2(shadowData.x, shadowData.y) + position.xy * vec2(shadowData.z, 0.38);
          gl_Position = projectionMatrix * viewMatrix * vec4(xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float edge = max(0.0, 1.0 - dot(p, p));
          gl_FragColor = vec4(0.025, 0.005, 0.015, vAlpha * edge * edge);
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

  add(actor, world, x0, x1) {
    if (!actor?.alive || this.count >= this.capacity) return;
    const body = actor.body;
    if (!body || body.x < x0 || body.x > x1) return;
    const ground = body.grounded ? body.y : world.groundBelow(body.x, body.y + 0.08);
    if (!Number.isFinite(ground)) return;
    const height = Math.max(0, body.y - ground);
    if (height > 9) return;
    const boss = actor.type === 'boss';
    const width = Math.max(1.3, body.w * (boss ? 2.25 : 2.0)) / (1 + height * 0.13);
    const opacity = (boss ? 0.58 : actor.type === 'drone' ? 0.3 : 0.5) / (1 + height * 0.55);
    const i = this.count++ * 4;
    const a = this.instances.array;
    a[i] = body.x;
    a[i + 1] = ground + 0.09;
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
