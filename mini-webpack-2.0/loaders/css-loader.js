// loaders/css-loader.js
module.exports = function (source) {
  // 清理 CSS 内容，移除换行和多余空格
  const cleanedCSS = source.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  return `
    const style = document.createElement('style');
    style.innerHTML = '${cleanedCSS}';
    document.head.appendChild(style);
  `;
}