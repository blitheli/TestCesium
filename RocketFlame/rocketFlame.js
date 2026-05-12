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
  /** 可选多喷口布局；参见 {@link RocketFlamePrimitive} 构造参数中的 `cluster`。 */
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
  "Flame Length": { min: 2, max: 120, initial: 60, property: "length", rebuild: true },
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
 * 解析 {@link RocketFlamePrimitive} 多喷口模式中的单个发动机位置。
 * 支持普通 `{ x, y, z }`（单位为米，坐标系取决于附着父对象）、`Cesium.Cartesian3`
 * 或 `{ position: Cesium.Cartesian3 }`。
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
 * 查找某个 {@link Cesium.Entity} 的 {@link Cesium.ModelGraphics} 实际对应的运行时
 * {@link Cesium.Model} primitive。
 * 通过 primitive 的 `id` 与 entity 对象引用或 `entity.id` 字符串匹配。
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
 * 获取 glTF 节点在模型定位和 articulation 生效后的世界坐标（fixed-frame）矩阵。
 *
 * Cesium 渲染节点时使用 `computedModelMatrix * runtimeNode.computedTransform`，其中：
 * `computedModelMatrix = model.modelMatrix * components.transform * axisCorrectionMatrix * computedScale`。
 * `axisCorrectionMatrix` 会把 glTF 的 +Y-up 修正到 Cesium 的 +Z-up；如果直接使用
 * `model.modelMatrix * runtimeNode.computedTransform`，会漏掉这层轴向修正，导致火焰虽然跟随
 * 节点平移，但相对箭体出现旋转或偏移。
 *
 * 这里基于当前帧的 `model.modelMatrix` 重新计算 `computedModelMatrix`，而不是直接读取
 * `sceneGraph.computedModelMatrix`。Entity 驱动的模型会先更新 `model.modelMatrix`，随后才刷新
 * sceneGraph 缓存；直接读缓存可能拿到上一帧矩阵。
 *
 * 应在 articulation 应用后调用；{@link RocketFlamePrimitive} 会在 `viewer.scene.preRender`
 * 自动执行更新，因此调用方在 `postUpdate` 中修改 articulation 后会被本帧火焰读取到。
 *
 * @param {Cesium.Model} model 必须已 `ready`
 * @param {string} nodeName glTF 节点的 `name`；返回矩阵的平移部分就是该节点原点的世界坐标
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
  const out = result ?? new Cesium.Matrix4();
  const sceneGraph = model._sceneGraph ?? model.sceneGraph;
  const componentsTransform =
    sceneGraph?.components?.transform ?? Cesium.Matrix4.IDENTITY;
  const axisCorrectionMatrix =
    sceneGraph?.axisCorrectionMatrix ?? Cesium.Matrix4.IDENTITY;
  const computedScale = Number.isFinite(model.computedScale)
    ? model.computedScale
    : Number.isFinite(model.scale)
      ? model.scale
      : 1.0;

  // 用当前 model.modelMatrix 即时重算 Cesium 的模型放置矩阵，不直接读 sceneGraph 缓存。
  // Entity 驱动模型的 sceneGraph 缓存会在 Model.update 时刷新，在 scene.postUpdate 中读取可能慢一帧。
  Cesium.Matrix4.multiplyTransformation(
    model.modelMatrix,
    componentsTransform,
    out,
  );
  Cesium.Matrix4.multiplyTransformation(
    out,
    axisCorrectionMatrix,
    out,
  );
  Cesium.Matrix4.multiplyByUniformScale(out, computedScale, out);
  return Cesium.Matrix4.multiplyTransformation(
    out,
    computedTransform,
    out,
  );
}

/**
 * 获取 glTF 节点的刚体世界附着矩阵。
 *
 * {@link getModelNodeWorldMatrix} 返回的矩阵可能包含节点或模型缩放，包括 Cesium 模型放置矩阵中的
 * `model.computedScale`。这对渲染模型本身是正确的，但如果直接作为火焰 primitive 的父矩阵，
 * 火焰也会被缩放或拉伸。本函数保留节点的世界位置与旋转，同时从最终矩阵中剥离缩放。
 *
 * @param {Cesium.Model} model 必须已 `ready`
 * @param {string} nodeName glTF 节点的 `name`
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
 * 火箭尾焰 cross-plane primitive。
 *
 * 坐标基准由 `nodeName` 决定：
 * - 不提供 `nodeName` 时，火焰跟随 `parentEntity` 的 position/orientation，局部偏移
 *   `localTranslation` 与 `cluster.engines` 都以 Entity 坐标为基准。
 * - 提供 `nodeName` 时，火焰跟随该 glTF 节点的原点；primitive 的父矩阵取该节点原点的世界
 *   位置与旋转，`localTranslation` 与 `cluster.engines` 都以该节点局部坐标为基准。
 *
 * 默认是单喷口；如需多喷口，使用 `options.cluster` 配置多个喷口局部位置（单位：米）。
 *
 * @example
 * // 单喷口（默认）：不传 nodeName，火焰跟随 Entity 坐标。
 * const flame = new RocketFlamePrimitive({ viewer, parentEntity: rocket });
 *
 * @example
 * // 挂到 glTF 节点原点：传入 glTF 节点 name，火焰跟随该节点原点。
 * const atNozzle = new RocketFlamePrimitive({
 *   viewer,
 *   parentEntity: rocket,
 *   nodeName: "EngineNozzle",
 * });
 *
 * @example
 * // 多喷口：两个发动机在当前基准坐标的局部 Y 方向对称分布。
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
 * // 运行时也可以替换喷口布局。
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
    this._autoUpdate = (scene, time) => {
      this.update(time);
    };

    this.material = createFlameMaterial(this.options.uniforms);
    this.appearance = createFlameAppearance(this.material);
    this.rebuildPrimitive();
    this.viewer.scene.preRender.addEventListener(this._autoUpdate);
  }

  /**
   * 根据长度和半径重新计算两片交叉平面的局部矩阵（不涉及发动机数量）。
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
   * 计算单个发动机在 `translation` 位置的火焰局部刚体矩阵（单位：米）。
   * `translation` 所在坐标系取决于是否设置 `nodeName`：
   * 未设置时为 Entity 坐标；设置时为 glTF 节点原点的局部坐标。
   * 最终世界姿态为 `parentWorld * this * plane`。
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
   * 重建每个发动机的局部矩阵。
   * 使用 `options.cluster.engines` 时，每一项都是一个喷口原点；`options.localTranslation`
   * 会叠加到所有喷口上，作为共同微调偏移。
   * 不使用 cluster 时，仅使用 `options.localTranslation`（与单喷口行为一致）。
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
   * 仅更新每个 `GeometryInstance.modelMatrix = engineLocal * plane`，不重建 GPU primitive。
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
   * 替换多喷口布局。传入 `{ engines: [...] }`，位置格式与构造参数一致。
   * `engines` 为空或缺失时恢复单喷口模式（仅使用 `localTranslation`）。
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
   * @returns {Array<{ x: number, y: number, z: number }>} cluster 模式下每个发动机基础位置的快照；
   * 单喷口模式返回空数组。
   */
  getClusterEnginePositions() {
    const bases = this.options.cluster?.engines;
    if (!bases || bases.length === 0) {
      return [];
    }
    return bases.map((c) => ({ x: c.x, y: c.y, z: c.z }));
  }

  /** @deprecated 内部请使用 {@link rebuildEngineLocalMatrices}；保留该方法用于兼容旧调用方。 */
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
   * 设置火焰附着基准。
   *
   * - `nodeName` 为空、`null` 或 `undefined`：火焰以 `parentEntity` 的 position/orientation
   *   作为父矩阵，即使用 Entity 坐标。
   * - `nodeName` 为非空字符串：火焰以该 glTF 节点的原点作为父矩阵。节点加载成功后会使用
   *   {@link getModelNodeRigidWorldMatrix} 读取节点原点的世界位置与旋转；火焰 primitive 的
   *   `(0, 0, 0)` 就对应这个节点原点。
   *
   * @param {string | null | undefined} nodeName glTF 节点 `name`；不提供则回到 Entity 坐标。
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
    if (this._autoUpdate) {
      this.viewer.scene.preRender.removeEventListener(this._autoUpdate);
      this._autoUpdate = undefined;
    }
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
