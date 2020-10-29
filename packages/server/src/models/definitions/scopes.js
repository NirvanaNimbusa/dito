import { isObject, isFunction } from '@ditojs/utils'
import { mergeAsReversedArrays } from '@/utils'
import { ModelError } from '@/errors'

export default function scopes(values) {
  // Use mergeAsReversedArrays() to keep lists of filters to be inherited per
  // scope, so they can be called in sequence.
  const scopeArrays = mergeAsReversedArrays(values)
  const scopes = {}
  for (const [scope, array] of Object.entries(scopeArrays)) {
    // Convert array of inherited scope definitions to scope functions.
    const functions = array
      .map(
        value => {
          let func
          if (isFunction(value)) {
            func = value
          } else if (isObject(value)) {
            func = query => query.find(value)
          } else {
            throw new ModelError(this, `Invalid scope '${scope}': ${value}.`)
          }
          return func
        }
      )
    // Now define the scope as a function that calls all inherited scope
    // functions.
    scopes[scope] = query => {
      for (const func of functions) {
        func(query)
      }
      return query
    }
  }
  return scopes
}
