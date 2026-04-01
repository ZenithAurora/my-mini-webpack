// compiler.js - 编译器 & 钩子系统

const fs = require('fs');
const path = require('path');

// ======================== Hook（简易 Tapable） ========================

class Hook {
  constructor() { this.taps = []; }
  tap(_, fn) { this.taps.push(fn); }
  call(...args) { this.taps.forEach(fn => fn(...args)); }
}

// ======================== Compiler ========================

class Compiler {
  constructor(config, buildSteps) {
    this.config = config;
    this.buildSteps = buildSteps;

    // 生命周期钩子
    this.hooks = {
      beforeRun: new Hook(),     // 构建开始前
      afterCompile: new Hook(),  // 编译完成后
      emit: new Hook(),          // 输出文件前
      done: new Hook(),          // 全部完成
    };

    // 注册插件
    (config.plugins || []).forEach(plugin => plugin.apply(this));
  }

  async run() {
    // 1. 构建前
    this.hooks.beforeRun.call(this);

    // 2. 构建依赖图 → TreeShaking → 压缩 → 分 chunk → 打包
    const graph = this.buildSteps.buildGraph(this.config.entry, this.config.module.rules);
    this.buildSteps.treeShake(graph);
    const optimizedGraph = await this.buildSteps.optimizeGraph(graph, this.config.mode);
    const chunks = this.buildSteps.createChunks(optimizedGraph);
    const bundleCode = this.buildSteps.bundle(chunks);

    // 3. 编译完成
    this.hooks.afterCompile.call(this);

    // 4. 输出文件
    this.hooks.emit.call(this);
    if (bundleCode) {
      const { path: outputPath, filename } = this.config.output;
      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(path.join(outputPath, filename), bundleCode);
    }

    // 5. 全部完成
    this.hooks.done.call(this);
  }
}

module.exports = Compiler;
