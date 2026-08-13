# AtmosAngLight 分析小结

测试页: `index.html`(调试面板) / `atmosAngLight.html`(完整演示)。  
参考: Cesium 官方 Atmosphere 示例, [CesiumJS Ref Doc](https://cesium.com/learn/cesiumjs/ref-doc/)。

## 目标

从 ISS 附近(~400 km)观察地球大气散射, 并正确表现昼夜: 向阳面有气辉, 夜半球足够暗; ISS 模型在夜侧接近微光, 在昼侧正常受光与自阴影。

## 地球光照与大气

| 设置 | 作用 |
| --- | --- |
| `globe.enableLighting` | 按太阳方向做昼夜着色 |
| `showGroundAtmosphere` + `skyAtmosphere` | 地面/天空大气散射 |
| `dynamicAtmosphereLighting(+FromSun)` | 大气随太阳变化 |
| `scene.atmosphere.dynamicLighting = SUNLIGHT` | 模型与天空也走太阳动态光照 |
| `atmosphereLightIntensity` | 地面默认约 5, 天空约 50 |
| `perFragmentAtmosphere` | 片元级大气, 边缘更细, 更耗性能 |
| `highDynamicRange` | HDR, 亮边与黑暗太空对比更好 |

太阳方向由 `viewer.clock` 决定(时间轴可调)。**全局 `scene.light`(SunLight) 必须保持正常强度**, 不能按 ISS 地方时去压暗, 否则 Home/全地球视角下整颗地球都会变黑。

### 夜半球为何“远看很黑、拉近变亮”

Cesium 按**相机高度**做昼夜淡入淡出:

- 低于 `lightingFadeOutDistance` / `nightFadeOutDistance` 时, 会减弱甚至取消夜侧着色, 影像重新变亮。
- 默认约千万米量级; ISS(~4e5 m) 落在“近距全亮”区时, 拉近后夜半球发灰/发亮。

本页采用**近距保黑**:

```text
lightingFadeOutDistance = 0
lightingFadeInDistance  = 1e5
nightFadeOutDistance    = 0
nightFadeInDistance     = 1e5
```

这样从地表到太空都保持昼夜光照。

### 夜半球亮度公式要点

Globe 片元大致为:

```text
diffuseIntensity = clamp(lambert * lambertDiffuseMultiplier + vertexShadowDarkness, 0, 1)
```

夜侧 `lambert ≈ 0`, 因此**夜半球亮度 ≈ `vertexShadowDarkness`**。  
该值是环境光加项, 不是“阴影有多黑”: 越大夜侧越亮。要很暗需压到接近 0(本页约 `0.02`)。

## ISS 模型光照与阴影

### 阴影

- `viewer.shadows = true`, `terrainShadows = ENABLED`
- `shadowMap`: 级联阴影; `maximumDistance` 为阴影作用距离(米), 过大质量下降
- 模型 `shadows: ENABLED`: 部件可投射/接收自阴影
- `softShadows`: PCF 软阴影, 更柔和但更吃带宽

ISS 在级联阴影范围内时, 帆板/桁架可在舱体上投下阴影。地球在数百公里外, 通常不抢近景 cascade。

### 模型昼夜(地影需手写)

Cesium **不会**自动把实体放进地球本影。ISS 在地理夜侧时, 太阳平行光仍可能照亮模型。

做法: 按 ISS 地方时估算 `dayFactor`, **只改模型**, 不动全局太阳光:

- **昼/黄昏**(`day > 0.2`): `lightColor = (1,1,1)`, 正常 IBL, 无黑色混合
- **夜侧**: 降低/关闭 `lightColor` 与 IBL; 必要时用 `color = BLACK` + `colorBlendMode = MIX` 压自发光贴图

切勿用全局 `atmosphereBrightnessShift` 或把 `SunLight.intensity` 按夜侧压到接近 0 来“暗模型”, 会破坏整球向阳面。

### 相机

- `trackedEntity` 在鼠标操作后会被取消跟随
- 用 `lookAtTransform(ENU)` + 合适俯仰, 相机在 ISS 外侧看向地球, 才能同时看到模型与大气边缘
- 俯仰角若把相机放到地球一侧并朝向太空, 视野中可能只有星空, 看不到大气效果

## 性能(显存大、帧率低)原因摘要

当前默认偏画质优先, 主要开销:

1. **高清分辨率**(`useBrowserRecommendedResolution: false`): 按 DPR 渲染, DPR=2 时像素约 4 倍
2. **MSAA 4x**: 高分辨率下显存与填充率再放大
3. **阴影 2048 + softShadows + terrainShadows**: 多张深度图 + 多遍绘制 + PCF 采样
4. **World Terrain / 影像瓦片**: 近距 LOD 升高, GPU 缓存变多
5. **HDR + perFragmentAtmosphere + FXAA**: 全屏/按像素额外计算

降负优先顺序建议: 低清分辨率 → 关 MSAA → 关软阴影/降 `shadowMap.size` → 必要时关地形阴影或片元大气。

## 调试面板要点

- FPS / Inspector: Cesium 内置调试
- 相机: ISS / 全地球 / 俯视 / 自由
- 昼夜淡入淡出预设: 近距保黑 / Cesium默认 / 远距才黑(复现拉近变亮)
- 时间用底部时间轴调节; 模型昼夜随时钟更新

## 本地验证

```bash
python -m http.server 8000
```

打开 `http://localhost:8000/AtmosAngLight/index.html`。
