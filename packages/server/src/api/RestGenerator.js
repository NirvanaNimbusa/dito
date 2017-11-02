import objection from 'objection'
import chalk from 'chalk'
import pluralize from 'pluralize'
// import findQuery from 'objection-find'
import { convertSchema } from '@/schema'
import { NotFoundError } from '@/errors'
import { isObject, isFunction, isString, pick, hyphenate } from '@/utils'

export default class RestGenerator {
  constructor({ adapter, prefix, logger } = {}) {
    this.adapter = adapter
    this.logger = logger
    this.prefix = /\/$/.test(prefix) ? prefix : `${prefix}/`
    this.models = Object.create(null)
    this.findQueries = Object.create(null)
  }

  addModelRoutes(modelClass) {
    this.log(`${chalk.green(modelClass.name)}${chalk.white(':')}`)
    const { routes = {}, methods = {} } = modelClass.definition
    this.addRoutes(modelClass, null, 'collection', routes.collection, 1)
    // Install static methods before ids, as they wouldn't match otherwise
    this.addMethods(modelClass, 'collectionMethod', methods.collection, 1)
    this.addRoutes(modelClass, null, 'member', routes.member, 1)
    this.addMethods(modelClass, 'memberMethod', methods.member, 1)
    const { relations } = routes
    if (relations) {
      for (const relation of Object.values(modelClass.getRelations())) {
        const { name } = relation
        this.log(`${chalk.blue(name)}${chalk.white(':')}`, 1)
        const settings = pick(relations[name], relations)
        this.addRoutes(modelClass, relation, 'relation', settings, 2)
        if (!relation.isOneToOne()) {
          // TODO: Shouldn't OneToOne relations also offer a way to unrelated /
          // relate instead of directly manipulate the related object? Should
          // we make the distinction between relation and member here too, and
          // if so, do we go by Id as well?
          this.addRoutes(modelClass, relation, 'relationMember', settings, 2)
        }
      }
    }
  }

  addRoutes(modelClass, relation, type, routesSettings, indent) {
    const handlers = restHandlers[type]
    const getSettings = settingsHandlers[type]
    for (const [verb, handler] of Object.entries(getSettings ? handlers : {})) {
      const settings = getSettings(verb, handlers, routesSettings)
      if (!settings || !settings.access) {
        continue
      }
      const path = this.getRoutePath(type, modelClass, relation)
      const target = relation || modelClass
      this.adapter.addRoute(
        { modelClass, relation, type, verb, path, settings },
        ctx => handler(target, ctx))
      this.log(`${chalk.magenta(verb.toUpperCase())} ${chalk.white(path)}`,
        indent)
    }
  }

  addMethods(modelClass, type, methodsSettings, indent) {
    for (const [name, schema] of Object.entries(methodsSettings || {})) {
      const method = {
        name,
        verb: 'get',
        path: name,
        ...schema
      }
      const { verb, access } = method
      const settings = {
        access: access != null ? access : true
      }
      const path = this.getRoutePath(type, modelClass, method.path)
      const handler = methodHandlers[type]
      const validate = {
        arguments: createArgumentsValidator(modelClass, method.arguments),
        return: createArgumentsValidator(modelClass, [method.return])
      }
      this.adapter.addRoute(
        { modelClass, method, type, verb, path, settings },
        ctx => handler(modelClass, method, validate, ctx))
      this.log(`${chalk.magenta(verb.toUpperCase())} ${chalk.white(path)}`,
        indent)
    }
  }

  log(str, indent = 0) {
    if (this.logger) {
      this.logger(`${'  '.repeat(indent)}${str}`)
    }
  }

  getRoutePath(type, modelClass, param) {
    return `${this.prefix}${routePath[type](modelClass, param)}`
  }
}

// TODO: Add normalization Options!
function normalize(name, plural = false) {
  // Remove '$' from member method paths
  name = name.replace(/\$/g, '')
  return hyphenate(plural ? pluralize(name) : name)
}

const routePath = {
  collection(modelClass) {
    return normalize(modelClass.name, true)
  },
  collectionMethod(modelClass, path) {
    return `${routePath.collection(modelClass)}/${normalize(path)}`
  },
  member(modelClass) {
    return `${routePath.collection(modelClass)}/:id`
  },
  memberMethod(modelClass, path) {
    return `${routePath.member(modelClass)}/${normalize(path)}`
  },
  relation(modelClass, relation) {
    return `${routePath.member(modelClass)}/${normalize(relation.name)}`
  },
  relationMember(modelClass, relation) {
    return `${routePath.relation(modelClass, relation)}/:relatedId`
  }
}

/**
 * Route Settings Handling
 */

function getSettings(verb, handlers, settings) {
  // Only use `settings[verb]` as the settings for this handler, if `settings`
  // contains any of the verbs defined in handlers. If not, then `settings`
  // is a shared object to be used for all verbs:
  let obj = isObject(settings) &&
    Object.keys(handlers).find(verb => settings[verb])
    ? settings[verb]
    : settings || false
  if (!isObject(obj) || !('access' in obj)) {
    // TODO: Improve check by looking for any route settings properties in
    // Object.keys(obj), and only wrap with `access: obj` if obj doesn't contain
    // any of these keys.
    obj = { access: obj }
  }
  return obj
}

const settingsHandlers = {
  collection: getSettings,
  member: getSettings,

  relation: (verb, handlers, settings) => {
    return getSettings(verb, handlers,
      settings && pick(settings.relation, settings))
  },

  relationMember: (verb, handlers, settings) => {
    return getSettings(verb, handlers,
      settings && pick(settings.relation, settings))
  }
}

/**
 * Remote Methods
 */
function createArgumentsValidator(modelClass, args = []) {
  if (args.length > 0) {
    let properties = null
    for (const arg of args) {
      if (arg) {
        const property = isString(arg) ? { type: arg } : arg
        const { name, type, ...rest } = property
        properties = properties || {}
        properties[name || 'root'] = type ? { type, ...rest } : rest
      }
    }
    if (properties) {
      const schema = convertSchema(properties)
      return modelClass.getValidator().compileValidator(schema)
    }
  }
  return () => true
}

function getArguments(modelClass, method, validate, ctx) {
  const { query } = ctx
  if (!validate(query)) {
    throw modelClass.createValidationError(validate.errors,
      `The provided data is not valid: ${JSON.stringify(query)}`)
  }
  const args = []
  // If no arguments are provided, pass the full ctx object to the method
  for (const { key, value } of method.arguments || [{ value: ctx }]) {
    args.push(key ? query[key] : value || query)
  }
  return args
}

function getReturn(modelClass, method, validate, value) {
  const { name } = method.return || {}
  return Promise.resolve(value).then(value => {
    // Use 'root' if no name is given, see createArgumentsValidator()
    const data = { [name || 'root']: value }
    if (!validate(data)) {
      throw modelClass.createValidationError(validate.errors,
        `Invalid result of remote method: ${value}`)
    }
    return name ? data : value
  })
}

function checkMethod(func, modelClass, name, prefix) {
  if (!isFunction(func)) {
    throw new NotFoundError(
      `${prefix} method '${name}' not found on Model '${modelClass.name}'`)
  }
  return func
}

const methodHandlers = {
  async collectionMethod(modelClass, method, validate, ctx) {
    const { name } = method
    const func = checkMethod(modelClass[name], modelClass, name, 'Collection')
    const args = getArguments(modelClass, method, validate.arguments, ctx)
    const value = await func.apply(modelClass, args)
    return getReturn(modelClass, method, validate.return, value)
  },

  async memberMethod(modelClass, method, validate, ctx) {
    const model = await restHandlers.member.get(modelClass, ctx)
    const { name } = method
    const func = checkMethod(model[name], modelClass, name, 'Member')
    const args = getArguments(modelClass, method, validate.arguments, ctx)
    const value = await func.apply(model, args)
    return getReturn(modelClass, method, validate.return, value)
  }
}

/**
 * Rest Routes
 */

function checkModel(model, modelClass, id) {
  if (!model) {
    throw new NotFoundError(
      `Cannot find '${modelClass.name}' model with id ${id}`)
  }
  return model
}

const restHandlers = {
  collection: {
    // get collection
    get(modelClass, ctx) {
      // return findQuery(modelClass).build(ctx.query)
      return modelClass.query().find(ctx.query)
    },

    // delete collection
    delete(modelClass, ctx) {
      return restHandlers.collection.get(modelClass, ctx)
        .delete()
        .then(count => ({ count }))
    },

    // post collection
    post(modelClass, ctx) {
      return objection.transaction(modelClass, modelClass => {
        // TODO: insertGraphAndFetch()?
        return modelClass.query()
          .insertGraph(ctx.request.body)
      })
    },

    // put collection
    put(modelClass, ctx) {
      return objection.transaction(modelClass, modelClass => {
        return modelClass.query()
          .updateGraphAndFetch(ctx.request.body)
      })
    },

    // patch collection
    patch(modelClass, ctx) {
      return objection.transaction(modelClass, modelClass => {
        return modelClass.query()
          .upsertGraphAndFetch(ctx.request.body)
      })
    }
  },

  member: {
    // get member
    get(modelClass, ctx) {
      const { id } = ctx.params
      return modelClass.query()
        .findById(id)
        // TODO: findById(id, query) with support for ctx.query!
        // TODO: .allowEager(modelClass.getFindQueryBuilder().allowEager())
        .mergeScope(ctx.query.scope)
        .mergeEager(ctx.query.eager)
        .then(model => checkModel(model, modelClass, id))
    },

    // delete member
    delete(modelClass, ctx) {
      return modelClass.query()
        .deleteById(ctx.params.id)
        .then(count => ({ count }))
    },

    // put member
    put(modelClass, ctx) {
      const { id } = ctx.params
      return modelClass.query()
        .updateGraphAndFetchById(id, ctx.request.body)
        .then(model => checkModel(model, modelClass, id))
    },

    // patch member
    patch(modelClass, ctx) {
      const { id } = ctx.params
      return modelClass.query()
        .upsertGraphAndFetchById(id, ctx.request.body)
        .then(model => checkModel(model, modelClass, id))
    }
  },

  relation: {
    // get relation
    get(relation, ctx) {
      // NOTE: id = the id of the member to which this relation belongs.
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return ownerModelClass.query()
        .findById(id)
        .then(model => checkModel(model, ownerModelClass, id)
          .$relatedQuery(relation.name)
          .find(ctx.query, relation.isOneToOne())
          .then(result => result || null))
    },

    // delete relation
    delete(relation, ctx) {
      // TODO: What's the expected behavior in a toOne relation?
      // Currently it deletes the object itself, but shouldn't it unrelate
      // instead?
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        return ownerModelClass.query()
          .findById(id)
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .delete())
          .then(count => ({ count }))
      })
    },

    // post relation
    post(relation, ctx) {
      // TODO: What's the expected behavior in a toOne relation?
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        return ownerModelClass.query()
          .findById(id)
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .insertGraphAndFetch(ctx.request.body))
      })
    },

    // put relation
    put(relation, ctx) {
      // TODO: What's the expected behavior in a toOne relation?
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        return ownerModelClass.query()
          .findById(id)
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .updateGraphAndFetch(ctx.request.body))
      })
    },

    // patch relation
    patch(relation, ctx) {
      // TODO: What's the expected behavior in a toOne relation?
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        return ownerModelClass.query()
          .findById(id)
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .upsertGraphAndFetch(ctx.request.body))
      })
    }
  },

  relationMember: {
    post(relation, ctx) {
      const { id, relatedId } = ctx.params
      const { ownerModelClass, relatedModelClass } = relation
      return objection.transaction(ownerModelClass, relatedModelClass,
        (ownerModelClass, relatedModelClass) => {
          return ownerModelClass.query()
            .findById(id)
            .then(model => checkModel(model, ownerModelClass, id)
              .$relatedQuery(relation.name)
              .relate(relatedId))
            .then(related => {
              // TODO: inspect and decide what to do next
              console.log('related', related)
              return relatedModelClass
                .findById(relatedId)
                // TODO:
                // .allowEager(relation.relatedModelClass.getFindQueryBuilder()
                //   .allowEager())
                .mergeEager(ctx.query.eager)
            })
        }
      )
    }
  }
}
