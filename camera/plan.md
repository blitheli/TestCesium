# 500 km SSO 相机像面

## 目标

在浏览器里复现 `extract_fov_tiles.py --mode image`: 矩形透视相机与 WGS84 椭球求交, 把 XYZ/TMS 瓦片重采样成一张透视照片. 这不是光照或大气渲染.

默认场景是一颗高度 500 km 的太阳同步圆轨道卫星, 相机对地 (天底). 卫星随 Cesium 时间运动, 可定格位置后再拍照.

## 轨道根数

圆轨道地心半径取 WGS84 半长轴加测地高. 赤道上测地高等于 500 km. 高纬因椭球扁率, 测地高会略大, 这是地心圆轨道的结果, 不是另设一条等高轨道.

常数:

- `a = 6378137 + 500000 = 6878137 m`
- `e = 0`
- `mu = 3.986004418e14 m^3/s^2` (WGS84 GM)
- `J2 = 1.08262668355e-3`
- 平均太阳角运动 `n_sun = 2*pi / (365.2421897 * 86400)`

J2 升交点进动 (e = 0):

```
n = sqrt(mu / a^3)
dOmega/dt = -1.5 * n * J2 * (Re/a)^2 * cos(i)
```

令 `dOmega/dt = n_sun`, 得

```
cos(i) = - n_sun / (1.5 * n * J2 * (Re/a)^2)
i = 97.40180772°
```

核对: 代回后的进动是 `0.98564736 °/天`, 与 `360/365.2421897` 一致.

其他根数:

- 历元 `2026-03-21T00:00:00Z` (JD 2461120.5)
- 历元纬度幅角 `u0 = 0` (升交点)
- 近地点幅角无定义, 取 0
- 周期 `5676.978 s` (94.616 min)
- 平均运动 `n = 0.00110678345 rad/s`

LTAN 10:30 用太阳赤经定义, 不用钟面 `UTC + 经度/15` (两者差一个时差方程):

```
alpha = 低精度太阳赤经 (平黄经 + 中心差, 再投影到赤道)
Omega0 = alpha(历元) - 22.5°
```

22.5° 是 12:00 与 10:30 的 1.5 小时. 算得 `Omega0 = 337.855607°`. 历元 LTAN 精确为 10:30.

之后 `Omega(t) = Omega0 + n_sun * (t - t0)`, 与平均太阳一起走. 用真太阳赤经回算时, 1 天后约 10:30:18, 365 天后回到约 10:30. 季节偏差来自赤经速率不等于平黄经速率, 年平均仍是太阳同步.

ECI 到 ECEF 用 IAU 1982 GMST (与 Cesium `computeTemeToPseudoFixedMatrix` 同一类近似), 不含极移. 页面时间轴跨 2 天, 进动一直开着.

## 相机模型

与 Cesium `Camera.setView` 一致, 也与 Python `camera_axes_from_hpr` 一致:

- `direction = -Z`, `up = +Y`, `right = +X`
- heading 0 朝北, pitch 0 望当地地平线, pitch -90 为天底, roll 绕视线
- 先在 ENU 上用 `heading - pi/2`, 再 `Rz(-h) Ry(-p) Rx(roll)`

JSON 里同时有 `direction` 与 `up` (或 `right`) 时, 用向量重正交化, 不再用 HPR 重算. 导出类型为 `astrox-sensor-camera`, 含大地坐标, ECEF, direction/up/right, HPR (度), hfov/vfov, `fovUnit: "deg"`.

视线:

```
u, v ∈ [-1, 1]
dir = normalize(direction + u*tan(hfov/2)*right + v*tan(vfov/2)*up)
```

像素 `(i, j)` (第 0 行在上) 取像素中心: `u = (i+0.5)/W*2-1`, `v = 1-(j+0.5)/H*2`.

默认水平视场 8°, 阵列 256 x 192, 像元 10 µm, 所以垂直视场约 6.004°. 姿态 heading 0, pitch -90, roll 0. 航向沿轨只是可选按钮, 默认不把像面转到速度方向.

## 定尺与重采样

未给宽高时:

```
W = round(2 * range * tan(hfov/2) / resolution)
H = round(2 * range * tan(vfov/2) / resolution)
```

`range` 是光轴与椭球的交距. 天底时等于测地高. `round` 用 Python 3 的银行家舍入. 这个尺寸在垂直于视线的切平面上, 侧视时地面 GSD 更粗, 并写入 manifest 的 `sizingPlaneGsdMeters` 与 `centerGroundGsdMeters`.

库函数在只给地面分辨率, 不给宽高时, 仍按切平面定尺, 供和 Python 对照:

```
W = round(2 * range * tan(hfov/2) / resolution)
H = round(2 * range * tan(vfov/2) / resolution)
```

页面不再用这个反推像素数. 照片宽高就是探测器阵列. 上面的 resolution 只作为瓦片级别的输入, 页面传入的是 `H * IFOV`. 长边超过 1024 直接拒绝, 不缩小阵列, 也不另设焦距.

瓦片级别用 `zoom_for_resolution`: 选不粗于目标分辨率的最小级别. EPSG:4326 的 0 级是 2 x 1 张瓦片, Y 自上而下为 XYZ. TMS 只在请求 URL 时翻转 Y.

每个输出像素求交后, 到拼接画布上双线性采样. 没命中椭球的像素 alpha 为 0. 瓦片失败也留空, 并写进 `failedTiles`. manifest 字段与 Python `extract_image_plane` 对齐 (相机, 尺寸, 斜距, 两种 GSD, zoom, 瓦片清单, 命中比例等).

EPSG:4326 的画布坐标与 Python 一致, 宽视场抽样像素逐值相同. EPSG:3857 的拼接范围单位是米. Python 在换算墨卡托之前用 `floor((lon - west) / 360)` 展开经度, `west` 却是米, 采样会落到画布外, 照片全透明. 页面先把西边界换成经度 `west / Re * 180/pi` (反子午线外可以小于 -180) 再展开. 4326 不走这条分支.

脚印用视场四边的交点, 经度按相邻点展开, 避免 180° 跳变.

## 页面

- `camera.html` 从仓库根目录 `CesiumTemplate.html` 起: CesiumJS 1.140 CDN, 沿用仓库已有的 Ion token.
- 创建 Viewer 之后设置 `viewer.resolutionScale = 2.0`, 让地球画面按 2 倍分辨率绘制. 这只影响 Cesium 视口, 不改变探测器阵列的输出像素数.
- 不用世界地形. 求交在椭球上, 地形会让脚印和求交看起来不一致.
- 画出卫星 (示意球体, 不是真实尺寸), 2 天的轨道和星下点轨, 以及当前这一圈的高亮. 矩形近像面, 四条角射线, 星下点连线和地面脚印跟相机走.
- 底图来自 `viewer.imageryLayers`. 默认不加载 Ion 全球影像 (`baseLayer: false`), 因为这个 token 请求 asset 2 会 404. 启动时有两层可选: 程序化经纬色块 (Geographic, 默认选中) 和经纬网格. 下拉框选中哪一层, 地球就只显示那一层.
- 拍照调用选中层 `imageryProvider.requestImage(x, y, level)`, 和地球用的是同一个 provider. 切片方案由 0 级瓦片数决定: 2x1 为 EPSG:4326, 1x1 为 EPSG:3857. 级别夹在该层的 minimumLevel 和 maximumLevel 之间. 某层 404, 超时或 CORS 时只报错, 不改去画另一层.
- URL 输入用来新增一个 `UrlTemplateImageryProvider` 并立刻选中. `{y}` 在 TMS 下换成 Cesium 的 `{reverseY}`. 它不是拍照的旁路.
- 跟随相机默认打开. 拖动地球会关掉跟随.
- 定格只冻结相机的大地位置, 时间继续走, 姿态仍可改. 拍照使用定格位置 (若有) 和当前 HPR.
- 侧视按钮按当前位置搜索 pitch, 使视场上边缘 (`v = +1`) 落在地平线外, 下边缘和光轴仍打到椭球.
- 程序化经纬色块是一个 ImageryProvider: 0.2° 棋盘, 1° 经纬网, 赤道和本初子午线另色. 地球和照片都走它的 `requestImage`. 经纬网格是另一层, 选中后照片应变成网格而不是色块.

## 验证

`python -m http.server 8000`, 打开 `camera/camera.html`.

不打开页面时:

```
node camera/selftest.mjs
```

自检覆盖瓦片计数, 射线-椭球, 天底与朝北标架, SSO 根数和 LTAN, JSON 向量优先于 HPR, 程序化瓦片上的 70x52 天底片, 侧视上边缘透明, 换影像层后中心像素跟着变, 焦距只由阵列, 像元尺寸和 hfov 决定, 以及 Matrix4 标架与默认 5000 x 5000 的自动选级. 不一致的 f 会被拒绝.

## 独立拍照接口

`camera/capture.js` 的 `captureImagePlane` 不读取 Viewer. 场景仿真可以直接调用. 演示页把当前影像层翻译成 `imagery` 后再调它, 页面默认阵列仍是 256 x 192, 长边上限仍是 1024.

```javascript
captureImagePlane({
  sensorToFixed,          // Matrix4, 列主序 16 数或 Cesium.Matrix4
  hfov,                   // 水平全视场, hfovUnit 默认 deg
  width: 5000,            // 阵列宽, 像素
  height: 5000,           // 阵列高, 像素
  pixelPitchMeters,       // 可选. 不给就不算焦距
  imagery: {
    url,                  // XYZ/TMS, {z}{x}{y}; TMS 用 {reverseY} 或 scheme: "tms"
    projection,           // "geodetic" 或 "webmercator"
    tileSize, minZoom, maxZoom, scheme,
    requestTile           // 可选. 演示页用它包装当前 ImageryProvider
  },
  planOnly: false
})
```

Matrix4 标架: 列 0 = right (+X), 列 1 = up (+Y), 列 2 = -direction (传感器 +Z), 平移 = 传感器原点.

`vfov = 2*atan(tan(hfov/2) * height/width)`. 输出照片宽高等于阵列. 斜距 H 仍是光轴与 WGS84 椭球的闭式交距. `IFOV = 视场角 / 该边像素数`, `GSD = H * IFOV`, `幅宽 = 2*H*tan(FOV/2)`. 瓦片级别是 `zoomForResolution(GSD, srs, lat, tileSize, minZoom, maxZoom)`, 不另给地面分辨率.

返回 `pixels` (RGBA), `footprint` (GeoJSON) 和 `manifest`. `planOnly: true` 只返回选级, 不分配像面. 模块默认 `maxTiles` 4096, 拼接画布上限 12288 x 12288 像素, 阵列长边上限 8192. 超过就报错, 并写出已选 zoom 和瓦片数, 不降低级别.

与 Python `extract_fov_tiles.py` 对过若干姿态: direction/up/right 到 1e-12, 像素交点经纬度到 1e-8, 定尺和中心地面 GSD 一致. 宽视场 lon/lat 色带的抽样像素与 Python 输出逐值相同.

## 探测器三参数

理想针孔, 没有辐射, 噪声或衍射. 页面只接受三件事:

- 阵列像素数, 默认 256 x 192
- 像元尺寸 d, 默认 10 µm
- 水平视场 hfov, 默认 8°

由此推出, 不再另给输入:

- 焦平面 = 像素数 x d. 默认 2.560 mm x 1.920 mm
- 垂直视场 `vfov = 2*atan(tan(hfov/2) * H/W)`, 使水平焦距和垂直焦距相同
- `f = (焦平面宽) / (2*tan(hfov/2))`
- `IFOV ≈ 该边视场角 / 该边像素数`
- 拍照时的斜距 H 来自光轴与椭球的交距. `GSD ≈ H * IFOV`, `幅宽 = 2*H*tan(FOV/2)`

输出照片的宽高就是阵列像素数, 不再用地面分辨率反推像素数. 推导出的水平 GSD 只用来选瓦片级别. 阵列长边超过 1024 会直接拒绝.

导出的 `astrox-sensor-camera` 仍带原来的 hfov, vfov, 姿态和向量, Python 工具可以忽略不认识的字段. 另外增加可选 `detector`: 阵列, d, 焦平面, f, IFOV. 若 JSON 里的 `detector.focalLengthMeters` 和这三项不一致, 读取时拒绝, 不会拿这个 f 去改视场.

与 Python `extract_fov_tiles.py` 对过若干姿态: direction/up/right 到 1e-12, 像素交点经纬度到 1e-8, 定尺和中心地面 GSD 一致. 宽视场 lon/lat 色带的抽样像素与 Python 输出逐值相同.
