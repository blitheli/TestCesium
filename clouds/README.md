## Cesium 大气云层（PNG）处理过程与原理

本文档说明 `clouds1.html` 中 `fair_clouds_4k.png` 的处理流程、核心渲染原理，以及为什么“透明度=1”时仍可能遮挡地表。

---

## 1. 实现目标

- 使用一张云层纹理（`fair_clouds_4k.png`）包裹地球，构建大气云层外壳。
- 云层可自转，并可通过面板实时调整：透明度、转速、云层高度。
- 避免“整层云像不透明球壳一样盖住地表”的问题。

---

## 2. 几何层：为什么用“云壳”

实现方式：在地球半径外再创建一个椭球壳（Ellipsoid）。

- 地球半径：`earthRadius = 6378137.0`
- 默认云层高度：`baseCloudHeight = 15000.0`（米）
- 云壳半径：`earthRadius + baseCloudHeight`

这样做的好处：

- 云层与地表分离，视觉上更像大气层而非贴地纹理。
- 通过缩放模型矩阵即可动态调节云层高度，代价低。

---

## 3. 纹理层：PNG 的 alpha 并不总是可靠

很多“云图 PNG”虽然是 PNG 格式，但 alpha 可能接近全 1（几乎不透明），或者并非作者期望的透明蒙版。

如果直接用 `tex.a` 作为最终透明度，当 `tex.a` 全高时，云壳会整体变得很实，出现遮挡地表的感觉。

---

## 4. Shader 处理流程（当前实现）

`clouds1.html` 中使用了自定义材质 `CloudLayer`，主要流程：

1. 采样纹理：`tex = texture(image, uv)`
2. 计算亮度：
	- `luminance = dot(tex.rgb, vec3(0.299, 0.587, 0.114))`
3. 基于亮度推导云 alpha：
	- `derivedAlpha = smoothstep(alphaLow, alphaHigh, luminance)`
4. 判断是否信任纹理 alpha：
	- 当 `tex.a < 0.99`，使用纹理 alpha
	- 当 `tex.a >= 0.99`，认为 alpha 信息不可靠，改用亮度推导 alpha
5. 合成最终透明度：
	- `finalAlpha = selectedAlpha * globalOpacity`
6. 输出：
	- `material.diffuse = tex.rgb`
	- `material.alpha = clamp(finalAlpha, 0.0, 1.0)`

### 关键意义

- `globalOpacity` 是全局强度控制（UI 滑块）。
- `alphaLow / alphaHigh` 控制“多亮算云”。
- 当 PNG alpha 质量不佳时，亮度兜底可避免整球遮挡。

---

## 5. 渲染状态：避免透明层写深度

当前云层外观配置了：

- `translucent: true`
- `blending: Cesium.BlendingState.ALPHA_BLEND`
- `depthTest.enabled: true`
- `depthMask: false`

其中最关键的是 `depthMask: false`：

- 透明云层不把自身深度写入深度缓冲。
- 可避免后续地表/其他对象因为“深度被云壳抢占”而异常遮挡。

---

## 6. 动画与交互参数

### 自转动画

- 每帧计算时间差 `deltaSeconds`
- `cloudAngle += cloudSpeed * deltaSeconds`
- 通过 `rotationZ + uniformScale` 更新 `cloudPrimitive.modelMatrix`

### 参数面板

- 云层透明度：更新 `globalOpacity`
- 自转速度（°/s）：转换为弧度后驱动动画
- 云层高度（m）：通过缩放云壳半径实现
- 浏览器分辨率开关：控制 `viewer.useBrowserRecommendedResolution`

---

## 7. 常见问题排查

### Q1：透明度=1 时仍遮挡地球？

优先检查：

1. 贴图 alpha 是否几乎全 1（可用图像工具查看 alpha 通道）
2. shader 是否启用“alpha 兜底逻辑”（亮度推导）
3. `depthMask` 是否为 `false`
4. 是否浏览器缓存旧脚本（建议 `Ctrl+F5` 强刷）

### Q2：云太厚/太薄？

- 调整 `globalOpacity`
- 调整 `alphaLow / alphaHigh`
- 必要时在图像软件中重新制作 alpha（推荐）

### Q3：性能和清晰度如何平衡？

- 开启浏览器推荐分辨率：更省性能
- 关闭浏览器推荐分辨率：更清晰但更耗性能

---

## 8. 推荐资源规范（最佳实践）

为了得到更稳定的云层效果，建议云图满足：

- RGB：云为亮、背景尽量暗
- Alpha：背景接近 0，云体按浓淡渐变
- 分辨率：4K 起步，8K 更细腻（视显存与性能）

当资源规范良好时，可直接信任 `tex.a`；当资源不可控时，当前实现的亮度兜底策略更稳健。
