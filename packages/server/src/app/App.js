import Koa from 'koa'
import KnexPlus from './KnexPlus'
import { Validator } from '@/model'
import { EventEmitter } from '@/events'

export default class App extends Koa {
  constructor(config, { validator, models }) {
    super()
    // Override Koa's events with our own EventEmitter that adds support for
    // asynchronous events.
    // TODO: Test if Koa's internal events still behave the same (they should!)
    EventEmitter.mixin(this)
    this.config = config
    this.knex = KnexPlus(config.knex)
    if (config.log.sql) {
      this.knex.setupLogging()
    }
    this.models = {}
    this.validator = validator || new Validator()
    if (models) {
      this.addModels(models)
    }
  }

  addModels(models) {
    // First add all models then call initialize() for each in a second loop,
    // since they may be referencing each other in relations.
    for (const modelClass of Object.values(models)) {
      this.addModel(modelClass)
    }
    for (const modelClass of Object.values(models)) {
      modelClass.initialize()
    }
  }

  addModel(modelClass) {
    modelClass.app = this
    this.models[modelClass.name] = modelClass
    modelClass.knex(this.knex)
  }

  async start() {
    const {
      server: { host, port },
      environment
    } = this.config
    await this.emit('before:start')
    await new Promise(resolve => {
      this.server = this.listen(port, host, () => {
        const { port } = this.server.address()
        console.log(
          `${environment} server started at http://${host}:${port}`
        )
        resolve(this.server)
      })
      if (!this.server) {
        resolve(new Error(`Unable to start server at http://${host}:${port}`))
      }
    })
    await this.emit('after:start')
  }

  async stop() {
    await this.emit('before:stop')
    await new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close(err => {
          this.server = null
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      } else {
        reject(new Error('Server is not running'))
      }
    })
    await this.emit('after:stop')
  }

  async startOrExit() {
    try {
      await this.start()
    } catch (err) {
      console.error(err)
      process.exit(-1)
    }
  }
}
