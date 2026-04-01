const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const babel = require('@babel/core');


// 读取用户配置
function loadConfig(configPath = './webpack.config.js') {
  const configFile = path.resolve(configPath);
  return require(configFile);
}

// loader翻译器
function runLoaders(filePath, source, rules) {
  // 找到匹配的 loader 规则
  const rule = rules.find(r => r.test.test(filePath));
  if (!rule) return source;

  // 处理 loader 数组
  const loaders = Array.isArray(rule.use) ? rule.use : [rule.use];

  // 从右向左执行 loader  因为 loader 的处理是管道式的，后写的 loader 先拿到原始内容，前写的 loader 后处理。
  return loaders.reverse().reduce((result, loader) => {
    const loaderPath = path.resolve('./loaders', loader + '.js');
    const loaderFn = require(loaderPath);
    return loaderFn(result);
  }, source);
}

// 解析模块
function parseModule(filePath, ID) {
  let content = fs.readFileSync(filePath, 'utf-8'); 			        // 读取文件
  const config = loadConfig();                                    // 读取用户配置
  const rules = config.module.rules;                              // 读取用户配置的loader规则
  content = runLoaders(filePath, content, rules);                 // 执行loader翻译器
  const ast = parser.parse(content, { sourceType: 'module' }); 	  // 转AST
  const dependencies = [];  		                                  // 收集依赖
  traverse(ast, {
    ImportDeclaration({ node }) {
      dependencies.push(node.source.value);
    },
  });
  const { code } = babel.transformFromAstSync(ast, null, { presets: ['@babel/preset-env'] }); // 转ES5
  return { ID, filePath, dependencies, code, mapping: {} };
}


// 构建依赖图
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


// 模块合并和代码分割
function createChunks(graph) {
  /**
   * 真实场景下，这里会根据入口数量、splitChunks 配置生成多个 chunk
   *  比如：
   *  entry: { main: './src/index.js', another: './src/another.js' }
   *  那么就会生成两个 chunk：main 和 another
   *
   * 本示例简化：所有模块放入主 chunk
   */
  const mainChunk = {
    id: 0,
    name: 'main',
    modules: graph,   // 所有模块
    async: false
  };
  return [mainChunk];
}

// 测试一下：
// const config = loadConfig();
// const rules = config.rules;
// const graph = buildGraph(config.entry, rules);
// const chunks = createChunks(graph);
// console.log(chunks);


// TreeShaking + 优化压缩
// 注：真实 Webpack 基于 AST 精确分析作用域与引用关系，这里用正则做简化演示
function treeShake(graph) {
  // 1. 拼接所有源码，正则提取被使用的导出名
  const allSource = graph.map(m => m.filePath.endsWith('.js') ? fs.readFileSync(m.filePath, 'utf-8') : '').join('\n');
  const usedNames = new Set();
  for (const m of allSource.matchAll(/import\s*(?:\{([^}]+)\}|(\w+))\s+from/g)) {
    (m[1] ? m[1].split(',') : [m[2]]).forEach(n => usedNames.add(n.trim()));
  }

  // 2. 遍历模块，正则删除未被引用的 export 声明行
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

// 代码压缩
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


// // 测试一下：
// (async () => {
//   const config = loadConfig();
//   const rules = config.rules;
//   const graph = buildGraph(config.entry, rules);
//   const graphAfterTreeShaking = treeShake(graph);
//   const optimizedGraph = await optimizeGraph(graphAfterTreeShaking, config.mode);
//   console.log(optimizedGraph);
// })();


// plugin处理（plugin已被Compiler管理了）
const Compiler = require('./compiler');

// 测试一下 Plugin：
// 测试 Plugin：
// const config = loadConfig();
// const noopSteps = { buildGraph() {}, treeShake() {}, optimizeGraph() {}, createChunks() {}, bundle() {} };
// const compiler = new Compiler(config, noopSteps);
// compiler.run();


// 打包构建
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
  `;
}

// 入口
async function build () {
  const config = loadConfig();
  const compiler = new Compiler(config, { buildGraph, treeShake, optimizeGraph, createChunks, bundle });
  await compiler.run();
};

build();