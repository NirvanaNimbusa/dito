<template lang="pug">
  button.dito-button(
    ref="element"
    :id="dataPath"
    :type="type"
    :title="text"
    :class="`dito-button-${verb}`"
    v-bind="attributes"
    v-on="listeners"
  ) {{ text }}
</template>

<script>
import TypeComponent from '@/TypeComponent'
import { getSchemaAccessor } from '@/utils/accessor'
import { hasResource } from '@/utils/resource'
import { labelize } from '@ditojs/utils'

export default TypeComponent.register([
  'button', 'submit'
],
// @vue/component
{
  defaultValue: undefined,
  defaultWidth: null,
  // TODO: Consider making this work nicely:
  // omitFlexGrow: true,

  computed: {
    verb() {
      return this.verbs[this.name] || this.name
    },

    text() {
      return this.schema.text || labelize(this.verb)
    },

    listeners() {
      return {
        focus: this.onFocus,
        blur: this.onBlur,
        click: this.onClick
      }
    },

    closeForm: getSchemaAccessor('closeForm', {
      type: Boolean,
      default: false
    })
  },

  methods: {
    async onClick() {
      const res = await this.emitEvent('click', {
        parent: this.schemaComponent
      })
      // Have buttons that define resources call `this.submit()` by default:
      if (
        res === undefined && // Meaning: don't prevent default.
        hasResource(this.schema)
      ) {
        await this.submit()
      }
    },

    async submit(options) {
      return this.resourceComponent?.submit(this, options)
    }
  }
})
</script>
