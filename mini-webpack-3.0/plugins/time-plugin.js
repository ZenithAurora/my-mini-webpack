// plugins/time-plugin.js
class TimePlugin {
  apply(compiler) {
    compiler.hooks.beforeRun.tap('TimePlugin', () => {
      this.startTime = Date.now();
    });
    compiler.hooks.afterCompile.tap('TimePlugin', () => {
      const ms = Date.now() - this.startTime;
      console.log('\x1b[32m%s\x1b[0m', ` 构建完成，耗时 \x1b[1m${ms}ms\x1b[0m`);
    });
  }
}
module.exports = TimePlugin;