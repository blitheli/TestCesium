# flamePlane 自定义顶点属性 `_DDD`：Blender → glTF → Cesium CustomShader 全流程

本文整理从 Blender 为尾焰网格写入自定义属性、导出 glTF，到在 Cesium `CustomShader` 中读取并区分火焰与其它部位的完整流程与注意事项。

---

## 1. 目标与结论摘要


| 环节                     | 要点                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| **glTF 里叫什么**          | 顶点属性名建议为 `**_DDD`**（以下划线开头的自定义语义，符合 glTF 惯例）。                                                   |
| **导出后在 JSON**          | `primitives[].attributes` 中出现 `"_DDD": <accessor索引>`；accessor 一般为 `**SCALAR` + `FLOAT`（5126）**。 |
| **Cesium shader 里叫什么** | 映射为 `**ddd`**（全小写、去掉首字符下划线）。访问：`vsInput.attributes.ddd`、`fsInput.attributes.ddd`。               |
| **类型**                 | glTF `SCALAR` / float → GLSL `**float`**。                                                       |


**关键结论（必读）：**  
`CustomShader` 挂在**整颗 Model**上，但若着色代码里 **引用**了 `attributes.ddd`，而**某个 primitive 根本没有 `_DDD` 顶点数据**，Cesium 可能对该 primitive **不执行自定义片段逻辑或退回默认**，箭身会继续显示 glTF 原材质——**不会出现**你在 `else` 分支里写的颜色。  
若希望「火焰用 `_DDD` 分支、箭身保持原样」，应在 `**ddd` 判定成功时再改写材质**，其余 `**return`**；若希望箭身也能分支（例如蓝/灰），需要 **所有 primitive 都有 `_DDD`**（箭身顶点统一写 `0`，火焰写 `1`）。

---

## 2. Blender：为 flamePlane mesh 设置 `_DDD`

下列步骤以 **Blender 4.x** 为例；3.6+ 亦可使用「网格属性」思路，界面名称可能略有差异。

### 2.1 命名约定

- glTF **应用程序自定义**顶点属性惯例是使用 **以下划线开头** 的名称（与 Khronos glTF 规范一致）。
- 本文使用 `**_DDD`**；导出后在 glTF `attributes` 中名字保持不变。

### 2.2 仅 flamePlane 对象上有尾焰网格时（推荐单独物体）

若尾焰是独立物体（例如物体名为 `flamePlane`，与仓库 glTF 节点命名一致便于调试）：

1. 选中 **flamePlane** 网格物体，进入 **编辑模式（Tab）**，**全选顶点（A）**。
2. 回到 **物体模式**，打开右侧 **物体数据属性（绿色三角形）→ 几何数据 → 属性（Attributes）**。
3. 点击 **「+」新建属性**：
  - **名称**：`_DDD`（注意大小写；导出后 Cesium 会映射为小写逻辑名 `ddd`）。
  - **领域**：**点（Vertex）**。
  - **数据类型**：**浮点（Float）**（每个顶点一个标量）。
4. 进入 **编辑模式**，仅选中 flamePlane 需要标记的顶点（通常已是全部火焰顶点），打开 **侧边栏（N）→ 条目 → 顶点**，或通过 **网格 → 排序属性 / 指定默认值** 等方式，将该属性在所有选中顶点设为 `**1.0`**（或任意大于阈值如 `0.5` 的值）。
  - 若界面不便批量赋值：可使用下文 **几何节点** 一次性写入常数。

### 2.3 使用几何节点批量写入 `_DDD = 1`（适合整块火焰平面）

在 flamePlane 物体的 **几何节点（Geometry Nodes）** 中：

1. 新建节点：`Mesh Line` / `Plane` 等与当前网格一致的占位，或直接 **「网格 → 传递到几何节点」** 引用原网格。
2. 添加 `**Store Named Attribute`** 节点：
  - **Name**：`_DDD`
  - **Domain**：**Point**
  - **Value**：浮点 `**1.0`**（或 **Combine XYZ** 接到标量端口取决于 Blender 版本对 Socket 的要求；标量属性请确保最终写入 **Float**）。
3. 将输出接到 **「网格」** 输出，并在修饰符栈顶部启用 **几何节点**。
4. **应用**几何节点（Ctrl+A → 可视化网格），或在导出前烘焙为网格，确保导出网格携带属性。

### 2.4 整箭只有一个 mesh、仅局部顶点属于火焰时

在 **编辑模式** 中只选中 **火焰平面相关顶点**，为其 `_DDD` 属性赋值 `**1.0`**；箭身顶点对该属性赋 `**0.0`**，或箭身顶点不参与该属性（见上文「关键结论」——若完全不导出 `_DDD`，Cesium 侧行为可能与非火焰 primitive 一致）。

---

## 3. Blender：导出 glTF / GLB

### 3.1 菜单路径

**文件 → 导出 → glTF 2.0 (.gltf/.glb)**

### 3.2 建议选项（Khronos glTF Blender IO）


| 类别            | 建议                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- |
| **格式**        | `.glb` 便于单文件部署；调试属性可选用 `.gltf` + `.bin` 便于直接打开 JSON。                                               |
| **包含**        | 勾选 **网格（Meshes）**、**材质**、**UV**、**法线**。                                                            |
| **顶点颜色 / 属性** | 确保 **顶点属性（Vertex Colors / Attributes）** 随网格导出（不同版本勾选名称可能为 **Include Attributes** 或归纳在 Geometry 下）。 |
| **变换**        | **应用变换（Apply Modifiers）** 若使用了镜像等修饰符；几何节点建议在导出前应用或确认导出携带评估后网格。                                     |
| **缩放**        | 与 Cesium 中模型单位一致（一般为米）。                                                                            |


导出后用文本编辑器或 VS Code 打开 `.gltf`，或在 `.glb` 用 glTF Viewer / `gltf-transform inspect` 查看 `**meshes[].primitives[].attributes`**。

---

## 4. 在 glTF 中核对 `_DDD`

### 4.1 期望片段示例

```json
"meshes": [
  {
    "primitives": [
      {
        "attributes": {
          "_DDD": 10,
          "POSITION": 11,
          "NORMAL": 12,
          "TEXCOORD_0": 13
        },
        "indices": 14
      }
    ]
  }
]
```

### 4.2 对应 accessor（示例）

```json
{
  "bufferView": 10,
  "componentType": 5126,
  "count": 4,
  "type": "SCALAR"
}
```

含义简述：

- `**componentType` 5126**：IEEE Float。
- `**type` `"SCALAR"`**：每顶点 **一个 float**。
- `**count`**：该 accessor 元素个数（常为顶点数）。

若在浏览器或 Cesium 中读不到属性，优先核对：**导出选项是否包含顶点属性**、名称是否为 `**_DDD`**、火焰 primitive 是否真的挂了该 accessor。

---

## 5. Cesium：`CustomShader` 中的命名与用法

### 5.1 官方映射规则（摘录）

自定义 glTF 属性在着色器中改为 **全小写**，且 **去掉开头的下划线**：


| glTF 属性名                   | `VertexInput` / `FragmentInput` 成员 |
| -------------------------- | ---------------------------------- |
| `_DDD`                     | `**ddd`**                          |
| `_SURFACE_TEMPERATURE`（示例） | `surface_temperature`              |


详见：[Custom Shader Guide - Attributes](https://github.com/CesiumGS/cesium/tree/main/Documentation/CustomShaderGuide)

### 5.2 GLSL 类型

`_DDD` 为 **SCALAR float** 时：

```glsl
float flameTag = vsInput.attributes.ddd;   // vertexShaderText 内
float flameTag = fsInput.attributes.ddd; // fragmentShaderText 内（已顶点插值）
```

### 5.3 最小示例：`fragmentMain` 中分支

```glsl
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float flameTag = fsInput.attributes.ddd;
  if (flameTag > 0.5) {
    material.diffuse = vec3(1.0, 0.0, 0.0);
  } else {
    material.diffuse = vec3(0.0, 0.0, 1.0);
  }
  material.emissive = vec3(0.0);
  material.alpha = 1.0;
  material.specular = vec3(0.0);
  material.roughness = 1.0;
}
```

### 5.4 为何「火焰红了，箭身没变蓝」？

常见原因：

1. **箭身 primitive 没有 `_DDD` accessor**
  Cesium 对缺失属性的 primitive 可能 **跳过自定义片段修改**，箭身仍显示原始 PBR，不会执行上述 `else`。
2. `**MODIFY_MATERIAL` + 贴图**
  即便执行分支，`material.diffuse` 可能与 **baseColor 纹理**、光照混合，观感不一定纯色。
3. **阈值与插值**
  四边形火焰四角 `_DDD` 若不一致，片元会得到插值后的 `flameTag`。

**推荐写法**：只对火焰着色，其余 `**return`** 保留原材质：

```glsl
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float flameTag = fsInput.attributes.ddd;
  if (flameTag <= 0.5) {
    return;
  }
  // 仅火焰：例如尾焰 fbm、改 emissive / alpha 等
}
```

若必须凭 `_DDD` 区分箭身与火焰且两处都要自定义颜色，请在 **Blender 给全部相关顶点写入 `_DDD`**（箭身 `0`，火焰 `1`）。

---

## 6. JavaScript 侧挂载（与仓库页面一致）

```javascript
rocket.model.incrementallyLoadTextures = new Cesium.ConstantProperty(false);
rocket.model.customShader = new Cesium.ConstantProperty(flameCustomShader);

// Model 就绪后同步挂到 Primitive（避免 Entity 路径未生效）
function attachCustomShaderToEntityModel(entity, shader) {
  const wantId = entity.id;
  for (let i = 0; i < viewer.scene.primitives.length; i++) {
    const p = viewer.scene.primitives.get(i);
    if (p instanceof Cesium.Model && p.id && (p.id === entity || p.id.id === wantId)) {
      const apply = () => { p.customShader = shader; };
      if (p.ready) apply(); else p.readyEvent.addEventListener(apply);
      return true;
    }
  }
  return false;
}
```

---

## 7. 与「仅用包围盒裁切 flamePlane」方案对比


| 方案                                            | 优点                  | 缺点                                                |
| --------------------------------------------- | ------------------- | ------------------------------------------------- |
| `**_DDD` 顶点属性**                               | 语义清晰；与几何绑定；可做逐顶点变化。 | 需改 Blender 并重新导出；整模型共享 shader 时注意缺失属性的 primitive。 |
| `**positionMC` + AABB（见 rocketFlameShader3）** | 不改顶点属性；裁切火焰体积。      | 需维护包围盒或与 runtime `boundingSphere` 同步。             |


二者也可组合：`_DDD` 粗筛 + AABB 细调。

---

## 8. 自检清单

- Blender 中 `_DDD` 为 **顶点域、Float 标量**，火焰顶点值为 `**> 0.5`**（或约定阈值）。
- 导出 glTF 中 `**attributes._DDD`** 存在且 accessor 为 `**SCALAR` + FLOAT**。
- Shader 使用 `**ddd`**，类型 `**float`**。
- 若箭身不出现预期颜色：确认箭身 primitive **是否带有 `_DDD`**；不需要改箭身则改用 `**flameTag > 阈值` 后处理，`else return**`。
- Cesium 版本支持 Model `CustomShader`（本项目示例 **1.138**）。

---

## 9. 参考链接

- [CustomShader - Cesium JS API](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html)
- [Custom Shader Guide（GitHub）](https://github.com/CesiumGS/cesium/tree/main/Documentation/CustomShaderGuide)
- [glTF 2.0 Specification - Meshes](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

仓库内相关页面：`RocketFlame/rocketFlameShader4.html`、`RocketFlame/rocketFlameShader3.html`、`RocketFlame/plan.md`。