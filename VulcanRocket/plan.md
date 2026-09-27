# Vulcan 起飞至入轨

## 目标

在 `VulcanLaunch.html` 里播放一条地固系弹道, 并用 `launchvehicle.glb` 表现 Vulcan 从起飞到上面级工作的过程:

- 助推器与芯一级点火
- 助推器关机, 然后成对分离
- 整流罩分离
- 芯一级 BE-4 关机
- 一二级分离
- 上面级点火 (时序没有给出二级关机, 火焰保持到弹道结束)

## 数据

- 页面: `VulcanRocket/VulcanLaunch.html`
- 弹道: `VulcanRocket/trajectory.js`
- 模型: `https://cesium.com/public/SandcastleSampleData/launchvehicle.glb`
- 时钟: `2026-08-15T00:00:00.000Z` 到 `2026-08-15T00:09:58.0000Z`
- 位置格式: CZML `cartesianVelocity`, `referenceFrame: FIXED`, 每 5 秒一组 `[t, x, y, z, vx, vy, vz]`

结束时间比样本末点早 2 秒, 不改原始速度.

姿态用 `VelocityOrientationProperty`. 本仓库已确认该模型喷口沿本体 -X, 头部沿 +X, 与速度方向一致.

## 时序

| 时刻 | 秒 | 画面 |
| --- | --- | --- |
| T+0:00 | 0 | 助推器火焰与芯一级火焰在 8 秒内点着 |
| T+1:10 | 70 | 最大动压, 只更新说明, 不改模型 |
| T+1:50 | 110 | 助推器火焰在 104 到 110 秒熄灭, 然后三对助推器向外, 向后剥离 |
| T+3:30 | 210 | 两半整流罩绕局部 X 打开, 再分开并后抛 |
| T+4:50 | 290 | 芯一级火焰熄灭 |
| T+4:56 | 296 | `Booster` 与 `InterstageAdapter` 沿局部 -Z 脱离 |
| T+5:02 | 302 | 上面级两台发动机点火, 保持到 T+9:58 |

模型里有 6 枚助推器. 对侧两枚作为一对, 三对从 T+110 秒起每 3 秒开始剥离.

## Articulations

在线模型带 `AGI_articulations`. 时序直接写在 CZML `model.articulations` 里, 键名是「关节名 + 空格 + 阶段名」, `number` 为 `[秒, 值, 秒, 值, ...]`.

- `SRBFlames Size` / `BoosterFlames Size`: 0 到 1 点火, 回到 0 关机
- `SRBs Separate` / `Drop` / `Rotate`: T+1:50 助推器脱离, 随后 `SRBs Size` 收到 0
- `Fairing Open` / `Separate` / `Drop`: T+3:30 抛罩
- `Booster MoveZ` 与 `InterstageAdapter MoveZ`: T+4:56 一二级分离
- `UpperStageFlames Size`: 分离后上面级点火, 保持到弹道结束

## 验证

从仓库根目录执行 `python -m http.server 8000`, 打开 `http://localhost:8000/VulcanRocket/VulcanLaunch.html`.

看这些时刻: T+0:08 双火焰, T+1:50 助推器成对离开, T+3:30 整流罩打开, T+4:50 芯一级火焰消失, T+4:56 芯一级后抛, T+5:08 上面级火焰出现.
