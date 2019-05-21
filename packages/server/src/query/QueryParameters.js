import { ResponseError, QueryBuilderError } from '@/errors'
import { isObject, isArray, isString, asArray, capitalize } from '@ditojs/utils'
import { QueryWhereFilters } from './QueryWhereFilters'
import Registry from './Registry'

export const QueryParameters = new Registry()

QueryParameters.register({
  // TODO: Remove in favor of filters
  where(builder, key, value) {
    processWhereFilters(builder, 'where', null, value)
  },

  // TODO: Remove in favor of filters
  orWhere(builder, key, value) {
    processWhereFilters(builder, 'orWhere', null, value)
  },

  eager(builder, key, value) {
    for (const eager of asArray(value)) {
      builder.mergeEager(eager)
    }
  },

  scope(builder, key, value) {
    builder.mergeScope(...asArray(value))
  },

  filter(builder, key, value) {
    try {
      for (const filter of asArray(value)) {
        const [, name, json] = filter.match(/^(\w+):(.*)$/)
        const args = asArray(JSON.parse(`[${json}]`))
        builder.applyFilter(name, ...args)
      }
    } catch (error) {
      throw error instanceof ResponseError
        ? error
        : new QueryBuilderError(
          `Invalid Query filter parameters: ${error.message}.`
        )
    }
  },

  range(builder, key, value) {
    if (value) {
      const [from, to] = isString(value) ? value.split(/\s*,s*/) : value
      const start = +from
      const end = +to
      if (isNaN(start) || isNaN(end) || end < start) {
        throw new QueryBuilderError(`Invalid range: [${start}, ${end}].`)
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
      for (const entry of asArray(value)) {
        const ref = builder.getPropertyRef(entry, { parseDirection: true })
        const { direction = 'asc', relation } = ref
        const columnName = ref.getFullColumnName(builder)
        let orderName = columnName
        if (relation) {
          if (!relation.isOneToOne()) {
            throw new QueryBuilderError(
              `Can only order by model's own properties ` +
              `and by one-to-one relations' properties.`)
          }
          // TODO: Is the use of an alias required here?
          orderName = `${relation.name}${capitalize(ref.propertyName)}`
          builder.select(`${columnName} as ${orderName}`)
        }
        builder.orderBy(columnName, direction).skipUndefined()
      }
    }
  }
})

function processWhereFilters(builder, where, key, value, parts) {
  // Recursively translate object based where filters to string based ones for
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
  //   { ref: 'firstName like', value: 'Jo%' }
  //   { ref: 'lastName', value: '%oe' }
  //   { ref: 'messages.text like', value: '% and %' }
  //   { ref: 'messages.unread', value: true }
  //
  // TODO: Think about better ways to handle and / or in Object notation.
  if (isObject(value)) {
    for (const [subKey, subValue] of Object.entries(value)) {
      // NOTE: We need to clone `parts` for branching:
      processWhereFilters(builder, where, subKey, subValue,
        parts ? [...parts, key] : [])
    }
  } else if (parts) {
    // Recursive call in object parsing
    const filterName = QueryWhereFilters.has(key) && key
    if (!filterName) parts.push(key)
    const ref = `${parts.join('.')}${filterName ? ` ${filterName}` : ''}`
    builder.parseWhereFilter(where, ref, value)
  } else if (isString(value)) {
    const [ref, val] = value.split('=')
    builder.parseWhereFilter(where, ref, val)
  } else if (isArray(value)) {
    for (const entry of value) {
      processWhereFilters(builder, where, null, entry)
    }
  } else {
    throw new QueryBuilderError(`Unsupported 'where' query: '${value}'.`)
  }
}
