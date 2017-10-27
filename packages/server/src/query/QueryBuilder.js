import objection from 'objection'
import PropertyRef from './PropertyRef'
import { QueryError } from '@/errors'
import { isArray, isObject, isString, asArray, capitalize } from '@/utils'

// This code is based on objection-find, and simplified.
// Instead of a separate class, we extend objection.QueryBuilder to better
// integrate with Objection.js

// Invert default setting of insertMissing for dito:
const upsertOptions = {
  relate: true,
  unrelate: true,
  insertMissing: true
}

export default class QueryBuilder extends objection.QueryBuilder {
  constructor(modelClass) {
    super(modelClass)
    this._allow = null
    this._propertyRefsCache = {}
  }

  static forClass(modelClass) {
    const builder = new this(modelClass)
    const { eager } = modelClass
    if (eager) {
      builder.eager(eager)
    }
    return builder
  }

  unscoped() {
    return this
      .internalOptions({ unscoped: true })
      .clearEager()
  }

  eager(exp, filters) {
    const { eager } = this.modelClass()
    const { unscoped } = this.internalOptions()
    // eager() is also used internally by upsertGraph() & co, but when it is
    // called by these methods, `exp` is a `RelationExpression`. To avoid
    // interfering with these methods, only support preserving the default
    // eager settings when working with string expressions:
    if (!unscoped && eager && isString(exp)) {
      super.eager(eager)
      this.mergeEager(exp, filters)
    } else {
      super.eager(exp, filters)
    }
    return this
  }

  insert(data, returning) {
    // Only PostgreSQL is able to insert multiple entries at once it seems,
    // all others have to fall back on insertGraph() to do so for now:
    return !this.knex().isPostgreSQL && isArray(data) && data.length > 1
      ? this.insertGraph(data)
      : super.insert(data, returning)
  }

  // https://github.com/Vincit/objection.js/issues/101#issuecomment-200363667
  upsert(data, _fetch = false) {
    const modelClass = this.modelClass()
    let whereQuery
    return this
      .runBefore((result, builder) => {
        if (!builder.context().isWhereQuery) {
          // At this point the builder should only contain a bunch of `where*`
          // operations. Store the `where` query for later use in the `runAfter`
          // method. Also mark the query with `isWhereQuery: true` so we can
          // skip all this when this function is called for the `whereQuery`.
          whereQuery = builder.clone().context({ isWhereQuery: true })
          // Call the `update` method on the original query turning it into an
          // update operation.
          builder.update(data)
        }
        return result
      })
      .runAfter((result, builder) => {
        if (!builder.context().isWhereQuery) {
          if (result === 0) {
            const insert = _fetch ? 'insertAndFetch' : 'insert'
            return modelClass.query()[insert](data)
          } else {
            // Now we can use the `where` query we saved in the `runBefore`
            // method to fetch the inserted results. It is noteworthy that this
            // query will return the wrong results if the update changed any
            // of the columns the where operates with. This also returns all
            // updated models.
            return whereQuery.first()
          }
        }
        return result
      })
  }

  upsertAndFetch(data) {
    return this.upsert(data, true)
  }

  upsertGraph(data, opt) {
    return super.upsertGraph(data, {
      ...upsertOptions,
      ...opt
    })
  }

  upsertGraphAndFetch(data, opt) {
    return super.upsertGraphAndFetch(data, {
      ...upsertOptions,
      ...opt
    })
  }

  upsertGraphAndFetchById(id, data, opt) {
    return this.upsertGraphAndFetch({
      ...this.getIdObject(id),
      ...data
    }, opt)
  }

  // TODO: Implement update option in Objection.js!
  // https://github.com/Vincit/objection.js/issues/557
  updateGraph(data, opt) {
    return this.upsertGraph(data, {
      update: true,
      ...opt
    })
  }

  updateGraphAndFetch(data, opt) {
    return this.upsertGraphAndFetch(data, {
      update: true,
      ...opt
    })
  }

  updateGraphAndFetchById(id, data, opt) {
    return this.updateGraphAndFetch({
      ...this.getIdObject(id),
      ...data
    }, opt)
  }

  getIdObject(id) {
    const modelClass = this.modelClass()
    const fullId = {}
    const ids = asArray(id)
    for (const [index, column] of asArray(modelClass.idColumn).entries()) {
      fullId[modelClass.columnNameToPropertyName(column)] = ids[index]
    }
    return fullId
  }

  find(query = {}) {
    this._relationsToJoin = {}
    for (const [key, value] of Object.entries(query)) {
      const queryHandler = queryHandlers[key]
      if (queryHandler) {
        queryHandler(this, key, value)
      } else {
        throw new QueryError(
          `QueryBuilder: Invalid query parameter '${key}' in '${key}=${value}'.`
        )
      }
    }
    // TODO: Is this really needed? Looks like it works without it also...
    for (const relation of Object.values(this._relationsToJoin)) {
      relation.join(this, { joinOperation: 'leftJoin' })
    }
    return this
  }

  findOne(query) {
    return this.find(query).first()
  }

  allow(refs) {
    if (refs) {
      this._allow = this._allow || {}
      for (const { key } of this.getPropertyRefs(refs, { checkAllow: false })) {
        this._allow[key] = true
      }
    } else {
      this._allow = null
    }
    return this
  }

  getPropertyRefs(refs, { parseDir = false, checkAllow = true } = {}) {
    refs = isString(refs) ? refs.split(/\s*\|\s*/) : refs
    const cache = this._propertyRefsCache
    // Pass on _allow to make sure there are only allowed properties in the
    // query parameters.
    return refs.map(ref => cache[ref] ||
      (cache[ref] = new PropertyRef(ref, this.modelClass(), parseDir,
        checkAllow && this._allow)))
  }

  parseQueryFilter(key, value) {
    const parts = key.split(/\s*:\s*/)
    const queryFilter = parts.length === 1 ? queryFilters.eq
      : parts.length === 2 ? queryFilters[parts[1]]
      : null
    if (!queryFilter) {
      throw new QueryError(
        `QueryBuilder: Invalid filter in '${key}=${value}'.`)
    }
    const propertyRefs = this.getPropertyRefs(parts[0])
    for (const ref of propertyRefs) {
      const { relation } = ref
      if (relation && relation.isOneToOne()) {
        this._relationsToJoin[relation.name] = relation
      }
    }
    if (propertyRefs.length === 1) {
      propertyRefs[0].applyQueryFilter(this, this, queryFilter, value)
    } else {
      // If there are multiple property refs, they are combined with an `OR`
      // operator.
      this.where(builder => {
        for (const ref of propertyRefs) {
          ref.applyQueryFilter(this, builder, queryFilter, value, 'or')
        }
      })
    }
  }

  static registerQueryHandler(key, handler) {
    queryHandlers[key] = handler
  }

  static registerQueryFilter(key, handler) {
    queryFilters[key] = handler
  }
}

const queryHandlers = {

  where(builder, key, value) {
    // Recursively translate object based filters to string based ones for
    // standardized processing in PropertyRef.
    // So this...
    //   where: {
    //     firstName: { like: 'Jo%' },
    //     lastName: '%oe',
    //     messages: {
    //       text: { like: '% and %' },
    //       unread: true
    //     }
    //   }
    // ...becomes that:
    //   { key: 'firstName:like', value: 'Jo%' }
    //   { key: 'lastName', value: '%oe' }
    //   { key: 'messages.text:like', value: '% and %' }
    //   { key: 'messages.unread', value: true }
    function processPropertyRefs(key, value, parts) {
      if (isObject(value)) {
        // TODO: figure out and implement a better convention for handling
        // AND / OR queries in object notation.
        for (const [subKey, subValue] of Object.entries(value)) {
          // NOTE: We need to clone `parts` for branching:
          processPropertyRefs(subKey, subValue, parts ? [...parts, key] : [])
        }
      } else if (parts) {
        // Recursive call in object parsing
        const filterName = key in queryFilters && key
        if (!filterName) parts.push(key)
        const ref = `${parts.join('.')}${filterName ? `:${filterName}` : ''}`
        builder.parseQueryFilter(ref, value)
      } else if (isString(value)) {
        // TODO: Figure out and implement better parsing of string
        // "?where=..."" queries, including AND / OR.
        // e.g.
        // /api/dummies?where=firstName=Joe&where=lastName=Doe
        // /api/dummies?where=firstName=Joe|where=lastName=Doe
        // NOTE: The 2nd notation will end up as a string containing
        // "firstName=Joe|where=lastName=Doe", and will have to be further
        // parsed.
        const [ref, val] = value.split('=')
        builder.parseQueryFilter(ref, val)
      } else if (isArray(value)) {
        for (const entry of value) {
          processPropertyRefs(null, entry)
        }
      } else {
        throw new QueryError(
          `QueryBuilder: Unsupported 'where' query: '${value}'.`)
      }
    }

    processPropertyRefs(null, value)
  },

  // TODO: Add support for omit?
  eager(builder, key, value) {
    if (value) {
      builder.mergeEager(value)
    }
  },

  range(builder, key, value) {
    if (value) {
      const [start, end] = isString(value) ? value.split(/\s*,s*/) : value
      if (isNaN(start) || isNaN(end) || end < start) {
        throw new QueryError(`QueryBuilder: Invalid range: [${start}, ${end}].`)
      }
      builder.range(start, end)
    }
  },

  limit(builder, key, value) {
    builder.limit(value)
  },

  offset(builder, key, value) {
    builder.offset(value)
  },

  order(builder, key, value) {
    if (value) {
      for (const ref of builder.getPropertyRefs(value, { parseDir: true })) {
        const { dir = 'asc', relation } = ref
        const columnName = ref.fullColumnName(builder)
        if (relation) {
          if (!relation.isOneToOne()) {
            throw new QueryError(
              `QueryBuilder: Can only order by model's own properties ` +
              `and by one-to-one relations' properties.`)
          }
          // TODO: Is alias required here?
          const alias = `${relation.name}${capitalize(ref.propertyName)}`
          builder.select(`${columnName} as ${alias}`)
          builder.orderBy(alias, dir)
        } else {
          builder.orderBy(columnName, dir).skipUndefined()
        }
      }
    }
  },

  scope(builder, key, value) {
    const filters = builder.modelClass().namedFilters || {}
    if (!(value in filters)) {
      throw new QueryError(`QueryBuilder: Unkown scope: '${value}'.`)
    }
    builder.applyFilter(value)
  }
}

const queryFilters = {
  in(builder, ref, value) {
    return where(builder, ref, null, value.split(','), 'whereIn')
  },

  notIn(builder, ref, value) {
    return where(builder, ref, null, value.split(','), 'whereNotIn')
  },

  between(builder, ref, value) {
    return where(builder, ref, null, value.split(','), 'whereBetween')
  },

  notBetween(builder, ref, value) {
    return where(builder, ref, null, value.split(','), 'whereNotBetween')
  },

  null(builder, ref) {
    return where(builder, ref, null, null, 'whereNull')
  },

  notNull(builder, ref) {
    return where(builder, ref, null, null, 'whereNotNull')
  },

  empty(builder, ref) {
    return where(builder, ref, '=', '')
  },

  notEmpty(builder, ref) {
    // https://stackoverflow.com/a/42723975/1163708
    return where(builder, ref, '>', '')
  }
}

// TODO: ?
// http://docs.sequelizejs.com/manual/tutorial/querying.html
// [Op.regexp]: '^[h|a|t]'    // REGEXP/~ '^[h|a|t]' (MySQL/PG only)
// [Op.notRegexp]: '^[h|a|t]' // NOT REGEXP/!~ '^[h|a|t]' (MySQL/PG only)
// [Op.iRegexp]: '^[h|a|t]'    // ~* '^[h|a|t]' (PG only)
// [Op.notIRegexp]: '^[h|a|t]' // !~* '^[h|a|t]' (PG only)
// [Op.like]: { [Op.any]: ['cat', 'hat']}
// LIKE ANY ARRAY['cat', 'hat'] - also works for iLike and notLike
// [Op.overlap]: [1, 2]       // && [1, 2] (PG array overlap operator)
// [Op.contains]: [1, 2]      // @> [1, 2] (PG array contains operator)
// [Op.contained]: [1, 2]     // <@ [1, 2] (PG array contained by operator)
// [Op.any]: [2,3]            // ANY ARRAY[2, 3]::INTEGER (PG only)

const operators = {
  eq: '=',
  ne: '!=',
  not: 'is not',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  between: 'between',
  notBetween: 'not between',
  like: 'like',
  noteLike: 'not like',
  iLike: 'ilike',
  notILike: 'not ilike'
}

for (const [key, operator] of Object.entries(operators)) {
  queryFilters[key] = (builder, ref, value) => (
    where(builder, ref, operator, value)
  )
}

function where(builder, ref, operator, value, method = 'where') {
  const columnName = ref.fullColumnName(builder)
  return {
    method,
    args: operator ? [columnName, operator, value] : [columnName, value]
  }
}