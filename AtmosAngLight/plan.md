# AtmosAngLight 地球大气散射分析

## 目标

从太空视角观察地球边缘大气, 随相机视角和太阳位置变化呈现接近真实的 Rayleigh / Mie 散射(白昼蓝色气辉, 晨昏线橙红色). 场景中放置 ISS entity, 模型取自参考仓库. Cesium 以设备像素高清渲染.

## 开源 Cesium 实现调研

CesiumJS 本身已包含开源大气散射, 不必再找第三方插件作为第一方案.

| 来源 | 算法 | 适用场景 |
| --- | --- | --- |
| Cesium `SkyAtmosphere` + `Globe` ground atmosphere | Nishita 1993 单次散射 | 地球边缘气辉, 地面大气, 雾 |
| 官方 Sandcastle `Atmosphere.html` (Cesium 1.140) | 同上, 暴露 Rayleigh / Mie / HDR 参数 | 调参参考 |
| [Improved Atmosphere in CesiumJS](https://cesium.com/blog/2022/05/26/improved-atmosphere-in-cesiumjs/) | 单次散射, 天空与地面共用 `AtmosphereCommon.glsl` | 原理说明 |

关键 API:

- `scene.skyAtmosphere`: 地球外侧大气椭球, 太空中看到的边缘光晕.
- `globe.showGroundAtmosphere` + `globe.enableLighting`: 地表大气与晨昏线红色调.
- `skyAtmosphere.perFragmentAtmosphere = true`: 片元级散射, 边缘更平滑.
- `scene.highDynamicRange = true`: 亮边缘与黑暗太空的动态范围.
- `globe.dynamicAtmosphereLighting` / `dynamicAtmosphereLightingFromSun`: 散射随太阳方向变化.
- `scene.atmosphere.dynamicLighting = SUNLIGHT`: 模型(ISS)也走大气光照.

官方示例在开启光照后把 `globe.atmosphereLightIntensity` 提到 `20`, 并打开 HDR. 本页以此为默认, 再打开 per-fragment.

结论: 开源 Cesium 实现可以直接满足"太空看地球边缘, 随视角和太阳变化"的需求, 作为本测试页的主方案.

## 参考站 three-geospatial / atmosphere

参考: [takram-design-engineering/three-geospatial packages/atmosphere](https://github.com/takram-design-engineering/three-geospatial/tree/b629cac68a3473e0ecef853bef92ee30b0b5a620/packages/atmosphere)

该包是 Eric Bruneton Precomputed Atmospheric Scattering 的 Three.js 实现, 使用预计算 LUT 和多次散射, 视觉上比 Cesium 单次散射更接近照片(尤其是 ISS 前景 + 地球边缘). Storybook `Atmosphere-LightingMask` 把 ISS 放在经度 -110, 纬度 45, 高度 408 km, 地方时约 17:00, 用于拍晨昏线.

ISS 模型路径: `storybook/assets/iss.glb`(Git LFS), 来源为 NASA International Space Station 3D Model. 本目录保留原始压缩文件 `iss.glb`. Cesium 1.140 对 `KHR_mesh_quantization` + `EXT_meshopt_compression` 的包围盒/顶点尺度会出错, 因此另存解量化后的 `iss-cesium.glb`(约 112 m × 69 m × 59 m, JPEG 贴图)供页面加载.

## 为何不把 Bruneton 整套搬进 Cesium

本仓库无构建系统, 页面是静态 HTML. Bruneton 方案依赖:

- 预计算散射 LUT 纹理生成或加载
- Three.js 后处理(`AerialPerspectiveEffect` + EffectComposer)
- 与 Cesium 地球 / 影像 / 深度缓冲的对接

在无打包的 Cesium 页面里重写整套 LUT 后处理, 工作量和维护成本远高于本测试目标. Cesium 已有同物理问题的开源实现, 应先用它把视角, 太阳, ISS, 高清分辨率跑通. 若后续觉得边缘气辉仍不够"照片级", 再考虑用自定义 `PostProcessStage` 或大气椭球 shader 吸收 Bruneton 的 LUT.

## 实现要点

页面: `AtmosAngLight/atmosAngLight.html`, 从 `CesiumTemplate.html` 起步, Cesium 1.140.

1. 高清分辨率
   - `useBrowserRecommendedResolution: false`, 按 `devicePixelRatio` 渲染, 而不是 CSS 像素.
   - `msaaSamples: 4`, `scene.fxaa = true`, 压地球边缘锯齿.
   - 面板提供"高清分辨率"开关, 默认开启.

2. 大气
   - 打开 sky / ground atmosphere, lighting, HDR, per-fragment.
   - 太阳方向走 Cesium 时钟(地方时滑条), 散射颜色随太阳变化.
   - 面板可调光强, Rayleigh 尺度高度, Mie 各向异性.

3. ISS entity
   - `id: "ISS"`, `model.uri: "./iss.glb"`.
   - 默认位置与参考站一致: lon -110, lat 45, height 408000 m.
   - 轨道相位可绕地心旋转, 用来改视角; 与太阳时角解耦, 便于单独观察"视角"和"太阳位置".
   - 姿态用位置-速度旋转, 使模型沿轨道朝向.

4. 相机
   - 默认"边缘视角": 以 ISS 为原点 `lookAtTransform(ENU)` + HeadingPitchRange(0°, -18°, 500 m), 从北侧略俯视整站, 便于看到帆板投射到舱体上的硬阴影. 鼠标在该参考系内绕 ISS 旋转缩放.
   - 自由相机把姿态烘焙回世界坐标. 全地球视角约 22000 km 俯视.

5. 面板交互
   - 标题栏右侧 `−` / `+` 折叠或展开控制面板.
   - `光照:开/关` 对应官方 Shadows 示例: `viewer.shadows` + entity `ShadowMode.ENABLED` + `terrainShadows`.
   - 阴影走 Viewer 默认级联阴影图, `shadowMap.maximumDistance = 10000`, `size = 2048`, 软阴影关闭. 相机在 ISS 附近(数百米到数公里)时, ISS 落在 10 km 阴影范围内, 地球在 408 km 外不抢 cascade.
   - 不再自建正交 ShadowMap, 也不改 darkness / IBL / lightColor, 让模型用和 Cesium Air 示例相同的默认 PBR 光照.

## index.html: 去掉固定 entity, 从 czmlData.js 加载 CZML

调试页 `index.html` 不再用 `viewer.entities.add` 放固定经纬高 ISS, 也不再用地方时推太阳/昼夜.

1. 删除地方时与固定位置
   - 去掉 `ISS_LON` / `ISS_LAT` / `ISS_ALTITUDE` / `REFERENCE_DATE`.
   - 去掉 `setLocalSolarTime`, `dayFactorFromLocalHour`, `getLocalHourFromJulianDate`.
   - 状态栏改为显示当前 ISS 地固经纬高, 不再显示地方时.

2. CZML 加载
   - `czmlData.js` 导出 `getCzmlData()`, 返回完整 CZML 包: document clock + `Satellite/ISS`.
   - 星历: `epoch` + `cartesianVelocity`(t, x, y, z, vx, vy, vz), `referenceFrame: INERTIAL`, Lagrange 5 阶.
   - 页面: `import getCzmlData from './czmlData.js'`, `viewer.dataSources.add(Cesium.CzmlDataSource.load(getCzmlData()))`.
   - `viewer.clockTrackedDataSource` 对齐 CZML 时钟(2022-04-18T04:00Z 起 7200 s, multiplier 60, LOOP_STOP).
   - 用 `dataSource.entities.getById('Satellite/ISS')` 取实体; 不设置 orientation, 使用 Cesium 默认姿态.
   - 模型 `gltf: /model/iss-cesium.glb`, 阴影 ENABLED.

3. 昼夜与相机
   - 模型昼夜改为 ISS 地固位置与太阳方向夹角(`Simon1994PlanetaryPositions` + ICRF→ECEF), 不再用地方时近似.
   - ISS 视角用 `viewer.zoomTo(iss, HeadingPitchRange)` 一次性对准, 不每帧 lookAt 跟随, 避免暂停时相机仍旋转.
   - 全地球/俯视对准当前星下点. 距离滑条再次调用 zoomTo.

## 验证

```
python -m http.server 8000
```

打开 `http://localhost:8000/AtmosAngLight/index.html`.

- ISS 沿 `czmlData.js` 星历运动, 状态栏经纬高随时钟变化.
- 点 ISS 视角用 zoomTo 对准模型, 暂停时相机不再自行旋转; 全地球/俯视对准当前星下点.
- 播放时间轴时太阳与晨昏线随真实历元变化, 无地方时控件.
- 夜侧 ISS 模型变暗, 向阳面地球大气正常.

打开 `http://localhost:8000/AtmosAngLight/atmosAngLight.html`.

- 默认边缘视角: 相机在 ISS 北侧约 500 m, 能看到帆板和舱体; 帆板/桁架应在舱体上投下近黑、边缘清晰的硬阴影; 鼠标绕 ISS 旋转缩放.
- 全地球视角: 能看到北美和晨昏线, 向阳一侧有蓝色大气光晕.
- 拖动"地方时", 晨昏线颜色应明显变化.
- 拖动"轨道相位"或播放轨道, 边缘厚度和颜色随视角变化.
- 关闭高清分辨率后, 边缘应明显更糊.
