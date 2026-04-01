const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const babel = require('@babel/core');

function loadConfig(configPath = './webpack.config.js') {
  const configFile = path.resolve(configPath);
  return require(configFile);
}

function runLoaders(filePath, source, rules) {
  const rule = rules.find(r => r.test.test(filePath));
  if (!rule) return source;

  const loaders = Array.isArray(rule.use) ? rule.use : [rule.use];

  return loaders.reverse().reduce((result, loader) => {
    const loaderPath = path.resolve('./loaders', loader + '.js');
    const loaderFn = require(loaderPath);
    return loaderFn(result);
  }, source);
}

function parseModule(filePath, ID) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const config = loadConfig();
  const rules = config.module.rules;
  content = runLoaders(filePath, content, rules);
  const ast = parser.parse(content, { sourceType: 'module' });
  const dependencies = [];
  traverse(ast, {
    ImportDeclaration({ node }) {
      dependencies.push(node.source.value);
    },
  });
  const { code } = babel.transformFromAstSync(ast, null, { presets: ['@babel/preset-env'] });
  return { ID, filePath, dependencies, code, mapping: {} };
}

function buildGraph(entryPath, rules) {
  let ID = 0;
  const entryModule = parseModule(entryPath, ID++, rules);
  const graph = [entryModule];

  for (const module of graph) {
    const dirname = path.dirname(module.filePath)
    module.mapping = {}
    module.dependencies.forEach((dependencyFilePath) => {
      const absolutePath = path.join(dirname, dependencyFilePath)
      const childModule = parseModule(absolutePath, ID, rules)
      module.mapping[dependencyFilePath] = ID
      graph.push(childModule)
      ID++
    })
  }
  return graph;
}

function createChunks(graph) {
  const mainChunk = {
    id: 0,
    name: 'main',
    modules: graph,
    async: false
  };
  return [mainChunk];
}

function treeShake(graph) {
  const allSource = graph.map(m => m.filePath.endsWith('.js') ? fs.readFileSync(m.filePath, 'utf-8') : '').join('\n');
  const usedNames = new Set();
  for (const m of allSource.matchAll(/import\s*(?:\{([^}]+)\}|(\w+))\s+from/g)) {
    (m[1] ? m[1].split(',') : [m[2]]).forEach(n => usedNames.add(n.trim()));
  }

  const exportRe = /^export\s+(?:const|let|var|function|class)\s+(\w+)[^\n]*/gm;
  graph.forEach(mod => {
    if (!mod.filePath.endsWith('.js')) return;
    const source = fs.readFileSync(mod.filePath, 'utf-8');
    const newSource = source.replace(exportRe, (_, name) => usedNames.has(name) ? _ : '');
    if (newSource !== source) {
      mod.code = babel.transformFromAstSync(parser.parse(newSource, { sourceType: 'module' }), null, { presets: ['@babel/preset-env'] }).code;
    }
  });
  return graph;
}

async function optimizeGraph(graph, mode) {
  if (mode === 'production') {
    const { minify } = require('terser');
    for (const module of graph) {
      const result = await minify(module.code);
      module.code = result.code;
    }
  }
  return graph;
}

const Compiler = require('./compiler');

function bundle(chunks) {
  let modules = '';
  const chunk = chunks[0];

  chunk.modules.forEach(mod => {
    modules += `
      ${mod.ID}: [
        function(require, module, exports) {${mod.code} },
        ${JSON.stringify(mod.mapping)}
      ],
    `;
  });

  // HMR 客户端代码（页面刷新）
  /**
   * 说明：为了极简，这里直接让页面刷新，实现了“自动刷新”的效果
   * 这已经足够演示热更新的基本思想。
   * 真正的 HMR 会替换模块而不刷新，但实现更复杂，不在此展开
   */
  const hmrRuntime = `
    if (typeof window !== 'undefined') {
      const ws = new WebSocket('ws://localhost:8081');
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'reload') {
          console.log('🔥 HMR: reloading page...');
          window.location.reload();
        }
      };
    }
  `;

  return `
    (function(modules) {
        function require(id) {
            const [fn, mapping] = modules[id];
            function localRequire(relativePath) {
                return require(mapping[relativePath]);
            }
            const module = { exports: {} };
            fn(localRequire, module, module.exports);
            return module.exports;
        }
        require(0);
    })({${modules}})
    ${hmrRuntime}
  `;
}

async function build () {
  const config = loadConfig();
  const compiler = new Compiler(config, { buildGraph, treeShake, optimizeGraph, createChunks, bundle });
  await compiler.run();
};


// mini-webpack 服务启动
const args = process.argv.slice(2);
if (args.includes('serve')) {
  const DevServer = require('./dev-server');
  (async () => {
    const config = loadConfig();
    const Compiler = require('./compiler');
    const compiler = new Compiler(config, { buildGraph, treeShake, optimizeGraph, createChunks, bundle });
    const server = new DevServer(compiler);
    await server.start();
  })();
} else {
  build();
}
