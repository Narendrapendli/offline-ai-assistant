//@ts-check
'use strict';

const path = require('path');

/**
 * @type {import('webpack').Configuration}
 */
const config = {
  // Target VS Code extension host (Node.js environment)
  target: 'node',

  // Production mode: minify + tree-shake for smaller VSIX
  mode: 'production',

  // Extension entry point
  entry: './src/extension.ts',

  // Output bundle
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',

    // Required for VS Code extensions — must export activate/deactivate
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },

  // Tell webpack NOT to bundle the 'vscode' module —
  // it is provided at runtime by VS Code's extension host
  externals: {
    vscode: 'commonjs vscode'
  },

  // Source maps for debugging (mapped to .ts source files)
  devtool: 'nosources-source-map',

  // Resolve TypeScript files
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['main', 'module']
  },

  // TypeScript loader
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Speeds up compilation by skipping type checking
              // (tsc --noEmit handles type checking separately)
              transpileOnly: false,
              configFile: path.resolve(__dirname, 'tsconfig.json')
            }
          }
        ]
      }
    ]
  },

  // Performance hints — suppress for extension bundles
  performance: {
    hints: false
  },

  // Infrastructure logging
  infrastructureLogging: {
    level: 'log'
  }
};

module.exports = config;
