# Mini-Webpack 3.0

从零手写的 Webpack 核心实现，在 2.0 的基础上新增了 **开发服务器（Dev Server）**、**热更新（HMR）** 和 **HTML 插件**。

## 项目结构

```
mini-webpack-3.0/
├── mini-webpack.js          # 核心：模块解析、依赖图构建、Tree Shaking、打包、CLI
├── compiler.js              # 编译器：生命周期钩子系统 + 构建流程编排
├── dev-server.js            # 开发服务器：文件监听 + WebSocket 热更新
├── webpack.config.js        # 用户配置
├── loaders/
│   └── css-loader.js        # CSS Loader：将 CSS 转为 JS 注入 <style> 标签
├── plugins/
│   ├── html-plugin.js       # HTML 插件：自动生成 index.html 并注入 script
│   └── time-plugin.js       # 计时插件：统计构建耗时
└── src/                     # 示例源码
    ├── main.js              # 入口文件
    ├── info.js              # 导入 const.js 并导出字符串
    ├── const.js             # 导出 name、version、noUsedFunc
    ├── style.css            # 样式文件
    └── rubbish.js           # 未被引用的死代码模块
```



## Webpack 热更新（HMR）原理

### 整体架构

Webpack HMR（Hot Module Replacement）的核心思想是：**在应用运行过程中，替换、添加或删除模块，而无需刷新整个页面**。这需要 Dev Server 和浏览器端运行时协作完成。

```bash
┌─────────────┐    WebSocket      ┌───────────────────┐
│  Dev Server  │ ◄─────────────►  │ 浏览器 HMR Runtime │
│  (webpack-   │                  │  (打包进 bundle)   │
│   dev-server)│                  │                    │
└──────┬───────┘                  └─────────┬──────────┘
       │                                    │
       │  文件变化                           │  模块热替换
  编译变更模块                           更新模块缓存
  生成 hot update manifest                执行 accept 回调
  推送 hash + changed modules
```

### 详细流程

#### 1. 文件监听与增量编译

- Dev Server 监听文件系统变化（webpack 4 用 `watchpack`，webpack 5 内置了基于操作系统的原生监听）
- 文件变化后，**不是全量重新构建**，而是进行**增量编译（Incremental Compilation）**
- Webpack 维护了一个内存中的模块图（Module Graph），只重新编译受影响的模块及其下游依赖
- 增量编译依赖 Webpack 的缓存机制（Memory Cache / File System Cache），未变更的模块直接从缓存读取

#### 2. 生成更新清单

编译完成后，Webpack 生成两个关键产物：

- **manifest（更新清单）**：包含本次更新的 hash、变更的模块列表、各模块的 chunk ID
- **hot-update chunk 文件**：仅包含变更模块的新代码，文件名格式为 `[hash].hot-update.json`（manifest）和 `[id].[hash].hot-update.js`（模块代码）

#### 3. 通知浏览器

Dev Server 通过以下方式将更新信息推送到浏览器：

- **WebSocket**：向所有连接的客户端发送当前编译的 `hash` 值
- 浏览器端 HMR Runtime 收到新 hash 后，依次发起 HTTP 请求：
  - 请求 `hot-update.json` 获取变更模块列表
  - 请求对应的 `hot-update.js` 获取新模块代码

> 历史上 webpack-dev-server 早期使用过 jsonp 和 iframe 方式，目前主流版本统一使用 WebSocket + HTTP 懒加载。

#### 4. 模块热替换（核心步骤）

浏览器端 HMR Runtime 收到新模块代码后，执行以下逻辑：

**a) 旧模块卸载**

- 检查旧模块是否注册了 `module.hot.dispose` 回调
- 如果有，执行 dispose 回调（用于清理副作用：移除事件监听器、清除定时器等）
- 将旧模块从 `__webpack_modules__` 缓存中移除

**b) 新模块安装**

- 将新模块代码写入 `__webpack_modules__` 缓存（键为 module ID）
- 执行新模块代码，得到新的 `exports`

**c) 冒泡 accept 检查（向上传播）**

- 从变更模块开始，检查该模块是否调用了 `module.hot.accept(callback)`：
  - **如果 accept 了**：执行 accept 回调，将新 `exports` 传递给它，开发者自行处理 UI 更新。替换过程结束。
  - **如果没有 accept**：向上冒泡到该模块的父模块（导入者），检查父模块是否 accept
  - **如果冒泡到入口模块仍未被 accept**：说明无法安全地局部更新，执行 fallback —— 整个页面刷新（`location.reload()`）

```
模块 C 变更
  → C 没有声明 accept，冒泡到 B
    → B 没有声明 accept，冒泡到 A（入口）
      → A 也没有 accept → 整个页面刷新
```

```
模块 C 变更
  → C 没有声明 accept，冒泡到 B
    → B 声明了 module.hot.accept('./C', callback) → 执行 callback，局部更新
```

#### 5. 错误处理

- 如果热替换过程中出现运行时错误，Webpack 会保留旧模块的代码继续运行
- 控制台会显示错误信息，并在下次成功更新后自动恢复

### 开发者使用 HMR 的方式

```js
// 顶层：无条件 accept（冒泡到此即停止）
if (module.hot) {
  module.hot.accept();
}

// 精确 accept：指定哪个模块变化时需要处理
if (module.hot) {
  module.hot.accept('./component.js', () => {
    const newComponent = require('./component.js');
    render(newComponent);  // 手动重新渲染
  });
}

// 清理副作用
if (module.hot) {
  module.hot.dispose(() => {
    clearInterval(timer);
    window.removeEventListener('resize', onResize);
  });
}
```

---



## 核心总结：

HMR 的本质就是一件事：**用新模块代码替换旧模块代码，尽量不刷新页面**。整个机制分两端、四个步骤。

### 两端协作

- **服务端（Dev Server）**：负责发现变化、编译变化、通知变化
- **浏览器端（HMR Runtime）**：负责拉取更新、替换模块、决定是否刷新

### 四步流程

**第一步：监听 + 增量编译**

文件一改，Dev Server 不是从头编译所有模块，而是只重新编译**变化的模块和它的下游依赖**，其余模块直接用缓存。编译完后根据变更内容算出一个新的 **Hash**，作为这次更新的版本号。

**第二步：生成更新清单**

Webpack 在内存中生成两个东西：
- 一个 JSON 清单（manifest），记录这次 Hash 是什么、哪些模块ID变了
- 每个变更模块对应一份新代码文件

这两个东西都不写磁盘，只在内存中，等浏览器来拿。

**第三步：推通知 + 拉代码**

Dev Server 通过 **WebSocket** 给浏览器发一条很轻的消息，只包含新 Hash。浏览器 HMR Runtime 收到后，知道"有更新了"，再通过 **HTTP 请求** 去拉清单和新模块代码。之所以不用 WebSocket 直接发代码，是因为代码量大，WebSocket 保持长连接只适合传轻量信号，具体数据走 HTTP 更合理。

**第四步：替换 + 冒泡**

浏览器拿到新模块代码后：
1. 先调旧模块的 `dispose` 清理副作用（定时器、事件监听等）
2. 把新代码写入模块缓存
3. 从变更模块开始**往上冒泡**问："你能接受这个变化吗？"（即 `module.hot.accept`）
   - 有人接（accept）→ 执行回调，局部更新，完事
   - 没人接，一路问到入口模块都没人管 → 没办法安全替换，整页刷新

### 一句话串起来

```
文件改了 → 只编变的模块 → 算个Hash → WebSocket告诉浏览器 → 浏览器HTTP拉新代码 → 替换旧模块 → 有人accept就局部更新，没人管就刷新页面
```
