const WebSocket = require('ws');
const chokidar = require('chokidar');

class DevServer {
  constructor(compiler) {
    this.compiler = compiler;
    this.wss = null;
  }

  async start(port = 8080) {
    // 首次构建
    await this.compiler.run();

    // 启动 WebSocket 服务
    this.wss = new WebSocket.Server({ port: port + 1 });
    this.wss.on('connection', (ws) => {
      console.log('🔥 HMR client connected');
    });

    // 监听源码变化
    const watcher = chokidar.watch('./src', { ignored: /node_modules/ });
    watcher.on('change', async (filePath) => {
      // 重新编译（简单重新运行整个构建，真实情况应增量编译）
      await this.compiler.run();
      // 通知所有客户端刷新
      this.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'reload' }));
        }
      });
    });

    console.log(`🌐 Dev server running at http://localhost:${port}`);
    console.log(`🔌 WebSocket server at ws://localhost:${port + 1}`);
  }
}

module.exports = DevServer;