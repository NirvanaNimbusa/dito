import DomMixin from './DomMixin'

// @vue/component
export default {
  mixins: [DomMixin],

  data() {
    return {
      pulldown: {
        open: false,
        startTime: 0,
        documentHandlers: {
          mousedown: () => {
            this.showPulldown(false)
            this.domOff(document, this.pulldown.documentHandlers)
          },

          mouseup: () => {
            if (this.onPulldownMouseUp(null)) {
              this.domOff(document, this.pulldown.documentHandlers)
            }
          }
        }
      }
    }
  },

  methods: {
    onPulldownMouseDown() {
      this.showPulldown(true)
    },

    onPulldownMouseUp(value) {
      const { startTime } = this.pulldown
      if (startTime && (Date.now() - startTime > 250)) {
        this.showPulldown(false)
        if (value) {
          this.onPulldownSelect(value)
        }
        return true
      }
    },

    onPulldownSelect(/* value */) {
      // NOTE: To be overridden.
    },

    showPulldown(open) {
      this.pulldown.open = open
      this.pulldown.startTime = open ? Date.now() : 0
      if (open) {
        this.domOn(document, this.pulldown.documentHandlers)
      }
    }
  }
}
