const path = require('path');
const TimePlugin = require('./plugins/time-plugin');

module.exports = {
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      { test: /\.css$/, use: ['css-loader'] }
    ]
  },
  plugins: [new TimePlugin()],
  mode: 'production'
};