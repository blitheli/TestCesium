# RocketFlame CZML 加载分析

## 目标

在 `rocketFlame.html` 中加载同目录下的 `rocket.czml`, 展示火箭模型, 姿态, 路径和 CZML 时钟动画。

## 资源关系

- 页面文件: `RocketFlame/rocketFlame.html`
- CZML 文件: `RocketFlame/rocket.czml`
- 模型资源: `model/launchvehicle.glb`

`rocket.czml` 中模型 URI 为 `/model/launchvehicle.glb`, 因此需要从项目根目录启动静态服务器访问页面, 例如:

```powershell
python -m http.server 8000
```

访问地址:

```text
http://localhost:8000/RocketFlame/rocketFlame.html
```

## 实现要点

- 使用 `Cesium.Viewer` 初始化场景, 保留动画控件和时间轴。
- 使用 `Cesium.CzmlDataSource.load("./rocket.czml")` 加载 CZML。
- 将 CZML data source 添加到 `viewer.dataSources`。
- 使用 `viewer.clockTrackedDataSource` 和 `timeline.zoomTo` 跟随 CZML 中的 clock。
- 查找 `LaunchVehicle/LaunchVehicle1` 实体并设置为 `viewer.trackedEntity`, 便于相机跟随火箭。
- 页面左上角显示加载状态, 便于判断 CZML 是否成功读取。

## 验证重点

- `RocketFlame/rocket.czml` 可以通过页面相对路径访问。
- `/model/launchvehicle.glb` 可以通过项目根路径访问。
- 页面中只保留一个完整 HTML 文档结构。
- 通过本地静态服务器访问, 避免浏览器直接打开本地文件时产生跨域或资源路径问题。

## 尾焰自定义着色器(rocketFlameShader.html)

### 目标

复用同目录的 `rocket.czml` 与 `launchvehicle.glb`, 在火箭尾部用一段 `Cesium.Primitive` 模拟发动机尾焰。
不修改原模型, 也不引入 `Cesium.CustomShader` 改 glb 内部材质,
而是新增一段几何体 + 自定义 `Cesium.Material`(GLSL `czm_getMaterial`), 风格与 `primitive/customMaterial.html` 一致。

### 关键点

1. 几何体: 使用两张互相垂直的 `PlaneGeometry` 组成 cross-plane Primitive。
  `reference.tsx` 的 shader 依赖平面 UV, 所以 Cesium 侧需要让 `st.s` 表示横向,
   `st.t` 表示喷射轴向, 而不是使用 `CylinderGeometry` 的周向 `s`。
2. 材质: `new Cesium.Material({ fabric: { uniforms: { time, coreColor, flameColor, smokeColor, farSmokeColor, intensity, turbulenceAmount, ringCount, ringContrast }, source } })`。
  shader 参考 `reference.tsx` 的 2D fbm 尾焰逻辑, 用沿轴向滚动的湍流生成高温核心, 橙色火焰和远端烟羽。
   同时加入静态马赫环: `ringCount` 控制亮盘数量, `ringContrast` 控制亮盘强度。
   颜色由远端烟雾过渡到橙色火焰, 再到白黄色核心。
   `czm_materialInput.st` 来自 `PlaneGeometry` 的 UV: `s` 是横向, `t` 是轴向 (0=喷口, 1=尖端)。
3. 外观: `MaterialAppearance({ materialSupport: TEXTURED, material, translucent: true, closed: false })`。
  需要 `TEXTURED.vertexFormat`, 因为 Cesium 1.138 的 `MaterialSupport.BASIC.vertexFormat`
   不包含 `st`, 会导致 shader 中 `materialInput.st` 没有真实 UV。
   渲染状态使用 additive blending, `depthMask=false`, `cull=false`, 并关闭尾焰自身 `depthTest`,
   让透明发光烟焰不被发射台地形或火箭模型深度遮掉。
4. 位姿同步: 通过 `updateFlameTransform(time)` 读取 `rocket.position.getValue(time)` /
  `rocket.orientation.getValue(time)`, 用 `Matrix4.fromRotationTranslation` 拼出
   火箭世界变换 W; 再左乘一个 "本体坐标系内, 把 cross-plane 从 +Z 方向旋到火箭尾喷方向, 并平移到尾部" 的局部矩阵 L,
   写入 `flamePrimitive.modelMatrix = W * L`, 同时把 `clock` 的相对秒数写入 `material.uniforms.time`。
   `scene.preUpdate` 和页面暴露的调试接口共用同一个函数, 便于把时钟暂停到指定 CZML 时间后稳定验证尾焰贴合位置。
   当 CZML 在极短时间片内取不到姿态样本时, 保留最近一次有效位姿, 避免尾焰在暂停或手动拖动时间轴时闪烁消失。

### 本体坐标系约定

`launchvehicle.glb` 经过 CZML 姿态加载后, 画面验证到发动机喷口方向对应本体 `-X`。
所以默认 `axis = "-X"`, 局部矩阵用 `Matrix3.fromRotationY(-90°)` 把 cross-plane 默认的 +Z 转到 -X,
再沿 -X 平移 `(tailOffset + length / 2)`。
默认 `tailOffset = 20.5m`, 让尾焰喷口端位于模型尾部外侧。

页面右上角的控制面板提供 `尾焰长度 / 尾焰半径 / 尾部偏移 / 尾喷方向` 4 个滑块/下拉菜单, 方便针对其它模型快速调试。

### 验证

```text
python -m http.server 8000
http://localhost:8000/RocketFlame/rocketFlameShader.html
```

- 起飞 ~120s 后从倾斜后方观察可见橙黄尾焰从火箭尾部喷出, 颜色由喷口端的暖白过渡到橙色和灰色烟羽, 透明度沿轴向衰减。
- 火箭随 CZML 姿态翻转时, 尾焰始终贴尾喷口、沿火箭本体 -Z 方向延伸。
- 调小 `尾焰长度` / `尾焰半径` 或修改 `尾部偏移`, 可以让火焰更收紧或更贴近喷口。

## 尾焰 CustomShader 挂到 glb 内火焰片 (rocketFlameShader2.html)

### 目标

不再使用独立 `Primitive` cross-plane, 而是通过 `entity.model.customShader = new Cesium.ConstantProperty(customShader)` 把 `Cesium.CustomShader` 应用到 CZML 加载的同一套 `launchvehicle.glb` 上。

### 如何只改火焰片

Cesium 的 `CustomShader` 作用于整颗 Model, 因此在 `fragmentMain` 里对非火焰材质直接 `return`, 保留 glTF 原有 PBR 结果。本仓库 glb 中火焰相关 mesh 共用材质 `Flames` (`emissiveFactor` 高, `alphaMode: BLEND`, 暗色 `baseColorTexture`)。片段阶段用 `length(emissive)` 阈值, 并辅以 `**max(baseColor.r,g,b)**` 低于阈值判定暗底板 (勿用 `length(rgb)`)。`Model.ready` 后再对 `Model` Primitive 赋一次 `customShader`, 并用 `entity.id` 字符串匹配避免因引用不同挂载失败。

**重要**: 不要在 `CustomShader` 上设置 `lightingModel: UNLIT`, 否则会覆盖整箭光照。`translucencyMode` 应使用 `INHERIT`。面板侧可加大自发光倍增、软化尖端 `farFade`、勾选反转 UV-Y 以适配喷口在纹理 v 轴哪一侧。

### 与 rocketFlameShader.html 的差异

- 尾焰形状与 UV 来自模型内平面 mesh, 用 `v_flameUv = texCoord_0 * u_uvScale` 做可调缩放。
- 着色仍沿用同一套 fbm + 马赫环思路, 输出写到 `czm_modelMaterial` 的 `emissive` / `alpha`。

### 验证

```text
http://localhost:8000/RocketFlame/rocketFlameShader2.html
```

## flamePlane 节点尾焰 (rocketFlameShader3.html)

- 使用 `simpleRocket.czml` 与 `model/simpleRocket.glb`, glTF 节点名 **flamePlane**。
- Cesium 的 `CustomShader` 作用于整颗 Model；片元用 `positionMC` 与 `u_flameBbMin/Max` + `u_bbInflate` 裁切，仅 flamePlane mesh 上的像素执行尾焰。
- `Model.ready` 后从 `getNode("flamePlane")._runtimeNode.runtimePrimitives` 读取各 primitive 的 `boundingSphere`（与 `positionMC` 同属 mesh 局部空间），包成 AABB 写入 uniform；失败时回退页面默认 `FLAME_PLANE_BB_*`。
- 顶点阶段在裁切盒内做法向脉动（随 `u_time` / `normalMC`），片元叠加 `flicker`，与原有 fbm + 马赫环形成动态尾焰。
- 验证：`http://localhost:8000/RocketFlame/rocketFlameShader3.html`

## 火焰 Primitive 模块化 (rocketFlame.js)

- `rocketFlameShader.html` 中独立 `Cesium.Primitive` 尾焰已抽为 `RocketFlame/rocketFlame.js`。
- 核心类为 `RocketFlamePrimitive`，负责创建 cross-plane 几何、`Cesium.Material` 尾焰 shader、`MaterialAppearance` 渲染状态和每帧父对象矩阵同步。
- 父对象绑定：
  - `setParentEntity(entity)`：使用 CZML Entity 的 `position` / `orientation` 作为父对象位姿。
  - `setParentTransform(position, orientation)` 或 `setParentTransform(matrix4)`：用于非 CZML Entity 的外部父对象位姿。
  - `update(time)`：每帧计算 `primitive.modelMatrix = parentWorldMatrix * localFlameMatrix`，并同步 shader `time` uniform。
- 类 articulation 参数接口：
  - `setStage(stageKey, value)` / `getStage(stageKey)`。
  - `FLAME_STAGES` 提供 `Flame Length`、`Flame Radius`、`Flame TailOffset`、`Flame Show`、`Flame Intensity`、`Flame Turbulence`、`Flame RingCount`、`Flame RingContrast`、`Flame LocalX/Y/Z`、`Flame RotateX/Y/Z`。
  - 长度/半径会重建 Primitive；偏移/局部位移/局部旋转只重建局部矩阵；材质效果参数直接写入 uniforms。
- 取舍：继续采用独立 Primitive，而不是塞回 glTF articulations。这样火焰 shader、透明混合、深度/剔除状态更容易独立维护，同时通过 stage API 获得类似 articulation 的调参体验。
- 验证：`python -m http.server 8000` 后访问 `http://localhost:8000/RocketFlame/rocketFlameShader.html`，拖动面板滑块确认尾焰随火箭姿态运动且参数实时生效。

## 自定义顶点属性 `_DDD`（Blender → glTF → CustomShader）

完整流程（Blender 中为 flamePlane 写入 `_DDD`、导出设置、glTF 校验、Cesium 中 `ddd` 映射与 fragment 分支注意事项）见：

`**[RocketFlame/flamePlane-DDD-workflow.md](flamePlane-DDD-workflow.md)`**

摘要：

- glTF 属性名 `_DDD` → CustomShader 中为 `**float`** 类型的 `**vsInput.attributes.ddd` / `fsInput.attributes.ddd`**。
- 仅火焰 primitive 含 `_DDD` 时：火焰可走分支；**无该属性的 primitive 可能不会执行自定义片段中的 `else`**，箭身保持原材质——应对火焰分支改写、`<= 阈值` 时 `**return**`，或在 Blender 中为箭身顶点同样写入 `_DDD=0`。

## rocketFlameShader4.html 编译错误排查

- 现象：页面打开即报 `RuntimeError: Vertex shader failed to compile. ERROR: 0:257: 'customShaderStage' : no matching overloaded function found`。
- 复现方式：根目录执行 `python -m http.server 8000` 后访问 `http://127.0.0.1:8000/RocketFlame/rocketFlameShader4.html`。
- 排查结果：报错并非来自 `fragmentMain` 本身，而是 `rocket.model.customShader = new Cesium.ConstantProperty(flameCustomShader)` 这条 `ModelGraphics.customShader` 路径。在 Cesium 1.138 下，这份资产会生成带 `HAS_CUSTOM_VERTEX_SHADER` 宏、但缺失 `customShaderStage(...)` 定义的顶点管线，最终在主着色器调用处编译失败。
- 验证证据：浏览器抓到的编译后顶点着色器中只剩 `customShaderStage(vsOutput, attributes, featureIds, metadata, metadataClass, metadataStatistics);` 调用，没有对应函数定义；同时 `ProcessedAttributes` 里仅出现 `positionMC`、`normalMC`、`texCoord_0`、`color_0`。
- 修复：不再给 `Entity.model.customShader` 赋值，只保留 `attachCustomShaderToEntityModel(...)` 中对底层 `Cesium.Model` primitive 的直接挂载 `p.customShader = shader`。
- 修复后验证：页面可正常渲染，控制台仅剩 `favicon.ico` 404，与着色器无关。

## rocketFlameShader4.html 单色验证模式

- 当前页新增开关 `USE_SOLID_COLOR_TEST`：
  - `true` 时，`_DDD > 0.5` 的 flamePlane 直接输出固定橙红色自发光，便于先确认 flamePlane 是否被 shader 命中。
  - `false` 时，恢复同文件内原有 fbm 尾焰代码。
- 当前页同时保留 `rocket.model.customShader = new Cesium.ConstantProperty(flameCustomShader)`，用于让当前资产先走最直接的 shader 挂载路径，再观察 flamePlane 是否出现。
- 本轮验证结果：页面可正常加载，未再出现 `customShaderStage` 编译错误；控制台仅剩 `favicon.ico` 404。

## `_DDD` 数据核对结论

- 终端里先前看到的 `MESH:0 / _DDD:0`、`MESH:1 / _DDD:6`、`MESH:2 / _DDD:12` 中，`0 / 6 / 12` 是 glTF accessor 索引，不是顶点属性值。
- 进一步直接读取 `model/simpleRocket.glb` 的 BIN 数据后确认：
  - `柱体` `_DDD` 的 192 个 float 全为 `0`
  - `锥体` `_DDD` 的 128 个 float 全为 `0`
  - `平面` `_DDD` 的 4 个 float 也全为 `0`
- 因此在 `rocketFlameShader4.html` 中把 `ddd` 可视化为纯色时，全模型都落到“深灰(<= 0.01)”分支，这是数据本身导致的正确结果。
- 结论：当前 glb 并没有把 flamePlane 的 `_DDD` 真正写成非零值；要继续走 `_DDD` 方案，需回 Blender / 导出链路修正属性写入，或改用其它可验证的稳定标记（如 `color_0` 或节点名路径）。

