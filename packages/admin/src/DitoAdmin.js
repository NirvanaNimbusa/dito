import Vue from 'vue'
import VueModal from 'vue-js-modal'
import VueRouter from 'vue-router'
import VueNotifications from 'vue-notification'
import axios from 'axios'
import './components'
import './types'
import './validator'
import verbs from './verbs'
import TypeComponent from './TypeComponent'
import DitoRoot from './components/DitoRoot'
import { getResource } from './utils/resource'
import {
  isString, clone, hyphenate, camelize, isAbsoluteUrl, defaultDateFormat
} from '@ditojs/utils'

Vue.config.productionTip = false

// All global plugins that need to be registered on `Vue`:
Vue.use(VueRouter)
Vue.use(VueModal, {
  dynamic: true
})
Vue.use(VueNotifications)

export default class DitoAdmin {
  constructor(el, {
    dito, // Contains the url and api settings as passed from AdminController
    api = dito?.api || {},
    url = dito?.url || '/',
    views = {},
    ...options
  } = {}) {
    // Support serialized functions, dates and regexps, as produced on the
    // server-side, see: AdminController.getWebpackConfig()
    api = clone(api, value => deserialize(value))

    this.el = el
    this.api = api
    this.options = options

    api.locale = api.locale || 'en-US'
    api.dateFormat = api.dateFormat || defaultDateFormat
    api.request = api.request || ((...args) => this.request(...args))

    // Setting `api.normalizePaths = true (plural) sets both:
    // `api.normalizePath = hyphenate` and `api.denormalizePath = camelize`
    api.normalizePath = (
      api.normalizePath ||
      api.normalizePaths
        ? hyphenate
        : val => val
    )
    api.denormalizePath = (
      api.denormalizePath ||
      api.normalizePaths
        ? camelize
        : val => val
    )

    // Allow the configuration of all auth resources, like so:
    // api.users = {
    //   path: '/admins',
    //   // These are the defaults:
    //   login: {
    //     path: 'login',
    //     method: 'post'
    //   },
    //   logout: {
    //     path: 'logout',
    //     method: 'post'
    //   },
    //   session: {
    //     path: 'session',
    //     method: 'get'
    //   }
    // }
    const users = api.users = getResource(api.users, {
      type: 'collection'
    }) || {}
    users.login = getResource(users.login || 'login', {
      method: 'post',
      parent: users
    })
    users.logout = getResource(users.logout || 'logout', {
      method: 'post',
      parent: users
    })
    users.session = getResource(users.session || 'session', {
      method: 'get',
      parent: users
    })

    // Allow overriding of resource path handlers:
    // api.resources = {
    //   collection(resource) {
    //     return resource.parent
    //       ? `${resource.path}?${resource.parent.path}_id=${
    //          resource.parent.id}`
    //       : resource.path
    //   }
    // }

    api.resources = {
      any(resource) {
        const handler = this[resource?.type] || this.default
        return resource && handler.call(this, resource)
      },

      default(resource) {
        const parentPath = this.any(resource.parent)
        return parentPath
          ? `${parentPath}/${resource.path}`
          : resource.path
      },

      collection(resource) {
        return this.default(resource)
      },

      member(resource) {
        // NOTE: We assume that all members have root-level collection routes,
        // to avoid excessive nesting of (sub-)collection routes.
        return `${resource.path}/${resource.id}`
      },

      upload(resource) {
        // Dito Server handles upload routes on the collection resource:
        return `${this.collection(resource.parent)}/upload/${resource.path}`
      },

      ...api.resources
    }

    // Allow overriding / extending of headers:
    // api.headers = {
    //   'Content-Type': 'application/json'
    // }
    api.headers = {
      'Content-Type': 'application/json',
      ...api.headers
    }

    this.root = new Vue({
      el,
      router: new VueRouter({
        mode: 'history',
        base: url
      }),
      components: { DitoRoot },
      data: {
        views,
        options
      },
      provide: {
        api,
        // A default list of verbs are provided by $verbs() and can be
        // overridden at any point in the component hierarchy.
        // Note: Work around lack of reactivity in Vue's provide/inject by using
        // a callback instead of the $verbs value directly:
        $verbs: () => verbs,
        // Placeholder provides so DitoMixin can inject them for all components:
        // inject: [ '$schemaComponent', '$routeComponent' ]
        $schemaComponent: null,
        $routeComponent: null
      },
      render: h => h(DitoRoot, {
        props: {
          views,
          options
        }
      })
    })
  }

  register(type, options) {
    return TypeComponent.register(type, options)
  }

  request({
    url,
    method = 'get',
    data = null,
    params = null,
    headers = null
  }) {
    const isApiRequest = !isAbsoluteUrl(url) || url.startsWith(this.api.url)
    return axios.request({
      url,
      method,
      data: data !== null ? JSON.stringify(data) : null,
      params,
      baseURL: isApiRequest ? this.api.url : null,
      headers: {
        ...(isApiRequest && this.api.headers),
        ...headers
      },
      withCredentials: isApiRequest && !!this.api.cors?.credentials
    })
  }
}

function deserialize(value) {
  // Match the format '{{serialized-string}}', as produced by
  // AdminController.getWebpackConfig():
  const match = isString(value) && value.match(/^\{\{([\s\S]*)\}\}$/)
  return match
    ? (new Function('', `return (${match[1]})`))()
    : value
}
