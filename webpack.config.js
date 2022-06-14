const path = require('path');
const webpack = require('webpack');


module.exports = {
    entry: './src/index.js',
    mode: "production",
    module: {
        rules: [
          {
            test: /\.(js)$/,
            exclude: /node_modules/,
            use: ['babel-loader']
          }
        ]
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'web3analytics.js',
        library: {
            name: 'web3analytics',
            type: 'umd',
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),
    ],
    resolve: {
        fallback: {
            crypto: require.resolve("crypto-browserify"),
            stream: require.resolve("stream-browserify"),
            assert: require.resolve("assert"),
            http: require.resolve("stream-http"),
            https: require.resolve("https-browserify"),
            os: require.resolve("os-browserify"),
            url: require.resolve("url"),
            path: require.resolve("path-browserify"),
            zlib: require.resolve("browserify-zlib"),
            fs: require.resolve("browserify-fs"),
        }
    }
};