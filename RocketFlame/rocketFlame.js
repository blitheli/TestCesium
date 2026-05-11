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
  tailOffset: 31.0,
  axis: "-X",
  show: true,
  localTranslation: new Cesium.Cartesian3(0.0, 0.0, 0.0),
  localRotation: new Cesium.HeadingPitchRoll(0.0, 0.0, 0.0),
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
  "Flame TailOffset": { min: -10, max: 60, initial: 31, property: "tailOffset", matrix: true },
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

export class RocketFlamePrimitive {
  constructor({ viewer, parentEntity = null, options = {} }) {
    if (!viewer) {
      throw new Error("RocketFlamePrimitive requires a Cesium.Viewer instance.");
    }

    this.viewer = viewer;
    this.parentEntity = parentEntity;
    this.options = mergeFlameOptions(DEFAULT_FLAME_OPTIONS, options);
    this.primitive = undefined;
    this.fixedParentMatrix = undefined;
    this.localFlameMatrix = new Cesium.Matrix4();
    this.parentWorldMatrix = new Cesium.Matrix4();
    this.posScratch = new Cesium.Cartesian3();
    this.quatScratch = new Cesium.Quaternion();
    this.rotScratch = new Cesium.Matrix3();
    this.hasValidTransform = false;

    this.material = createFlameMaterial(this.options.uniforms);
    this.appearance = createFlameAppearance(this.material);
    this.rebuildLocalMatrix();
    this.rebuildPrimitive();
  }

  createFlamePlaneInstances() {
    const geometry = new Cesium.PlaneGeometry({
      vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    });
    const scale = Cesium.Matrix4.fromScale(
      new Cesium.Cartesian3(this.options.radius * 2.0, this.options.length, 1.0),
    );
    const alignLengthToZ = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(90)),
    );
    const rotateCross = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(90)),
    );
    const firstPlaneMatrix = Cesium.Matrix4.multiply(
      alignLengthToZ,
      scale,
      new Cesium.Matrix4(),
    );
    const secondPlaneMatrix = Cesium.Matrix4.multiply(
      rotateCross,
      firstPlaneMatrix,
      new Cesium.Matrix4(),
    );

    return [
      new Cesium.GeometryInstance({
        geometry,
        modelMatrix: firstPlaneMatrix,
      }),
      new Cesium.GeometryInstance({
        geometry,
        modelMatrix: secondPlaneMatrix,
      }),
    ];
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

  rebuildLocalMatrix() {
    const halfLen = this.options.length / 2;
    const baseShift = this.options.tailOffset + halfLen;
    const axisMatrix = buildAxisMatrix(this.options.axis, baseShift);
    const hpr = this.options.localRotation;
    const localRotation = Cesium.Matrix3.fromHeadingPitchRoll(hpr, new Cesium.Matrix3());
    const localAdjustment = Cesium.Matrix4.fromRotationTranslation(
      localRotation,
      this.options.localTranslation,
    );
    Cesium.Matrix4.multiply(localAdjustment, axisMatrix, this.localFlameMatrix);
  }

  setParentEntity(entity) {
    this.parentEntity = entity;
    this.fixedParentMatrix = undefined;
    this.hasValidTransform = false;
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
    this.rebuildLocalMatrix();
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

    if (spec.matrix) this.rebuildLocalMatrix();
    if (spec.rebuild) {
      this.rebuildLocalMatrix();
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

    Cesium.Matrix4.multiply(
      parentMatrix,
      this.localFlameMatrix,
      this.primitive.modelMatrix,
    );

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
