# 月球 3D Tiles

## 目标

做一个 CesiumJS 1.140 的月球 3D Tiles 具体页面: 加载 Cesium Moon, 相机落到月面, 而不是地球地形加 OSM 建筑.

## 数据

Cesium Moon, ion asset `2684829`. 来源是 NASA LRO 影像和地形, 官方说明见 [Cesium Moon](https://cesium.com/platform/cesium-ion/content/cesium-moon/).

| 区域 | 影像 | 地形 |
| --- | --- | --- |
| 60S-60N | 约 100 m | 约 59 m |
| 85.5S-90S, 85.5N-90N | 约 1 m | 极区最高约 5 m |

因此页面默认飞到南极 Shackleton, 这里能看出 3D Tiles 的地形. Apollo 11 静海作为中纬度对照, 坐标取自 Cesium 1.140 `Ellipsoid` 文档里的示例: 经度 23.47315, 纬度 0.67416.

文档示例写成了 `Cartesian3.fromRadians(0.67416, 23.47315)`. 这两个数是角度, 而且经纬度顺序反了. 页面使用 `Cartesian3.fromDegrees(longitude, latitude, height, Ellipsoid.MOON)`.

## 关键 API

- `Ellipsoid.MOON`: 月球平均半径的球体. `Ellipsoid.default` 要在 `new Viewer` 之前赋值, `fromDegrees` 才会按月球半径算直角坐标.
- `Viewer` 的 `ellipsoid: Ellipsoid.MOON`: 1.140 场景椭球.
- `globe: false`: Cesium Moon 是全球 3D Tiles, 不能再叠地球椭球. 官方说明同时关掉 `sceneModePicker`, `baseLayerPicker`, `geocoder`. `globe: false` 时天空大气默认隐藏.
- `Cesium3DTileset.fromIonAssetId(2684829)`: 按 ion 资源号创建 tileset, 再 `scene.primitives.add`.
- 非 WGS84 时 Viewer 不会自动加星空, 所以显式传入 `SkyBox`, 纹理用 Cesium 自带 `Assets/Textures/SkyBox/tycho2t3_80_*.jpg`.
- `scene.moon.show = false`: 人已经在月球上, 不再画天空里的月球贴图.
- 拾取用 `scene.pickPosition`, 再用 `Ellipsoid.MOON.cartesianToCartographic` 转经纬度. 不能用地球椭球, 否则高度会差几千公里.

## 相机

| 按钮 | 经度, 纬度, 高度 | 朝向 |
| --- | --- | --- |
| Shackleton | 129.78, -89.25, 10000 m | heading 180, pitch -12, 看向坑心 -89.67 的受光坑沿 |
| Apollo 11 | 23.47315, 0.25, 15000 m | heading 0, pitch -45, 看向登陆点 0.67416 |
| 全月 | 0, 0, 5000000 m | pitch -90 |

Home 按钮改到 Shackleton. 瓦片根节点先在全月视角加载, `initialTilesLoaded` 后再飞入, 避免一打开就停在高分辨率空白处.

## 截图

「截图」只保存 `viewer.canvas`, 不含左侧 HTML 面板. WebGL 默认画完一帧会清空缓冲, 所以 Viewer 打开 `contextOptions.webgl.preserveDrawingBuffer`, 并在下一次 `scene.postRender` 里调用 `canvas.toDataURL("image/png")` 再下载.

## 验证

`python -m http.server 8000`, 打开 `Moon3DTiles/moon3dtiles.html`.

- 全月网格出现后飞到 Shackleton, 能看到环形山.
- 点 Apollo 11, 落在静海, 分辨率明显更粗.
- 鼠标移动时经纬度落在月面附近, 高度是相对月球椭球的米, 不是地球高程.
- 若 ion 账号没有 asset 2684829, 面板显示加载失败. 需要在 Cesium ion Asset Depot 把 Cesium Moon 加进当前 token 的账号.
