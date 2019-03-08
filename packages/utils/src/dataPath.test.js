import {
  parseDataPath, normalizeDataPath, getDataPath, setDataPath
} from './dataPath'

describe('parseDataPath()', () => {
  it('should parse JSON pointers', () => {
    expect(parseDataPath('/object/array/1/prop'))
      .toStrictEqual(['object', 'array', '1', 'prop'])
  })

  it('should parse property access notation', () => {
    const expected = ['object', 'array', '1', 'prop']
    expect(parseDataPath('.object.array[1].prop')).toStrictEqual(expected)
    expect(parseDataPath(`.object["array"][1].prop`)).toStrictEqual(expected)
    expect(parseDataPath(`['object']['array'][1]['prop']`))
      .toStrictEqual(expected)
  })

  it(`should parse 'relative' JSON pointers`, () => {
    expect(parseDataPath('object/array/1/prop'))
      .toStrictEqual(['object', 'array', '1', 'prop'])
  })

  it(`should parse 'relative' property access notation`, () => {
    expect(parseDataPath('object.array[1].prop'))
      .toStrictEqual(['object', 'array', '1', 'prop'])
  })

  it('should handle white-space in JSON pointers', () => {
    expect(parseDataPath(`/object/property name`))
      .toStrictEqual(['object', 'property name'])
  })

  it('should handle white-space in property access notation', () => {
    const expected = ['object', 'property name']
    expect(parseDataPath(`.object["property name"]`)).toStrictEqual(expected)
    expect(parseDataPath(`.object['property name']`)).toStrictEqual(expected)
  })

  it('should return a clone if argument is already an array', () => {
    const array = ['object', 'array', '1']
    const actual = parseDataPath(array)
    expect(actual).toStrictEqual(array)
    expect(actual).not.toBe(array)
  })

  it('should return undefined for values other than array / string', () => {
    expect(parseDataPath({})).toBe(undefined)
  })
})

describe('normalizeDataPath()', () => {
  it('should normalize JSON pointers', () => {
    expect(normalizeDataPath('/object/array/1/prop'))
      .toStrictEqual('object/array/1/prop')
  })

  it('should normalize property access notation', () => {
    const expected = 'object/array/1/prop'
    expect(normalizeDataPath('.object.array[1].prop')).toStrictEqual(expected)
    expect(normalizeDataPath(`.object["array"][1].prop`))
      .toStrictEqual(expected)
    expect(normalizeDataPath(`['object']['array'][1]['prop']`))
      .toStrictEqual(expected)
  })
})

describe('getDataPath()', () => {
  const data = {
    object: {
      array: [
        null,
        {
          prop: 'expected'
        }
      ]
    }
  }

  it(`should return data at a given path in property access notation`, () => {
    expect(getDataPath(data, 'object.array[1].prop')).toBe('expected')
  })

  it(`should return data at a given JSON pointer path`, () => {
    expect(getDataPath(data, '/object/array/1/prop')).toBe('expected')
  })

  it(`should return data at a given 'relative' JSON pointer path`, () => {
    expect(getDataPath(data, 'object/array/1/prop')).toBe('expected')
  })

  it(`should throw an error with faulty paths`, () => {
    expect(() => getDataPath(data, 'object/unknown/prop'))
      .toThrow('Invalid path: object/unknown/prop')
  })

  it(`should throw an error with nullish objects`, () => {
    expect(() => getDataPath(null, 'object'))
      .toThrow('Invalid path: object')
  })

  it(`should support custom error handler`, () => {
    const handleError = (object, part, index) => `${part}, ${index}: err`
    expect(getDataPath(data, 'object/unknown/prop', handleError))
      .toBe('unknown, 1: err')
  })

  it(`should return wildcard matches`, () => {
    const data = {
      object: {
        array: [
          { prop: 'one' },
          { prop: 'two' }
        ]
      }
    }

    expect(getDataPath(data, 'object/array/*/prop')).toEqual(['one', 'two'])
    expect(getDataPath(data, 'object.array[*].prop')).toEqual(['one', 'two'])
  })
})

describe('setDataPath()', () => {
  const data = {
    object: {
      array: [
        {}
      ],
      number: 10
    }
  }

  const add = { prop: 'new' }

  it(`should add data at a path to a given object`, () => {
    expect(() => setDataPath(data, 'object.array[0].added', add)).not.toThrow()
    expect(data.object.array[0].added).toStrictEqual(add)
  })

  it(`should add data at a path to a given array`, () => {
    expect(() => setDataPath(data, 'object.array[1]', add)).not.toThrow()
    expect(data.object.array[1]).toStrictEqual(add)
  })

  it(`should throw an error with faulty paths`, () => {
    expect(() => setDataPath(data, 'object/unknown/prop', add)).toThrow()
  })

  it(`should throw an error with invalid target`, () => {
    expect(() => setDataPath(data, 'object/number/invalid', add))
      .toThrow('Invalid path: object/number/invalid')
  })
})
