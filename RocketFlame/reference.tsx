import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { folder, useControls } from 'leva'

// 火箭发动机喷射尾焰：vUv.y = 0 表示喷管出口，vUv.y = 1 表示远端
const exhaustVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const exhaustFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uCoreColor;
  uniform vec3  uFlameColor;
  uniform vec3  uSmokeColor;
  uniform vec3  uFarSmokeColor;
  uniform float uIntensity;
  uniform float uTurbulence;
  uniform float uRingCount;
  uniform float uRingContrast;

  varying vec2 vUv;

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

  void main() {
    float along = vUv.y;
    float lateral = vUv.x - 0.5;

    // 烟羽随距离喷管增大而横向扩散（圆锥形）
    float spread = 0.38 + along * (0.50 + uTurbulence * 0.20);

    // 多层湍流（不同尺度）
    float turb  = fbm(vec2(lateral * 7.0, along * 4.0 - uTime * 5.5));
    float turb2 = fbm(vec2(lateral * 3.0 + 17.3, along * 1.8 - uTime * 2.2));
    float turb3 = fbm(vec2(lateral * 11.0 - 5.0, along * 7.0 - uTime * 3.5));

    // 蛇形横向摆动，受 uTurbulence 控制
    float wobble = (turb - 0.5) * 0.40 * uTurbulence * smoothstep(0.0, 0.55, along);

    // 与中心轴的归一化距离（带湍流扰动）
    float dist = abs(lateral / spread + wobble) * 2.0;

    // 沿喷射方向的明暗波纹（马赫盘 / 涡环）：
    // 不依赖 uTime → 环完全静止；
    // uRingCount = 1/2/3 表示火焰段内分布的亮盘个数
    // 把 ringZone 归一化到 [0, 1] 内，N 个完整 sin 周期 = N 个亮带
    float ringZone = clamp((along - 0.08) / 0.40, 0.0, 1.0);
    float ringPhase = ringZone * uRingCount * 6.2831853
                    + sin(lateral * 11.0 + 7.3) * 0.45;
    float ringRaw = sin(ringPhase);
    // 锐化：只保留 sin 峰值附近的一小段，让亮盘更小、更薄
    float rings = smoothstep(0.72, 0.96, ringRaw);
    // 火焰段边缘软化，避免硬切
    float ringMask = smoothstep(0.55, 0.42, along) * smoothstep(0.08, 0.16, along);
    // 当环数量为 0 时整体禁用
    ringMask *= smoothstep(0.0, 0.5, uRingCount);

    // 高温核心：靠近中心 & 靠近出口最亮（窄而极亮）
    float core = smoothstep(0.55, 0.0, dist)
               * smoothstep(0.32, 0.0, along);

    // 火焰段：减弱横向湍流，让纵向 ring 调制更显眼
    float flame = smoothstep(1.0, 0.05, dist)
                * smoothstep(0.65, 0.02, along)
                * (1.0 + turb2 * 0.25 * uTurbulence);

    // 烟羽边缘被高频湍流打散（羽毛感）
    float plumeDist = dist - turb3 * 0.45 * uTurbulence * smoothstep(0.20, 0.75, along);
    float plume = smoothstep(1.0, 0.05, plumeDist)
                * smoothstep(0.32, 0.55, along)
                * (1.0 - smoothstep(0.72, 1.0, along))
                * (0.55 + turb * 0.6 * uTurbulence);

    // 远端逐渐消散
    float farFade = 1.0 - smoothstep(0.78, 1.0, along);

    // 烟雾颜色：近段保留暖意（被火光映红），远段过渡到冷灰
    vec3 smokeAt = mix(uSmokeColor, uFarSmokeColor, smoothstep(0.30, 0.85, along));

    // 颜色混合：远→近 == 烟雾→火焰→白热核
    vec3 color = smokeAt;
    color = mix(color, uFlameColor, clamp(flame, 0.0, 1.0));
    color = mix(color, uCoreColor, clamp(core, 0.0, 1.0));
    // 马赫盘应该出现在喷流内部，而不是铺满整束火焰宽度。
    // dist 越接近 0 越靠近喷流中心轴；这里把亮盘限制在中心区域。
    float ringRadialMask = smoothstep(0.62, 0.18, dist);
    float ringBoost = rings * ringMask * ringRadialMask * uRingContrast;
    color = mix(color, uCoreColor, ringBoost * 0.45);

    // alpha 取多个分量的最大值
    float alpha = 0.0;
    alpha = max(alpha, core  * 1.50);
    alpha = max(alpha, flame * 1.15);
    alpha = max(alpha, plume * 0.22);
    // 亮盘叠加：只提亮内部核心，避免高强度时变成整块白斑
    alpha *= 1.0 + ringBoost * 0.35;
    alpha *= farFade * uIntensity;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`

function ExhaustPlume({
  position,
  width = 0.16,
  length = 3.0,
  intensity = 1.0,
  turbulence = 1.5,
  ringCount = 1,
  ringContrast = 1.0,
  coreColor = '#fff0c8',
  flameColor = '#ff5a18',
  smokeColor = '#c89488',
  farSmokeColor = '#8a8480',
}) {
  const matRef = useRef()

  // 仅创建一次：所有运行时修改通过 ref / uniforms 完成
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCoreColor: { value: new THREE.Color() },
      uFlameColor: { value: new THREE.Color() },
      uSmokeColor: { value: new THREE.Color() },
      uFarSmokeColor: { value: new THREE.Color() },
      uIntensity: { value: 1 },
      uTurbulence: { value: 1 },
      uRingCount: { value: 1 },
      uRingContrast: { value: 1 },
    }),
    [],
  )

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime
    }
  })

  // 把 leva 控件 / props 同步到 uniforms（两个 mesh 共用同一个 uniforms 对象）
  useEffect(() => {
    if (!matRef.current) return
    const u = matRef.current.uniforms
    u.uIntensity.value = intensity
    u.uTurbulence.value = turbulence
    u.uRingCount.value = ringCount
    u.uRingContrast.value = ringContrast
    u.uCoreColor.value.set(coreColor)
    u.uFlameColor.value.set(flameColor)
    u.uSmokeColor.value.set(smokeColor)
    u.uFarSmokeColor.value.set(farSmokeColor)
  }, [intensity, turbulence, ringCount, ringContrast, coreColor, flameColor, smokeColor, farSmokeColor])

  // PlaneGeometry 用基准 1×1，再用 mesh.scale 控制长度/宽度，避免重建几何
  // 用 rotation-x = PI 让 vUv.y = 0 出现在 mesh 顶部（喷管出口）
  const halfLen = length / 2

  return (
    <group position={position}>
      {/* 十字双 plane，使任何视角都能看见柱体 */}
      <mesh position={[0, -halfLen, 0]} rotation={[Math.PI, 0, 0]} scale={[width * 2, length, 1]}>
        <planeGeometry args={[1, 1, 1, 48]} />
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={exhaustVertexShader}
          fragmentShader={exhaustFragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, -halfLen, 0]} rotation={[Math.PI, Math.PI / 2, 0]} scale={[width * 2, length, 1]}>
        <planeGeometry args={[1, 1, 1, 48]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={exhaustVertexShader}
          fragmentShader={exhaustFragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

function EngineNozzle({ position, radius = 0.05 }) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[radius, radius * 1.15, 0.07, 24]} />
      <meshStandardMaterial color="#1f2632" metalness={0.85} roughness={0.32} />
    </mesh>
  )
}

// 简化版长征 2F：中央芯级 + 4 个助推器
function RocketBody() {
  // 4 个助推器分别放在 ±x ±z（绕轴 4 个角）
  const boosterAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
  const boosterRadius = 0.27

  return (
    <group position={[0, 0, 0]}>
      {/* 整流罩 */}
      <mesh position={[0, 1.55, 0]}>
        <coneGeometry args={[0.16, 0.45, 36]} />
        <meshStandardMaterial color="#f6f9ff" roughness={0.35} />
      </mesh>
      {/* 逃逸塔 */}
      <mesh position={[0, 1.92, 0]}>
        <cylinderGeometry args={[0.018, 0.028, 0.28, 16]} />
        <meshStandardMaterial color="#e8edf5" roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.08, 0]}>
        <coneGeometry args={[0.018, 0.08, 12]} />
        <meshStandardMaterial color="#dfe5ef" roughness={0.5} />
      </mesh>

      {/* 飞船段 */}
      <mesh position={[0, 1.22, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.22, 36]} />
        <meshStandardMaterial color="#eef3fb" roughness={0.4} />
      </mesh>
      {/* 红色国旗带 */}
      <mesh position={[0, 1.22, 0.161]}>
        <planeGeometry args={[0.07, 0.05]} />
        <meshStandardMaterial color="#cf1530" roughness={0.5} />
      </mesh>

      {/* 二级 */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 1.0, 36]} />
        <meshStandardMaterial color="#f0f4fb" roughness={0.42} />
      </mesh>
      {/* 一级 */}
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.7, 36]} />
        <meshStandardMaterial color="#eef2f9" roughness={0.42} />
      </mesh>
      {/* 一级蓝色色带 */}
      <mesh position={[0, 0.05, 0.201]}>
        <planeGeometry args={[0.36, 0.04]} />
        <meshStandardMaterial color="#1f4fa3" roughness={0.45} />
      </mesh>
      {/* 中央 4 个发动机喷管 */}
      <EngineNozzle position={[0.07, -0.62, 0.07]} radius={0.05} />
      <EngineNozzle position={[-0.07, -0.62, 0.07]} radius={0.05} />
      <EngineNozzle position={[0.07, -0.62, -0.07]} radius={0.05} />
      <EngineNozzle position={[-0.07, -0.62, -0.07]} radius={0.05} />

      {/* 4 个助推器 */}
      {boosterAngles.map((angle) => {
        const x = Math.cos(angle) * boosterRadius
        const z = Math.sin(angle) * boosterRadius
        return (
          <group key={angle} position={[x, 0, z]}>
            {/* 助推器筒身 */}
            <mesh position={[0, -0.08, 0]}>
              <cylinderGeometry args={[0.08, 0.085, 1.5, 28]} />
              <meshStandardMaterial color="#f1f5fc" roughness={0.42} />
            </mesh>
            {/* 助推器锥头 */}
            <mesh position={[0, 0.78, 0]}>
              <coneGeometry args={[0.08, 0.26, 28]} />
              <meshStandardMaterial color="#f3f6fc" roughness={0.4} />
            </mesh>
            {/* 助推器喷管 */}
            <EngineNozzle position={[0, -0.86, 0]} radius={0.046} />
          </group>
        )
      })}
    </group>
  )
}

function StarField() {
  const stars = useMemo(() => {
    return Array.from({ length: 60 }, (_, index) => {
      const angle = index * 2.399963
      const radius = 3.2 + (index % 13) * 0.18
      return [
        Math.cos(angle) * radius,
        Math.sin(index * 1.7) * 2.0 + 0.5,
        -3.0 - (index % 11) * 0.15,
      ]
    })
  }, [])

  return (
    <group>
      {stars.map((position) => (
        <mesh key={position.join(',')} position={position}>
          <sphereGeometry args={[0.005, 6, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  )
}

export default function RocketFlame() {
  // 中央芯级 4 个喷管 + 4 个助推器喷管，对应每个发动机一束尾焰
  const boosterAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
  const boosterRadius = 0.27

  const corePlumes = [
    [0.07, -0.66, 0.07],
    [-0.07, -0.66, 0.07],
    [0.07, -0.66, -0.07],
    [-0.07, -0.66, -0.07],
  ]
  const boosterPlumes = boosterAngles.map((angle) => [
    Math.cos(angle) * boosterRadius,
    -0.9,
    Math.sin(angle) * boosterRadius,
  ])

  // leva 控制面板：火焰形态 + 马赫环 + 颜色
  const {
    flameLength: length,
    flameWidth: width,
    flameTurbulence: turbulence,
    flameIntensity: intensity,
    machRingCount: ringCount,
    machRingContrast: ringContrast,
    flameCore: coreColor,
    flameMid: flameColor,
    smokeNear: smokeColor,
    smokeFar: farSmokeColor,
  } = useControls('尾焰参数', {
    形态: folder({
      flameLength: { value: 3.2, min: 1.0, max: 6.0, step: 0.1, label: '火焰长度' },
      flameWidth: { value: 0.25, min: 0.04, max: 0.4, step: 0.01, label: '火焰宽度' },
      flameTurbulence: { value: 1.4, min: 0, max: 3, step: 0.05, label: '扰动大小' },
      flameIntensity: { value: 1.0, min: 0.2, max: 2.0, step: 0.05, label: '亮度' },
    }),
    马赫环: folder({
      machRingCount: { value: 2, min: 0, max: 3, step: 1, label: '环数量' },
      machRingContrast: { value: 0.25, min: 0, max: 1.2, step: 0.05, label: '环强度' },
    }),
    颜色: folder({
      flameCore: { value: '#ffe6a8', label: '高温核心' },
      flameMid: { value: '#ff6a22', label: '火焰' },
      smokeNear: { value: '#dba090', label: '近端烟羽' },
      smokeFar: { value: '#9c8d86', label: '远端烟羽' },
    }),
  })

  // 助推器尾焰相对中央喷管的尺寸比例
  const boosterWidth = width * 0.85
  const boosterLength = length * 1.13

  return (
    <>
      {/* 蓝天背景，更接近真实发射照片 */}
      <color attach="background" args={['#1f4d82']} />
      <fog attach="fog" args={['#1f4d82', 6, 14]} />

      <PerspectiveCamera makeDefault position={[2.5, 0.4, 6.5]} fov={38} />
      <OrbitControls makeDefault enablePan={false} minDistance={4} maxDistance={11} target={[0, -0.4, 0]} />

      <ambientLight intensity={1.1} color="#cfe0f5" />
      <directionalLight position={[4, 3, 5]} intensity={2.6} color="#fff7e8" />
      <directionalLight position={[-3, 2, 2]} intensity={0.8} color="#9bbfe8" />
      {/* 喷焰底部把火箭染上暖光 */}
      <pointLight position={[0, -0.6, 0]} color="#ff7a1c" intensity={3.5} distance={2.6} />

      <StarField />

      <group position={[0, 0, 0]}>
        <RocketBody />

        {/* 中央 4 个芯级发动机喷射 */}
        {corePlumes.map((position) => (
          <ExhaustPlume
            key={`core-${position.join(',')}`}
            position={position}
            width={width}
            length={length}
            intensity={intensity}
            turbulence={turbulence}
            ringCount={ringCount}
            ringContrast={ringContrast}
            coreColor={coreColor}
            flameColor={flameColor}
            smokeColor={smokeColor}
            farSmokeColor={farSmokeColor}
          />
        ))}

        {/* 4 个助推器喷射，稍长一点 */}
        {boosterPlumes.map((position) => (
          <ExhaustPlume
            key={`booster-${position.join(',')}`}
            position={position}
            width={boosterWidth}
            length={boosterLength}
            intensity={intensity}
            turbulence={turbulence}
            ringCount={ringCount}
            ringContrast={ringContrast}
            coreColor={coreColor}
            flameColor={flameColor}
            smokeColor={smokeColor}
            farSmokeColor={farSmokeColor}
          />
        ))}
      </group>
    </>
  )
}
