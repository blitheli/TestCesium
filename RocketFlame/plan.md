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
