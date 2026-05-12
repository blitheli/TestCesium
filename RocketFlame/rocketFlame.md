# RocketFlamePrimitive 说明

`RocketFlamePrimitive` 是一个独立的 Cesium `Primitive` 尾焰控制器，用两片交叉平面
（cross-plane）承载动态火焰材质，并在每帧自动把 primitive 挂到火箭 Entity 或 glTF
节点原点上。

它适合用于：

- 在 CZML / Entity 模型后方叠加独立尾焰效果。
- 将尾焰挂到 glTF 的某个节点原点，例如发动机、喷口或空物体。
- 在一个挂点下生成多个喷口尾焰，例如双发或发动机簇。
- 通过 `setStage()` 做运行时调参，例如长度、半径、偏移、强度、湍流等。

## 核心原理

尾焰由两部分组成：

1. **几何体**
  控制器创建两个 `Cesium.PlaneGeometry`，让它们互相垂直交叉，形成类似 billboard 的
   cross-plane 尾焰体积。每个发动机喷口会生成两片平面。
2. **材质**
  `FLAME_SHADER_SOURCE` 在片元阶段根据纹理坐标 `st`、时间 `time`、湍流、马赫环等参数
   生成透明的发光尾焰。材质使用加法混合，并关闭深度写入，使火焰更接近发光烟羽效果。

最终矩阵关系可以理解为：

```js
primitive.modelMatrix = parentWorldMatrix
geometryInstance.modelMatrix = engineLocalMatrix * crossPlaneMatrix
```

也就是：

```text
世界姿态 = 父对象世界矩阵 * 喷口局部矩阵 * 单片火焰平面矩阵
```

其中 `parentWorldMatrix` 的来源由 `nodeName` 决定。

## nodeName 与坐标基准

`nodeName` 是最重要的挂载参数，它决定火焰使用哪套坐标基准。

### 不提供 nodeName

不传 `nodeName`、传 `null` 或空字符串时，火焰以 `parentEntity` 的
`position/orientation` 作为父矩阵。

此时：

- 火焰原点默认在 **Entity 坐标原点**。
- `localTranslation` 是 Entity 局部坐标下的偏移。
- `cluster.engines` 中的每个 `{ x, y, z }` 也是 Entity 局部坐标下的位置。
- 适合模型没有可用喷口节点，或只需要按实体姿态整体跟随的场景。

示例：

```js
const flame = new RocketFlamePrimitive({
  viewer,
  parentEntity: rocket,
});
```

### 提供 nodeName

传入非空 `nodeName` 时，控制器会查找 `parentEntity` 对应的运行时 `Cesium.Model`，再通过
`model.getNode(nodeName)` 找到 glTF 节点。

此时：

- 火焰原点在 **该 glTF 节点的原点**。
- `primitive.modelMatrix` 使用该节点原点的世界位置和旋转。
- `localTranslation` 是该节点局部坐标下的偏移。
- `cluster.engines` 中的每个 `{ x, y, z }` 也是该节点局部坐标下的位置。
- 节点 articulation 或节点动画生效后，火焰会跟随节点原点更新。

示例：

```js
const flame = new RocketFlamePrimitive({
  viewer,
  parentEntity: rocket,
  nodeName: "Booster",
});
```

如果 `nodeName` 找不到或模型尚未 ready，控制器会临时回退到 Entity 的
`position/orientation`。模型 ready 后会自动切换到节点原点。

## glTF 节点矩阵如何计算

Cesium 渲染 glTF 节点时，不是简单使用：

```text
model.modelMatrix * runtimeNode.computedTransform
```

实际还需要包含 glTF 资产顶层变换、轴向修正和模型缩放：

```text
computedModelMatrix =
  model.modelMatrix
  * components.transform
  * axisCorrectionMatrix
  * computedScale

nodeWorldMatrix =
  computedModelMatrix
  * runtimeNode.computedTransform
```

其中 `axisCorrectionMatrix` 会把 glTF 常见的 `+Y-up` 坐标修正到 Cesium 的 `+Z-up`。
如果漏掉这一步，火焰可能能跟随节点移动，但会相对箭体出现固定方向偏移或旋转错误。

当前实现会基于当前帧的 `model.modelMatrix` 重新计算 `computedModelMatrix`，而不是直接读取
`sceneGraph.computedModelMatrix` 缓存。这样可以避免 Entity 驱动模型高速运动时，缓存矩阵慢一帧
导致火焰相对节点抖动或漂移。

节点矩阵中可能包含缩放。为了避免火焰被模型缩放拉伸，`getModelNodeRigidWorldMatrix()` 会保留
节点原点的世界位置和旋转，同时剥离缩放。

## 自动更新时机

`RocketFlamePrimitive` 构造时会自动注册：

```js
viewer.scene.preRender.addEventListener(...)
```

因此调用方通常不需要手动调用 `rocketFlame.update(time)`。

推荐顺序是：

1. 页面或业务代码在 `scene.postUpdate` 中更新模型 articulation、节点状态或其它业务数据。
2. `RocketFlamePrimitive` 在 `scene.preRender` 中读取最新节点矩阵。
3. Cesium 执行本帧渲染。

销毁时请调用：

```js
rocketFlame.destroy();
```

`destroy()` 会移除 primitive，并解绑内部的 `preRender` 自动更新回调。

## 常用参数

构造参数：

```js
new RocketFlamePrimitive({
  viewer,
  parentEntity,
  nodeName,
  options,
});
```

字段说明：

- `viewer`：必填，当前 `Cesium.Viewer`。
- `parentEntity`：可选，火焰跟随的 Entity。使用 `nodeName` 时也需要它来查找运行时模型。
- `nodeName`：可选，glTF 节点名。提供后火焰挂到该节点原点；不提供则使用 Entity 坐标。
- `options.length`：火焰长度，默认 `60.0`。
- `options.radius`：火焰半径，默认 `5.0`。
- `options.tailOffset`：沿喷射轴方向的整体偏移，默认 `0.0`。
- `options.axis`：喷射方向，支持 `"-X"`、`"+X"`、`"-Y"`、`"+Y"`、`"-Z"`、`"+Z"`，默认 `"-Z"`。
- `options.localTranslation`：共同局部偏移。坐标系取决于 `nodeName`。
- `options.localRotation`：共同局部旋转，类型为 `Cesium.HeadingPitchRoll`。
- `options.cluster.engines`：多喷口位置数组。每项位置坐标系取决于 `nodeName`。
- `options.uniforms`：材质参数，例如强度、湍流、马赫环数量和颜色。

## 单喷口用法

不传 `nodeName` 时，火焰跟随 Entity 坐标：

```js
const rocketFlame = new RocketFlamePrimitive({
  viewer,
  parentEntity: rocket,
  options: {
    axis: "-Z",
    length: 60,
    radius: 5,
    localTranslation: new Cesium.Cartesian3(0, 0, 0),
  },
});
```

这种方式适合先快速挂到火箭整体上，再通过 `localTranslation` 调整到尾部。

## 挂到 glTF 节点原点

如果模型中有喷口、发动机或空物体节点，推荐传入 `nodeName`：

```js
const rocketFlame = new RocketFlamePrimitive({
  viewer,
  parentEntity: rocket,
  nodeName: "Booster",
  options: {
    axis: "-Z",
    length: 60,
    radius: 5,
  },
});
```

此时火焰的 `(0, 0, 0)` 对齐到 `Booster` 节点原点。若喷口不在节点原点上，再使用
`localTranslation` 做小范围微调。

## 多喷口用法

多喷口通过 `options.cluster.engines` 配置：

```js
const rocketFlame = new RocketFlamePrimitive({
  viewer,
  parentEntity: rocket,
  nodeName: "Booster",
  options: {
    axis: "-Z",
    cluster: {
      engines: [
        { x: 1.5, y: 0, z: -15 },
        { x: -1.5, y: 0, z: -15 },
      ],
    },
  },
});
```

这里两个喷口位置都是 `Booster` 节点局部坐标。如果不传 `nodeName`，它们就是 Entity 局部坐标。

运行时也可以替换喷口布局：

```js
rocketFlame.setClusterEngines({
  engines: [
    { x: 0, y: 2.5, z: 0 },
    { x: 0, y: -2.5, z: 0 },
  ],
});
```

## 运行时调参

`FLAME_STAGES` 提供了一组可直接绑定 UI 滑块的 stage：

```js
rocketFlame.setStage("Flame Length", 80);
rocketFlame.setStage("Flame Radius", 4);
rocketFlame.setStage("Flame TailOffset", 3);
rocketFlame.setStage("Flame Intensity", 1.8);
rocketFlame.setStage("Flame LocalZ", -2);
rocketFlame.setStage("Flame RotateX", 15);
```

常用 stage：

- `Flame Length`：火焰长度，会重建 primitive。
- `Flame Radius`：火焰半径，会重建 primitive。
- `Flame TailOffset`：沿喷射轴方向整体移动。
- `Flame LocalX/Y/Z`：局部坐标偏移。
- `Flame RotateX/Y/Z`：局部旋转。
- `Flame Intensity`：亮度强度。
- `Flame Turbulence`：湍流扰动。
- `Flame RingCount`：马赫环数量。
- `Flame RingContrast`：马赫环对比度。
- `Flame Show`：显示或隐藏。

读取当前值：

```js
const length = rocketFlame.getStage("Flame Length");
```

## 与模型 articulation 的关系

火焰本身不是 glTF 的一部分，也不依赖 `AGI_articulations`。它通过读取 Entity 或 glTF 节点的世界
矩阵来跟随模型。

如果 glTF 模型带有 `AGI_articulations`，可以在页面中先调用：

```js
model.setArticulationStage("Booster Yaw", 30);
model.applyArticulations();
```

然后 `RocketFlamePrimitive` 会在 `preRender` 自动读取本帧更新后的节点矩阵。

注意：`setArticulationStage()` 只有在 glTF 模型实际包含 `AGI_articulations` 扩展时才会生效。
如果模型没有该扩展，调用不会改变节点姿态。

## 常见问题

### 火焰原点不在喷口

先确认当前模式：

- 没有 `nodeName`：火焰原点是 Entity 坐标原点。
- 有 `nodeName`：火焰原点是 glTF 节点原点，不一定是网格视觉中心，也不一定是喷口位置。

解决方式：

- 优先在 glTF 中增加喷口挂点空节点，并把 `nodeName` 指向该挂点。
- 或使用 `localTranslation` / `cluster.engines` 做局部偏移。
- 如果已有模型自带 Flame 或 Engine 节点，可以读取这些节点的局部位置作为参考。

### 火焰方向不对

方向由 `options.axis` 控制。传入 `nodeName` 后，`axis` 使用的是该节点局部坐标系。

常见调试方法：

```js
rocketFlame.setAxis("-Z");
rocketFlame.setAxis("-X");
rocketFlame.setAxis("-Y");
```

找到正确方向后，再把默认配置写入页面或构造参数。

### 高速运动时火焰抖动或漂移

火焰更新需要读取当前帧模型矩阵。当前实现已经在 `preRender` 中自动更新，并基于当前
`model.modelMatrix` 重算模型放置矩阵，以避免读取上一帧 `sceneGraph.computedModelMatrix`
导致的滞后。

如果仍然明显抖动，请检查：

- 页面是否还有额外代码手动调用旧的 `rocketFlame.update(time)`。
- 是否在 `preRender` 之后又修改了模型姿态。
- `nodeName` 是否指向了会被动画或其它脚本修改的节点。

### setArticulationStage 没有效果

先确认模型是否真的包含 `AGI_articulations` 扩展。页面侧写了 stage 名称不代表 glTF 资产一定包含该扩展。
如果 glTF 没有该扩展，`model.setArticulationStage()` 不会改变节点。

## 清理资源

页面销毁、切换模型或重新创建尾焰时，调用：

```js
rocketFlame.destroy();
```

这会：

- 从 `viewer.scene.primitives` 移除火焰 primitive。
- 解绑内部 `scene.preRender` 自动更新回调。
- 销毁材质资源。

