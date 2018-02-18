import path from 'path'
import Koa from 'koa'
import webpack from 'webpack'
import koaWebpack from 'koa-webpack'
import mount from 'koa-mount'
import historyApiFallback from 'koa-connect-history-api-fallback'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import ExtractTextPlugin from 'extract-text-webpack-plugin'
import { Controller } from './Controller'

export class AdminController extends Controller {
  // @override
  compose() {
    const index = path.resolve(this.entry, 'index.html')
    const koa = new Koa()
    koa.use(historyApiFallback())
    koa.use(koaWebpack({
      config: {
        entry: [
          this.entry,
          path.resolve(this.entry, 'index.sass')
        ],
        output: {
          path: this.entry,
          publicPath: `${this.url}/`
        },
        resolve: {
          extensions: ['.js', '.vue', '.json'],
          alias: {
            'vue$': 'vue/dist/vue.esm.js',
            '@': this.entry
          }
        },
        module: {
          rules: [
            {
              test: /\.vue$/,
              loader: 'vue-loader',
              options: vueLoaderConfig
            },
            {
              test: /\.js$/,
              loader: 'babel-loader',
              include: [
                this.entry,
                path.resolve('node_modules/webpack-dev-server/client')
              ]
            },
            ...styleLoaders({
              sourceMap: true,
              usePostCSS: true
            })
          ]
        },
        plugins: [
          // HMR shows correct file names in console on update:
          new webpack.NamedModulesPlugin(),
          new webpack.NoEmitOnErrorsPlugin(),
          // https://github.com/ampedandwired/html-webpack-plugin
          new HtmlWebpackPlugin({
            template: index,
            inject: true
          })
        ]
      },
      dev: {
        publicPath: '/'
      }
    }))
    return mount(this.url, koa)
  }
}

const vueLoaderConfig = {
  loaders: cssLoaders({
    sourceMap: true,
    extract: false
  }),
  cssSourceMap: true,
  cacheBusting: true,
  transformToRequire: {
    video: ['src', 'poster'],
    source: 'src',
    img: 'src',
    image: 'xlink:href'
  }
}

function cssLoaders(options = {}) {
  const cssLoader = {
    loader: 'css-loader',
    options: {
      sourceMap: options.sourceMap
    }
  }

  const postcssLoader = {
    loader: 'postcss-loader',
    options: {
      sourceMap: options.sourceMap
    }
  }

  // generate loader string to be used with extract text plugin
  function generateLoaders(loader, loaderOptions) {
    const loaders = options.usePostCSS
      ? [cssLoader, postcssLoader]
      : [cssLoader]

    if (loader) {
      loaders.push({
        loader: loader + '-loader',
        options: {
          ...loaderOptions,
          sourceMap: options.sourceMap
        }
      })
    }

    // Extract CSS when that option is specified
    // (which is the case during production build)
    if (options.extract) {
      return ExtractTextPlugin.extract({
        use: loaders,
        fallback: 'vue-style-loader'
      })
    } else {
      return ['vue-style-loader', ...loaders]
    }
  }

  // https://vue-loader.vuejs.org/en/configurations/extract-css.html
  return {
    css: generateLoaders(),
    postcss: generateLoaders(),
    less: generateLoaders('less'),
    sass: generateLoaders('sass', {
      indentedSyntax: true
    }),
    scss: generateLoaders('sass'),
    stylus: generateLoaders('stylus'),
    styl: generateLoaders('stylus')
  }
}

// Generate loaders for standalone style files (outside of .vue)
function styleLoaders(options) {
  const output = []
  const loaders = cssLoaders(options)

  for (const extension in loaders) {
    const loader = loaders[extension]
    output.push({
      test: new RegExp('\\.' + extension + '$'),
      use: loader
    })
  }

  return output
}