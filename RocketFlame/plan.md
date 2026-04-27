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

1. 几何体: `Cesium.CylinderGeometry({ length, topRadius: 0.05, bottomRadius })`,
   收紧成锥状, 底面对喷口、尖端朝外。
2. 材质: `new Cesium.Material({ fabric: { uniforms: { time, coreColor, flameColor, smokeColor, farSmokeColor, intensity, turbulenceAmount, ringCount, ringContrast }, source } })`。
   shader 参考 `reference.tsx` 的 2D fbm 尾焰逻辑, 用沿轴向滚动的湍流生成高温核心, 橙色火焰和远端烟羽。
   同时加入静态马赫环: `ringCount` 控制亮盘数量, `ringContrast` 控制亮盘强度。
   颜色由远端烟雾过渡到橙色火焰, 再到白黄色核心。
   `czm_materialInput.st` 在 cylinder 侧面上 `s` 是周向 (映射为 `lateral = s - 0.5`), `t` 是轴向 (0=喷口, 1=尖端)。
3. 外观: `MaterialAppearance({ material, translucent: true, closed: false })`。
4. 位姿同步: 在 `scene.preUpdate` 内读取 `rocket.position.getValue(time)` /
   `rocket.orientation.getValue(time)`, 用 `Matrix4.fromRotationTranslation` 拼出
   火箭世界变换 W; 再左乘一个 "本体坐标系内, 把圆柱从 +Z 方向旋到火箭尾喷方向, 并平移到尾部" 的局部矩阵 L,
   写入 `flamePrimitive.modelMatrix = W * L`, 同时把 `clock` 的相对秒数写入 `material.uniforms.time`。

### 本体坐标系约定

`launchvehicle.glb` 经过 Cesium 加载后的本体坐标系: **+Z 是火箭头方向, -Z 是发动机喷口方向**(已通过把 quaternion 旋转出的本体 +Z 与发射点 ENU 的 up 方向比较验证)。
所以默认 `axis = "-Z"`, 局部矩阵用 `Matrix3.fromRotationX(180°)` 把 cylinder 默认的 +Z 翻到 -Z, 再沿 -Z 平移 `(tailOffset + length / 2)`。

页面右上角的控制面板提供 `尾焰长度 / 尾焰半径 / 尾部偏移 / 尾喷方向` 4 个滑块/下拉菜单, 方便针对其它模型快速调试。

### 验证

```text
python -m http.server 8000
http://localhost:8000/RocketFlame/rocketFlameShader.html
```

- 起飞 ~250s 后从倾斜后方观察可见橙黄锥形尾焰从 booster 喷口喷出, 颜色由喷口端的暖白过渡到尖端的深红, 透明度沿轴向衰减。
- 火箭随 CZML 姿态翻转时, 尾焰始终贴尾喷口、沿火箭本体 -Z 方向延伸。
- 调小 `尾焰长度` / `尾焰半径` 或修改 `尾部偏移`, 可以让火焰更收紧或更贴近喷口。
