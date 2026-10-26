import * as THREE from 'three';
import { VIEW } from '../../shared/config';
import { QUALITY, type Quality, type QualityPreset } from '../settings';

const SKY_ZENITH = new THREE.Color(0x4f8fd0);
const SKY_HORIZON = new THREE.Color(0xc9dfec);
const GROUND_FOG = new THREE.Color(0xb9cdd6);

/** Horizontal FOV measured on 16:9, converted to vertical (Hor+ for other aspect ratios). */
export function verticalFov(hfov16x9: number): number {
  const t = Math.tan(((hfov16x9 * Math.PI) / 180) / 2) / (16 / 9);
  return (2 * Math.atan(t) * 180) / Math.PI;
}

function skyMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: SKY_ZENITH.clone() },
      horizon: { value: SKY_HORIZON.clone() },
      ground: { value: GROUND_FOG.clone() },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.05);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Scene, cameras and lights. The world is drawn first, then the depth buffer is cleared and
 * the viewmodel scene (weapon in camera space) is drawn on top, so the gun never clips walls.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly vmSun: THREE.DirectionalLight;
  readonly vmHemi: THREE.HemisphereLight;
  readonly vmFlash: THREE.PointLight;
  readonly worldFlash: THREE.PointLight;
  readonly sunDir = new THREE.Vector3();
  readonly preset: QualityPreset;
  private sky: THREE.Mesh;
  private hfov = VIEW.defaultFov;
  private renderScale = 1;
  private shadowCenter = new THREE.Vector3(Infinity, 0, 0);
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  zoom = 1;
  vmZoom = 1;
  info = { calls: 0, triangles: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
    sunDir: [number, number, number],
  ) {
    this.preset = QUALITY[quality];
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      desynchronized: true,
    } as THREE.WebGLRendererParameters);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;

    this.sunDir.set(...sunDir).normalize();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(VIEW.viewmodelFov, 1, 0.01, 10);

    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone().lerp(GROUND_FOG, 0.4), 60, this.preset.fogFar);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMaterial(this.sunDir));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xc4dcf2, 0x6b6a4c, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    this.sun.castShadow = true;
    const s = this.preset.shadowMapSize;
    this.sun.shadow.mapSize.set(s, s);
    const r = this.preset.shadowRange;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);

    // A light that always exists keeps the shader variant fixed; intensity 0 means off.
    this.worldFlash = new THREE.PointLight(0xffc27a, 0, 9, 2);
    if (this.preset.worldFlashLight) this.scene.add(this.worldFlash);

    this.vmHemi = new THREE.HemisphereLight(0xc4dcf2, 0x6b6a4c, 1.0);
    this.vmSun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.vmFlash = new THREE.PointLight(0xffb866, 0, 0.7, 2);
    this.vmFlash.position.set(0.1, -0.05, -0.5);
    // Soft fill from the viewer's side keeps the gun readable in shade.
    const vmFill = new THREE.DirectionalLight(0xdce6ff, 0.55);
    vmFill.position.set(-0.6, 0.5, 1);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmSun.target, this.vmFlash, vmFill);

    this.buildEnvironment();
  }

  /** Reflections for metal: a PMREM of the sky gradient. */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(this.sunDir));
    envScene.add(sky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0x5d6a45 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    envScene.add(ground);
    const env = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.vmScene.environment = env;
    this.vmScene.environmentIntensity = 0.7;
    pmrem.dispose();
  }

  setView(hfov: number, renderScale: number): void {
    this.hfov = hfov;
    this.renderScale = renderScale;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.renderScale;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.vmCamera.aspect = w / h;
    this.applyFov();
  }

  get baseVerticalFov(): number {
    return verticalFov(this.hfov);
  }

  private applyFov(): void {
    const v = this.baseVerticalFov;
    const t = Math.tan(((v * Math.PI) / 180) / 2) / this.zoom;
    this.camera.fov = (2 * Math.atan(t) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    const vt = Math.tan(((VIEW.viewmodelFov * Math.PI) / 180) / 2) / this.vmZoom;
    this.vmCamera.fov = (2 * Math.atan(vt) * 180) / Math.PI;
    this.vmCamera.updateProjectionMatrix();
  }

  /** Moves the shadow frustum with the player, snapped to shadow texels to avoid shimmering. */
  private followShadow(): void {
    const c = this.camera.position;
    if (Math.hypot(c.x - this.shadowCenter.x, c.z - this.shadowCenter.z) < 4) return;
    const r = this.preset.shadowRange;
    const texel = (2 * r) / this.preset.shadowMapSize;
    this.shadowCenter.set(Math.round(c.x / texel) * texel, 0, Math.round(c.z / texel) * texel);
    this.sun.target.position.copy(this.shadowCenter);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /** Viewmodel lights follow the world sun expressed in camera space; `sunShade` dims it in shadow. */
  private updateViewmodelLights(sunShade: number): void {
    this.tmpQ.copy(this.camera.quaternion).invert();
    this.tmpV.copy(this.sunDir).applyQuaternion(this.tmpQ);
    this.vmSun.position.copy(this.tmpV).multiplyScalar(5);
    this.vmSun.target.position.set(0, 0, 0);
    this.vmSun.target.updateMatrixWorld();
    this.vmSun.intensity = 2.6 * sunShade;
    this.vmHemi.intensity = 0.85 + 0.3 * sunShade;
    // Rotate reflections with the view so they stay fixed to the world.
    this.vmScene.environmentRotation.setFromQuaternion(this.tmpQ, 'YXZ');
  }

  render(sunShade: number): void {
    this.applyFov();
    this.followShadow();
    this.sky.position.copy(this.camera.position);
    this.updateViewmodelLights(sunShade);
    const gl = this.gl;
    gl.info.reset();
    gl.info.autoReset = false;
    gl.clear(true, true, false);
    gl.render(this.scene, this.camera);
    gl.clearDepth();
    gl.render(this.vmScene, this.vmCamera);
    this.info.calls = gl.info.render.calls;
    this.info.triangles = gl.info.render.triangles;
  }

  /**
   * Compiles the shaders of everything in both scenes, including objects that are hidden until
   * something happens (muzzle flashes, the second weapon), so nothing compiles mid-fight.
   */
  warmup(): void {
    const hidden: THREE.Object3D[] = [];
    for (const scene of [this.scene, this.vmScene]) {
      scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      });
    }
    this.gl.compile(this.scene, this.camera);
    this.gl.compile(this.vmScene, this.vmCamera);
    for (const o of hidden) o.visible = false;
  }

  /** Debug: renders only the viewmodel scene from an orbit camera around `target`. */
  renderViewmodelOrbit(target: THREE.Vector3, yaw: number, pitch: number, dist: number, fov = 30): void {
    const cam = new THREE.PerspectiveCamera(fov, this.camera.aspect, 0.005, 10);
    cam.position.set(
      target.x + dist * Math.sin(yaw) * Math.cos(pitch),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    cam.lookAt(target);
    this.gl.setClearColor(0x6d7480, 1);
    this.gl.clear(true, true, false);
    this.gl.render(this.vmScene, cam);
    this.gl.setClearColor(0x000000, 1);
  }

  gpuName(): string {
    const ctx = this.gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(ctx.getParameter(ctx.RENDERER));
  }
}
