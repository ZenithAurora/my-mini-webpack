const fs = require('fs')
const parser = require('@babel/parser')  // 解析器
const traverse = require('@babel/traverse').default;  // 遍历器
const babel = require('@babel/core')  // 编译器
const path = require('path')

// （1）读取文件内容
function readFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  return content
}

// （2）解析文件内容，生成AST
function parse(content) {
  const AST = parser.parse(content, { sourceType: 'module' })
  return AST
}

// （3）遍历AST，收集依赖模块
function getDependencies(AST) {
  const dependencies = []
  traverse(AST, {
    ImportDeclaration({ node }) {
      dependencies.push(node.source.value)  // 将依赖模块路径添加到dependencies数组中
    }
  })
  return dependencies
}

// （4）ES6 转换为 ES5
function transformToES5(AST) {
  const { code } = babel.transformFromAstSync(AST, null, { presets: ['@babel/preset-env'] })
  return code
}

// （5）解析模块，返回模块信息
// 每个模块都有一个ID，用于标识该模块
function parseModule(filePath, ID = 0) {
  const content = readFile(filePath)
  const AST = parse(content)
  const dependencies = getDependencies(AST)
  const code = transformToES5(AST)
  return {
    ID,
    code,
    filePath,
    dependencies,
  }
}

// （6）构建依赖图
function buildDependencyGraph() {
  const mainModule = parseModule('./src/main.js') // 解析入口模块
  const graph = [mainModule] // 依赖图谱
  let moduleID = 1

  // 遍历依赖图中的模块，递归处理依赖
  for (const module of graph) {
    const dirname = path.dirname(module.filePath)
    module.mapping = {} // 给当前模块多加一个mapping属性，存储依赖模块的相对路径到ID的映射

    // 遍历当前模块的依赖
    module.dependencies.forEach((dependencyFilePath) => {
      const absolutePath = path.join(dirname, dependencyFilePath)
      const childModule = parseModule(absolutePath, moduleID)

      module.mapping[dependencyFilePath] = moduleID
      graph.push(childModule)
      moduleID++
    })
  }

  return graph // 返回构建好的依赖图
}

// （7）打包模块
function bundle(graph) {
  let modules = ''

  /**
   * 构建模块映射表
   * 遍历依赖图中的每个模块，生成一个字符串形式的模块映射
   * 格式为：
   * {
   *   ID: [
   *     function(require, module, exports) { 代码 },
   *     { '依赖相对路径': 模块ID, ... }
   *   ],
   *   ...
   * }
   * 作用：为后续的模块加载和执行提供映射关系
   */
  graph.forEach(mod => {
    modules += `
      ${mod.ID}: [
        function(require, module, exports) {${mod.code} }, 
        ${JSON.stringify(mod.mapping)}
      ],
    `
  })

  const result = `
    (function(modules) {
        function require(id) {
            const [fn, mapping] = modules[id];
            function localRequire(relativePath) {
                return require(mapping[relativePath])
            }
            const module = {exports: {}}
            fn(localRequire, module, module.exports)
            return module.exports
        }
        require(0)
    })({${modules}})
  `

  return result
}
// 解释一下result部分：
// (function (modules) {
//   /**
//    *这个函数作用：根据模块ID,拿到对应的代码和映射关系
//     * 比方：require(0) → 拿到ID为零的模块，他的代码以及，他的代码所依赖的那个模块的路径和ID的映射
//     * 		ID:0 → fn(){ ...require("./info.js") }    这个ID为零的模块依赖了一个叫做./info.js的模块
//     *       而mapping：{"./info.js": 1} 就说明了，这个模块他对应的ID是1，那么接下来就需要去require(1)
//     *       ...重复上述步骤
//     */
//   function require(id) {
//     const [fn, mapping] = modules[id];
//     /**
//      * localRequire作用：根据相对路径，拿到对应的模块ID，递归调用require函数，加载依赖模块
//      * 为啥需要这个函数呢？
//      *
//      * 首先咱们看一下【构建模块映射表】的结果（随便取一个模块）：
//      * {
//      *   ID: 0,
//      *   code: 'fn(require, module, exports) {
//      *              ...
//      *              var _info = _interopRequireDefault(require("./info.js"));
//      *              ...
//      *          }',
//      *   mapping: { './info.js': 1 }
//      * }
//      * 可以看到，fn函数第一个参数是 require，这个函数在后面使用到了：require("./info.js")
//      * 他存在的意义是：传入一个相对路径，然后加载对应的模块
//      *
//      * 传入相对路径："./info.js"  然后根据mapping，找到对应的模块ID，递归调用require函数，根据模块ID加载依赖模块
//      */
//     function localRequire(relativePath) {
//       return require(mapping[relativePath])
//     }
//     const module = { exports: {} }
//     fn(localRequire, module, module.exports)
//     return module.exports
//   }
//   require(0)
// })()



// （8）写入dist目录
function run() {
  const graph = buildDependencyGraph()
  const bundleCode = bundle(graph)

  // 直接创建dist目录（如果不存在），recursive: true 确保自动创建父目录
  fs.mkdirSync('./dist', { recursive: true })

  fs.writeFileSync('./dist/bundle.js', bundleCode)
  console.log('build success ✔')
}

// （9）运行打包函数
run()

