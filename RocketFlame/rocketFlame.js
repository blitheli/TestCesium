const FLAME_SHADER_SOURCE = `
  uniform float time;
  uniform vec4 coreColor;
  uniform vec4 flameColor;
  uniform vec4 smokeColor;
  uniform vec4 farSmokeColor;
  uniform float intensity;
  uniform float turbulenceAmount;
  uniform float ringCount;
  uniform float ringContrast;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.05;
      amplitude *= 0.5;
    }
    return value;
  }

  float fadeOut(float edge0, float edge1, float x) {
    return 1.0 - smoothstep(edge0, edge1, x);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material m = czm_getDefaultMaterial(materialInput);

    float along = clamp(materialInput.st.t, 0.0, 1.0);
    float lateral = materialInput.st.s - 0.5;

    float spread = 0.38 + along * (0.50 + turbulenceAmount * 0.20);
    float turb = fbm(vec2(lateral * 7.0, along * 4.0 - time * 5.5));
    float turb2 = fbm(vec2(lateral * 3.0 + 17.3, along * 1.8 - time * 2.2));
    float turb3 = fbm(vec2(lateral * 11.0 - 5.0, along * 7.0 - time * 3.5));

    float wobble = (turb - 0.5) * 0.40 * turbulenceAmount * smoothstep(0.0, 0.55, along);
    float dist = abs(lateral / spread + wobble) * 2.0;

    float ringZone = clamp((along - 0.08) / 0.40, 0.0, 1.0);
    float ringPhase = ringZone * ringCount * 6.2831853 + sin(lateral * 11.0 + 7.3) * 0.45;
    float rings = smoothstep(0.72, 0.96, sin(ringPhase));
    float ringMask = fadeOut(0.42, 0.55, along) * smoothstep(0.08, 0.16, along);
    ringMask *= smoothstep(0.0, 0.5, ringCount);

    float core = fadeOut(0.0, 0.55, dist) * fadeOut(0.0, 0.32, along);
    float flame = fadeOut(0.05, 1.0, dist)
      * fadeOut(0.02, 0.65, along)
      * (1.0 + turb2 * 0.25 * turbulenceAmount);
    float plumeDist = dist - turb3 * 0.45 * turbulenceAmount * smoothstep(0.20, 0.75, along);
    float plume = fadeOut(0.05, 1.0, plumeDist)
      * smoothstep(0.32, 0.55, along)
      * fadeOut(0.72, 1.0, along)
      * (0.55 + turb * 0.6 * turbulenceAmount);

    float farFade = 1.0 - smoothstep(0.78, 1.0, along);
    vec3 smokeAt = mix(smokeColor.rgb, farSmokeColor.rgb, smoothstep(0.30, 0.85, along));
    vec3 col = smokeAt;
    col = mix(col, flameColor.rgb, clamp(flame, 0.0, 1.0));
    col = mix(col, coreColor.rgb, clamp(core, 0.0, 1.0));

    float ringRadialMask = fadeOut(0.18, 0.62, dist);
    float ringBoost = rings * ringMask * ringRadialMask * ringContrast;
    col = mix(col, coreColor.rgb, ringBoost * 0.45);

    float alpha = 0.0;
    alpha = max(alpha, core * 1.50);
    alpha = max(alpha, flame * 1.15);
    alpha = max(alpha, plume * 0.22);
    alpha *= 1.0 + ringBoost * 0.35;
    alpha *= farFade * intensity;
    alpha = clamp(alpha, 0.0, 1.0);

    if (alpha < 0.01) {
      discard;
    }

    m.diffuse = vec3(0.0);
    m.emission = col * (0.85 + 2.8 * alpha + ringBoost * 0.9);
    m.alpha = alpha;
    return m;
  }
`;

export const DEFAULT_FLAME_OPTIONS = {
  length: 60.0,
  radius: 5.0,
  tailOffset: 0.0,
  axis: "-Z",
  show: true,
  localTranslation: new Cesium.Cartesian3(0.0, 0.0, 0.0),
  localRotation: new Cesium.HeadingPitchRoll(0.0, 0.0, 0.0),
  /** Optional multi-nozzle layout; see {@link RocketFlamePrimitive} `cluster` constructor option. */
  cluster: undefined,
  uniforms: {
    intensity: 1.35,
    turbulenceAmount: 1.4,
    ringCount: 2.0,
    ringContrast: 0.4,
    coreColor: Cesium.Color.fromCssColorString("#ffe6a8"),
    flameColor: Cesium.Color.fromCssColorString("#ff6a22"),
    smokeColor: Cesium.Color.fromCssColorString("#dba090"),
    farSmokeColor: Cesium.Color.fromCssColorString("#9c8d86"),
  },
};

export const FLAME_STAGES = {
  "Flame Length": { min: 2, max: 80, initial: 60, property: "length", rebuild: true },
  "Flame Radius": { min: 0.2, max: 8, initial: 5, property: "radius", rebuild: true },
  "Flame TailOffset": { min: -10, max: 60, initial: 0, property: "tailOffset", matrix: true },
  "Flame Show": { min: 0, max: 1, initial: 1, property: "show" },
  "Flame Intensity": { min: 0.1, max: 3, initial: 1.35, uniform: "intensity" },
  "Flame Turbulence": { min: 0, max: 2.5, initial: 1.4, uniform: "turbulenceAmount" },
  "Flame RingCount": { min: 0, max: 5, initial: 2, uniform: "ringCount" },
  "Flame RingContrast": { min: 0, max: 1.2, initial: 0.4, uniform: "ringContrast" },
  "Flame LocalX": { min: -50, max: 50, initial: 0, localTranslation: "x", matrix: true },
  "Flame LocalY": { min: -50, max: 50, initial: 0, localTranslation: "y", matrix: true },
  "Flame LocalZ": { min: -50, max: 50, initial: 0, localTranslation: "z", matrix: true },
  "Flame RotateX": { min: -180, max: 180, initial: 0, localRotation: "pitch", matrix: true },
  "Flame RotateY": { min: -180, max: 180, initial: 0, localRotation: "heading", matrix: true },
  "Flame RotateZ": { min: -180, max: 180, initial: 0, localRotation: "roll", matrix: true },
};

function cloneUniforms(uniforms) {
  return {
    intensity: uniforms.intensity,
    turbulenceAmount: uniforms.turbulenceAmount,
    ringCount: uniforms.ringCount,
    ringContrast: uniforms.ringContrast,
    coreColor: Cesium.Color.clone(uniforms.coreColor),
    flameColor: Cesium.Color.clone(uniforms.flameColor),
    smokeColor: Cesium.Color.clone(uniforms.smokeColor),
    farSmokeColor: Cesium.Color.clone(uniforms.farSmokeColor),
  };
}

const missingModelNodeWarnings = new Set();

/**
 * Parses one engine slot position for {@link RocketFlamePrimitive} cluster mode.
 * Accepts plain `{ x, y, z }` (meters in parent local frame), a `Cesium.Cartesian3`,
 * or `{ position: Cesium.Cartesian3 }`.
 *
 * @param {object|Cesium.Cartesian3} entry
 * @returns {Cesium.Cartesian3}
 */
export function parseEnginePosition(entry) {
  if (!entry) {
    return new Cesium.Cartesian3(0.0, 0.0, 0.0);
  }
  if (entry instanceof Cesium.Cartesian3) {
    return Cesium.Cartesian3.clone(entry);
  }
  if (entry.position instanceof Cesium.Cartesian3) {
    return Cesium.Cartesian3.clone(entry.position);
  }
  const x = Number(entry.x);
  const y = Number(entry.y);
  const z = Number(entry.z);
  return new Cesium.Cartesian3(
    Number.isFinite(x) ? x : 0.0,
    Number.isFinite(y) ? y : 0.0,
    Number.isFinite(z) ? z : 0.0,
  );
}

/**
 * @param {object|undefined} cluster
 * @returns {{ engines: Cesium.Cartesian3[] } | undefined}
 */
function cloneClusterOption(cluster) {
  if (!cluster || !Array.isArray(cluster.engines) || cluster.engines.length === 0) {
    return undefined;
  }
  return {
    engines: cluster.engines.map((e) => parseEnginePosition(e)),
  };
}

/**
 * Locates the runtime {@link Cesium.Model} primitive used for an entity {@link Cesium.ModelGraphics}.
 * Matches primitive `id` to the entity reference or `entity.id` string.
 *
 * @param {Cesium.Viewer} viewer
 * @param {Cesium.Entity} entity
 * @returns {Cesium.Model | undefined}
 */
export function findEntityModelPrimitive(viewer, entity) {
  if (!viewer || !entity) {
    return undefined;
  }
  const wantId = entity.id;
  const primitives = viewer.scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    if (
      p instanceof Cesium.Model &&
      p.id &&
      (p.id === entity || p.id.id === wantId)
    ) {
      return p;
    }
  }
  return undefined;
}

/**
 * World-space (fixed-frame) transform for a glTF node after model placement and articulations.
 *
 * Cesium renders a node at `sceneGraph.computedModelMatrix * runtimeNode.computedTransform`, where
 * `computedModelMatrix = model.modelMatrix * components.transform * axisCorrectionMatrix * computedScale`.
 * The axis-correction term flips glTF +Y-up to Cesium +Z-up; multiplying `model.modelMatrix` directly
 * by `runtimeNode.computedTransform` skips this term and produces a flame that follows the node's
 * translation but appears rotated/offset relative to the rocket body.
 *
 * Call after articulations are applied; for entity models with articulations, updating the flame in
 * `viewer.scene.postUpdate` ensures `computedTransform` matches the rendered frame.
 *
 * @param {Cesium.Model} model Must be `ready`
 * @param {string} nodeName glTF node `name`
 * @param {Cesium.Matrix4} [result]
 * @returns {Cesium.Matrix4 | undefined}
 */
export function getModelNodeWorldMatrix(model, nodeName, result) {
  if (!model || !nodeName || !model.ready) {
    return undefined;
  }
  let node;
  try {
    node = model.getNode(nodeName);
  } catch {
    return undefined;
  }
  if (!node) {
    const modelId = model.id?.id || model.id?.name || model.id || model._resource?.url || "unknown model";
    const warningKey = `${modelId}:${nodeName}`;
    if (!missingModelNodeWarnings.has(warningKey)) {
      missingModelNodeWarnings.add(warningKey);
      console.warn(
        `[RocketFlamePrimitive] Cannot find glTF node "${nodeName}" on model:`,
        modelId,
      );
    }
    return undefined;
  }
  const runtimeNode = node._runtimeNode;
  const computedTransform = runtimeNode && runtimeNode.computedTransform;
  if (!computedTransform) {
    return undefined;
  }
  const sceneGraph = model._sceneGraph ?? model.sceneGraph;
  const computedModelMatrix =
    (sceneGraph && sceneGraph.computedModelMatrix) || model.modelMatrix;
  const out = result ?? new Cesium.Matrix4();
  return Cesium.Matrix4.multiplyTransformation(
    computedModelMatrix,
    computedTransform,
    out,
  );
}

/**
 * Rigid world-space attachment matrix for a glTF node.
 *
 * The matrix from {@link getModelNodeWorldMatrix} can contain node/model scale, including the
 * `model.computedScale` factor baked into `sceneGraph.computedModelMatrix`. That is correct for
 * rendering the model itself, but using it directly as the flame primitive parent also scales /
 * distorts the flame. This helper keeps the node's world translation and rotation, while stripping
 * scale from the final matrix.
 *
 * @param {Cesium.Model} model Must be `ready`
 * @param {string} nodeName glTF node `name`
 * @param {Cesium.Matrix4} [result]
 * @param {Cesium.Matrix4} [worldMatrixScratch]
 * @param {Cesium.Matrix3} [rotationScratch]
 * @param {Cesium.Cartesian3} [translationScratch]
 * @returns {Cesium.Matrix4 | undefined}
 */
export function getModelNodeRigidWorldMatrix(
  model,
  nodeName,
  result,
  worldMatrixScratch,
  rotationScratch,
  translationScratch,
) {
  const worldMatrix = getModelNodeWorldMatrix(
    model,
    nodeName,
    worldMatrixScratch ?? new Cesium.Matrix4(),
  );
  if (!worldMatrix) {
    return undefined;
  }

  const translation = Cesium.Matrix4.getTranslation(
    worldMatrix,
    translationScratch ?? new Cesium.Cartesian3(),
  );
  const rotation = Cesium.Matrix4.getRotation(
    worldMatrix,
    rotationScratch ?? new Cesium.Matrix3(),
  );
  return Cesium.Matrix4.fromRotationTranslation(
    rotation,
    translation,
    result ?? new Cesium.Matrix4(),
  );
}

function mergeFlameOptions(defaults, options) {
  const merged = {
    ...defaults,
    ...options,
    localTranslation: Cesium.Cartesian3.clone(
      options.localTranslation || defaults.localTranslation,
    ),
    localRotation: Cesium.HeadingPitchRoll.clone(
      options.localRotation || defaults.localRotation,
    ),
    uniforms: {
      ...cloneUniforms(defaults.uniforms),
      ...(options.uniforms || {}),
    },
    cluster: cloneClusterOption(options.cluster),
  };
  return merged;
}

function createFlameMaterial(uniforms) {
  return new Cesium.Material({
    translucent: true,
    fabric: {
      type: "RocketFlame",
      uniforms: {
        time: 0.0,
        coreColor: uniforms.coreColor,
        flameColor: uniforms.flameColor,
        smokeColor: uniforms.smokeColor,
        farSmokeColor: uniforms.farSmokeColor,
        intensity: uniforms.intensity,
        turbulenceAmount: uniforms.turbulenceAmount,
        ringCount: uniforms.ringCount,
        ringContrast: uniforms.ringContrast,
      },
      source: FLAME_SHADER_SOURCE,
    },
  });
}

function createFlameAppearance(material) {
  return new Cesium.MaterialAppearance({
    material,
    materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
    translucent: true,
    closed: false,
    renderState: {
      depthTest: {
        enabled: false,
      },
      depthMask: false,
      blending: Cesium.BlendingState.ADDITIVE_BLEND,
      cull: {
        enabled: false,
      },
    },
  });
}

function buildAxisMatrix(axis, baseShift) {
  let rotationMatrix3;
  let translation;

  switch (axis) {
    case "+X":
      rotationMatrix3 = Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(90));
      translation = new Cesium.Cartesian3(baseShift, 0, 0);
      break;
    case "-Y":
      rotationMatrix3 = Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(90));
      translation = new Cesium.Cartesian3(0, -baseShift, 0);
      break;
    case "+Y":
      rotationMatrix3 = Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(-90));
      translation = new Cesium.Cartesian3(0, baseShift, 0);
      break;
    case "-Z":
      rotationMatrix3 = Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(180));
      translation = new Cesium.Cartesian3(0, 0, -baseShift);
      break;
    case "+Z":
      rotationMatrix3 = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);
      translation = new Cesium.Cartesian3(0, 0, baseShift);
      break;
    case "-X":
    default:
      rotationMatrix3 = Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(-90));
      translation = new Cesium.Cartesian3(-baseShift, 0, 0);
      break;
  }

  return Cesium.Matrix4.fromRotationTranslation(rotationMatrix3, translation);
}

/**
 * Cross-plane rocket exhaust primitive. Single-engine by default; use `options.cluster`
 * for multiple nozzles in the parent entity local frame (meters, same as `localTranslation`).
 *
 * @example
 * // Single engine (default): flame follows parentEntity; offset with localTranslation / setStage.
 * const flame = new RocketFlamePrimitive({ viewer, parentEntity: rocket });
 *
 * @example
 * // Follow a glTF nozzle node (articulation-safe): pass glTF node `name`, update in postUpdate.
 * const atNozzle = new RocketFlamePrimitive({
 *   viewer,
 *   parentEntity: rocket,
 *   nodeName: "EngineNozzle",
 * });
 *
 * @example
 * // Cluster: two engines symmetric on local Y (parent body axes).
 * const twin = new RocketFlamePrimitive({
 *   viewer,
 *   parentEntity: rocket,
 *   options: {
 *     cluster: {
 *       engines: [
 *         { x: 0, y: 2.5, z: 0 },
 *         { x: 0, y: -2.5, z: 0 },
 *       ],
 *     },
 *   },
 * });
 * // Optional: runtime layout
 * twin.setClusterEngines({
 *   engines: [
 *     { x: 0, y: 3, z: -1 },
 *     { x: 0, y: -3, z: -1 },
 *   ],
 * });
 */
export class RocketFlamePrimitive {
  constructor({ viewer, parentEntity = null, nodeName = null, options = {} }) {
    if (!viewer) {
      throw new Error("RocketFlamePrimitive requires a Cesium.Viewer instance.");
    }

    this.viewer = viewer;
    this.parentEntity = parentEntity;
    this.nodeName = nodeName != null && String(nodeName).length > 0 ? String(nodeName) : null;
    this._entityModelCache = undefined;
    this.options = mergeFlameOptions(DEFAULT_FLAME_OPTIONS, options);
    this.primitive = undefined;
    this.fixedParentMatrix = undefined;
    this.localFlameMatrix = new Cesium.Matrix4();
    this.engineLocalMatrices = [];
    this.geometryInstanceList = [];
    this.parentWorldMatrix = new Cesium.Matrix4();
    this.nodeWorldMatrixScratch = new Cesium.Matrix4();
    this.nodeRotScratch = new Cesium.Matrix3();
    this.posScratch = new Cesium.Cartesian3();
    this.quatScratch = new Cesium.Quaternion();
    this.rotScratch = new Cesium.Matrix3();
    this.flameBasisScratch3 = new Cesium.Matrix3();
    this.flameAdjScratch4 = new Cesium.Matrix4();
    this._combinedTransScratch = new Cesium.Cartesian3();
    this._planeFirst = new Cesium.Matrix4();
    this._planeSecond = new Cesium.Matrix4();
    this.hasValidTransform = false;

    this.material = createFlameMaterial(this.options.uniforms);
    this.appearance = createFlameAppearance(this.material);
    this.rebuildPrimitive();
  }

  /**
   * Recomputes the two billboard plane matrices from length and radius (no engine count).
   */
  rebuildPlanePair() {
    const scale = Cesium.Matrix4.fromScale(
      new Cesium.Cartesian3(this.options.radius * 2.0, this.options.length, 1.0),
    );
    const alignLengthToZ = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(90)),
    );
    const moveOriginToRoot = Cesium.Matrix4.fromTranslation(
      new Cesium.Cartesian3(0.0, 0.0, this.options.length / 2),
    );
    const rotateCross = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(90)),
    );
    Cesium.Matrix4.multiply(alignLengthToZ, scale, this._planeFirst);
    Cesium.Matrix4.multiply(moveOriginToRoot, this._planeFirst, this._planeFirst);
    Cesium.Matrix4.multiply(rotateCross, this._planeFirst, this._planeSecond);
  }

  /**
   * Local flame rigid body matrix for one engine at `translation` (parent local meters),
   * before cross-plane geometry. World pose is `parentWorld * this * plane`.
   *
   * @param {Cesium.Cartesian3} translation
   * @param {Cesium.Matrix4} out
   * @returns {Cesium.Matrix4}
   */
  buildFlameLocalMatrixInto(translation, out) {
    const baseShift = this.options.tailOffset;
    const axisMatrix = buildAxisMatrix(this.options.axis, baseShift);
    const localRotation = Cesium.Matrix3.fromHeadingPitchRoll(
      this.options.localRotation,
      this.flameBasisScratch3,
    );
    const localAdjustment = Cesium.Matrix4.fromRotationTranslation(
      localRotation,
      translation,
      this.flameAdjScratch4,
    );
    return Cesium.Matrix4.multiply(localAdjustment, axisMatrix, out);
  }

  /**
   * Rebuilds per-engine local matrices. With `options.cluster.engines`, each entry is an
   * engine nozzle origin; `options.localTranslation` is added to every engine (common rig offset).
   * Without cluster, only `options.localTranslation` is used (same as pre-cluster behavior).
   */
  rebuildEngineLocalMatrices() {
    const bases = this.options.cluster?.engines;
    const needCount = !bases || bases.length === 0 ? 1 : bases.length;
    while (this.engineLocalMatrices.length < needCount) {
      this.engineLocalMatrices.push(new Cesium.Matrix4());
    }
    this.engineLocalMatrices.length = needCount;

    if (!bases || bases.length === 0) {
      this.buildFlameLocalMatrixInto(this.options.localTranslation, this.engineLocalMatrices[0]);
    } else {
      for (let i = 0; i < bases.length; i++) {
        Cesium.Cartesian3.add(
          bases[i],
          this.options.localTranslation,
          this._combinedTransScratch,
        );
        this.buildFlameLocalMatrixInto(
          this._combinedTransScratch,
          this.engineLocalMatrices[i],
        );
      }
    }
    this.localFlameMatrix = this.engineLocalMatrices[0];
  }

  /**
   * Updates each `GeometryInstance.modelMatrix` to `engineLocal * plane` without rebuilding GPU primitive.
   */
  refreshInstanceModelMatrices() {
    if (!this.geometryInstanceList.length) {
      return;
    }
    const planes = [this._planeFirst, this._planeSecond];
    let idx = 0;
    for (let e = 0; e < this.engineLocalMatrices.length; e++) {
      const em = this.engineLocalMatrices[e];
      for (let p = 0; p < 2; p++) {
        Cesium.Matrix4.multiply(
          em,
          planes[p],
          this.geometryInstanceList[idx].modelMatrix,
        );
        idx++;
      }
    }
  }

  createFlamePlaneInstances() {
    const geometry = new Cesium.PlaneGeometry({
      vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    });
    this.rebuildPlanePair();
    this.rebuildEngineLocalMatrices();

    const instances = [];
    const planes = [this._planeFirst, this._planeSecond];
    for (let e = 0; e < this.engineLocalMatrices.length; e++) {
      const em = this.engineLocalMatrices[e];
      for (let p = 0; p < 2; p++) {
        const modelMatrix = Cesium.Matrix4.multiply(
          em,
          planes[p],
          new Cesium.Matrix4(),
        );
        instances.push(
          new Cesium.GeometryInstance({
            geometry,
            modelMatrix,
          }),
        );
      }
    }
    this.geometryInstanceList = instances;
    return instances;
  }

  rebuildPrimitive() {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive);
      this.primitive = undefined;
    }
    this.primitive = new Cesium.Primitive({
      geometryInstances: this.createFlamePlaneInstances(),
      appearance: this.appearance,
      asynchronous: false,
      allowPicking: false,
      releaseGeometryInstances: false,
      modelMatrix: new Cesium.Matrix4(),
    });
    this.primitive.show = this.options.show;
    this.viewer.scene.primitives.add(this.primitive);
  }

  /**
   * Replaces cluster layout. Pass `{ engines: [...] }` with the same position forms as the
   * constructor. Empty or missing `engines` restores single-engine mode (only `localTranslation`).
   *
   * @param {{ engines: Array<object|Cesium.Cartesian3> }} cluster
   */
  setClusterEngines(cluster) {
    const next = cloneClusterOption(cluster);
    this.options.cluster = next;
    const prevN = this.geometryInstanceList.length;
    this.rebuildPlanePair();
    this.rebuildEngineLocalMatrices();
    const nextN = this.engineLocalMatrices.length * 2;
    if (nextN !== prevN) {
      this.rebuildPrimitive();
    } else {
      this.refreshInstanceModelMatrices();
    }
  }

  /**
   * @returns {Array<{ x: number, y: number, z: number }>} snapshot of per-engine base positions in cluster mode; empty array if single-engine.
   */
  getClusterEnginePositions() {
    const bases = this.options.cluster?.engines;
    if (!bases || bases.length === 0) {
      return [];
    }
    return bases.map((c) => ({ x: c.x, y: c.y, z: c.z }));
  }

  /** @deprecated Use {@link rebuildEngineLocalMatrices} internally; kept for callers that relied on the old name. */
  rebuildLocalMatrix() {
    this.rebuildPlanePair();
    this.rebuildEngineLocalMatrices();
    this.refreshInstanceModelMatrices();
  }

  setParentEntity(entity) {
    this.parentEntity = entity;
    this.fixedParentMatrix = undefined;
    this._entityModelCache = undefined;
    this.hasValidTransform = false;
  }

  /**
   * When set to a non-empty string, the flame uses that glTF node's rigid world matrix
   * (see {@link getModelNodeRigidWorldMatrix}) when the entity's model is loaded; otherwise
   * falls back to entity position/orientation.
   *
   * @param {string | null | undefined} nodeName
   */
  setNodeName(nodeName) {
    const next =
      nodeName != null && String(nodeName).length > 0 ? String(nodeName) : null;
    this.nodeName = next;
    this._entityModelCache = undefined;
    this.hasValidTransform = false;
  }

  _getResolvedEntityModel() {
    if (!this.parentEntity) {
      return undefined;
    }
    const cached = this._entityModelCache;
    if (
      cached &&
      (!(typeof cached.isDestroyed === "function") || !cached.isDestroyed()) &&
      cached.ready
    ) {
      return cached;
    }
    const m = findEntityModelPrimitive(this.viewer, this.parentEntity);
    if (m && m.ready) {
      this._entityModelCache = m;
      return m;
    }
    this._entityModelCache = undefined;
    return undefined;
  }

  setParentTransform(positionOrMatrix, orientation) {
    if (positionOrMatrix instanceof Cesium.Matrix4) {
      this.fixedParentMatrix = Cesium.Matrix4.clone(positionOrMatrix);
    } else {
      Cesium.Matrix3.fromQuaternion(orientation, this.rotScratch);
      this.fixedParentMatrix = Cesium.Matrix4.fromRotationTranslation(
        this.rotScratch,
        positionOrMatrix,
        new Cesium.Matrix4(),
      );
    }
    this.parentEntity = null;
    this._entityModelCache = undefined;
    this.hasValidTransform = false;
  }

  setShow(show) {
    this.options.show = Boolean(show);
    if (this.primitive) {
      this.primitive.show = this.options.show;
    }
  }

  setAxis(axis) {
    this.options.axis = axis;
    this.rebuildEngineLocalMatrices();
    this.refreshInstanceModelMatrices();
  }

  setStage(stageKey, value) {
    const spec = FLAME_STAGES[stageKey];
    if (!spec) throw new Error(`Unknown flame stage: ${stageKey}`);
    const clamped = Cesium.Math.clamp(Number(value), spec.min, spec.max);

    if (spec.property === "show") this.options.show = clamped > 0.5;
    else if (spec.property) this.options[spec.property] = clamped;
    else if (spec.uniform) this.material.uniforms[spec.uniform] = clamped;
    else if (spec.localTranslation) this.options.localTranslation[spec.localTranslation] = clamped;
    else if (spec.localRotation) this.options.localRotation[spec.localRotation] = Cesium.Math.toRadians(clamped);

    if (spec.matrix && !spec.rebuild) {
      this.rebuildEngineLocalMatrices();
      this.refreshInstanceModelMatrices();
    }
    if (spec.rebuild) {
      this.rebuildPrimitive();
    }
    if (this.primitive) this.primitive.show = this.options.show;
    return clamped;
  }

  getStage(stageKey) {
    const spec = FLAME_STAGES[stageKey];
    if (!spec) throw new Error(`Unknown flame stage: ${stageKey}`);
    if (spec.property === "show") return this.options.show ? 1 : 0;
    if (spec.property) return this.options[spec.property];
    if (spec.uniform) return this.material.uniforms[spec.uniform];
    if (spec.localTranslation) return this.options.localTranslation[spec.localTranslation];
    if (spec.localRotation) return Cesium.Math.toDegrees(this.options.localRotation[spec.localRotation]);
    return undefined;
  }

  getParentWorldMatrix(time) {
    if (this.fixedParentMatrix) {
      return this.fixedParentMatrix;
    }
    if (!this.parentEntity) {
      return undefined;
    }

    if (this.nodeName) {
      const model = this._getResolvedEntityModel();
      if (model) {
        const nodeWorld = getModelNodeRigidWorldMatrix(
          model,
          this.nodeName,
          this.parentWorldMatrix,
          this.nodeWorldMatrixScratch,
          this.nodeRotScratch,
          this.posScratch,
        );
        if (nodeWorld) {
          return nodeWorld;
        }
      }
    }

    const p = this.parentEntity.position?.getValue(time, this.posScratch);
    const q = this.parentEntity.orientation?.getValue(time, this.quatScratch);
    if (!p || !q) {
      return undefined;
    }

    Cesium.Matrix3.fromQuaternion(q, this.rotScratch);
    return Cesium.Matrix4.fromRotationTranslation(
      this.rotScratch,
      p,
      this.parentWorldMatrix,
    );
  }

  update(time) {
    if (!this.primitive || !this.options.show) {
      if (this.primitive) this.primitive.show = false;
      return false;
    }

    const parentMatrix = this.getParentWorldMatrix(time);
    if (!parentMatrix) {
      this.primitive.show = this.hasValidTransform && this.options.show;
      return false;
    }

    Cesium.Matrix4.clone(parentMatrix, this.primitive.modelMatrix);

    this.primitive.show = this.options.show;
    this.hasValidTransform = true;
    this.material.uniforms.time = Cesium.JulianDate.secondsDifference(
      time,
      this.viewer.clock.startTime,
    );
    return true;
  }

  destroy() {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive);
      this.primitive = undefined;
    }
    if (
      this.material &&
      typeof this.material.destroy === "function" &&
      (typeof this.material.isDestroyed !== "function" || !this.material.isDestroyed())
    ) {
      this.material.destroy();
    }
  }
}
