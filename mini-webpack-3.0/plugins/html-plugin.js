const fs = require('fs');
const path = require('path');

class HtmlPlugin {
  constructor(options = {}) {
    this.template = options.template || null;
    this.filename = options.filename || 'index.html';
  }

  apply(compiler) {
    // 在 emit 钩子（输出文件前）生成 HTML
    compiler.hooks.emit.tap('HtmlPlugin', () => {
      let html = '';
      if (this.template && fs.existsSync(this.template)) {
        html = fs.readFileSync(this.template, 'utf-8');
      } else {
        // 默认模板
        html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>My App</title></head>
<body>
  <div id="app"></div>
  <script src="${compiler.config.output.filename}"></script>
</body>
</html>`;
      }
      // 确保输出目录存在
      const outputPath = compiler.config.output.path;
      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(path.join(outputPath, this.filename), html);
      console.log(`📄 Generated ${this.filename}`);
    });
  }
}

module.exports = HtmlPlugin;