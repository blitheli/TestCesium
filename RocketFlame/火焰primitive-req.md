火焰更改需求

- rocketFlameShader.html里FlamePrimitive的代码单独移植到rocketFlame.js文件,便于后续和其它模型记载
- rocketFlame.js要求
    - 需要包含火焰的长度，半径等其它效果的参数设置
    - 具备设置火焰顶部x,y,z位移和旋转的能力
    - 设定火焰的大小、show开关
    - 获取或设定父对象（例如当前的rocket)的位置和姿态，便于火焰为父对象的一部分
- 在Cesium原生的model函数中，通过articulations和setArticulationStage函数等方式可对火焰部分进行
参数设置，那么我当前采用的单独primitive方式是否合理？如何能够方便的设置和父对象成为一体，又具备类似articulations
的方式设置火焰的大小等参数？我个人认为采用独立的primitive方式方便对火焰的着色器效果进行修改。
