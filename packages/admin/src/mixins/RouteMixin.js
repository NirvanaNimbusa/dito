import { getCommonPrefix } from '@ditojs/utils'

// @vue/component
export default {
  provide() {
    return {
      $routeComponent: this
    }
  },

  data() {
    return {
      reload: false,
      // Each route-component defines a store that gets passed on to its
      // child components, so they can store values in them that live beyond
      // their life-cycle. See: DitoComponents, SourceMixin
      store: {},
      loadCache: {} // See TypeMixin.load()
    }
  },

  computed: {
    routeComponent() {
      // Override DitoMixin's routeComponent() which uses the injected value.
      return this
    },

    routeRecord() {
      // TODO: Can this.$route.currentRoute be of use somewhere here?
      // Retrieve the route-record to which this component was mapped to:
      // https://github.com/vuejs/vue-router/issues/1338#issuecomment-296381459
      return this.$route.matched[this.$vnode.data.routerViewDepth]
    },

    isLastRoute() {
      // Returns true when this router component is the last one in the route.
      const { matched } = this.$route
      return this.routeRecord === matched[matched.length - 1]
    },

    isLastUnnestedRoute() {
      // Returns true if this route component is the last one in the route that
      // needs its own router-view (= is not nested).
      const { matched } = this.$route
      for (let i = matched.length - 1; i >= 0; i--) {
        const record = matched[i]
        if (!record.meta.nested) {
          return this.routeRecord === record
        }
      }
      return false
    },

    isNestedRoute() {
      return this.meta.nested
    },

    meta() {
      return this.routeRecord?.meta
    },

    path() {
      return this.getRoutePath(this.routeRecord.path)
    },

    label() {
      return this.getLabel(this.schema)
    },

    breadcrumb() {
      const { breadcrumb } = this.schema || {}
      return breadcrumb || `${this.breadcrumbPrefix} ${this.label}`
    },

    breadcrumbPrefix() {
      return ''
    },

    param() {
      // Workaround for vue-router not being able to map multiple url parameters
      // with the same name to multiple components, see:
      // https://github.com/vuejs/vue-router/issues/1345
      return this.$route.params[this.meta?.param] || null
    }
  },

  created() {
    // Keep a shared stack of root components for DitoTrail to use to render
    // labels. Can't rely on $route.matched[i].instances.default unfortunately,
    // as instances aren't immediately ready, and instances is not reactive.
    this.appState.routeComponents.push(this)
  },

  destroyed() {
    const { routeComponents } = this.appState
    routeComponents.splice(routeComponents.indexOf(this), 1)
  },

  methods: {
    getRoutePath(templatePath) {
      // Maps the route's actual path to the matched routes by counting its
      // parts separated by '/', splitting the path into the mapped parts
      // containing actual parameters.
      return this.$route.path
        .split('/')
        .slice(0, templatePath.split('/').length)
        .join('/')
    },

    getChildPath(schema) {
      return `${this.path}/${schema.path}`
    },

    isFullRouteChange(to, from) {
      // The route path is the path up to the first / (excluding the initial /):
      const rootPath = this.path.match(/^(\/[^/]*)/)[1]
      return !getCommonPrefix(to.path, from.path).startsWith(rootPath)
    }
  }
}
