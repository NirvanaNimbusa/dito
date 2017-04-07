import Vue from 'vue'
import escape from './utils/escape'

const components = []
const types = []

const BaseComponent = Vue.extend({
  // Make sure that registered components are present in all BaseComponent.
  components: components,

  methods: {
    typeToComponent(type) {
      return types[type]
    },

    escape
  }
})

BaseComponent.component = function(name, options) {
  const ctor = this.extend(options)
  components[name] = ctor
  return ctor
}

BaseComponent.types = types
BaseComponent.components = components

export default BaseComponent
