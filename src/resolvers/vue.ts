import { dirname, extname, parse } from 'path'
import { PageContext } from '../context'
import { CustomBlock } from '../types'
import {
  countSlash,
  isDynamicRoute,
  isCatchAllRoute,
  sortByDynamicRoute,
} from '../utils'
import { generateClientCode } from '../stringify'

interface Route {
  name?: string
  path: string
  props?: boolean
  component: string
  children?: Route[]
  customBlock?: CustomBlock
}

function prepareRoutes(
  ctx: PageContext,
  routes: Route[],
  parent?: Route,
) {
  for (const route of routes) {
    if (route.name)
      route.name = route.name.replace(/-index$/, '')

    if (parent)
      route.path = route.path.replace(/^\//, '')

    if (route.children) {
      delete route.name
      route.children = prepareRoutes(ctx, route.children, route)
    }

    route.props = true

    if (route.customBlock) {
      Object.assign(route, route.customBlock || {})
      delete route.customBlock
    }

    Object.assign(route, ctx.options.extendRoute?.(route, parent) || {})
  }

  return routes
}

export async function resolveVueRoutes(ctx: PageContext) {
  const pageRoutes = [...ctx.pageRouteMap.values()].sort((a, b) => {
    return countSlash(a.route) - countSlash(b.route)
  })
  const { nuxtStyle } = ctx.options

  const routes: Route[] = []

  pageRoutes.forEach((page) => {
    const pathNodes = page.route.split('/')

    // add leading slash to component path if not already there
    const component = page.path.replace(ctx.root, '')
    const customBlock = ctx.customBlockMap.get(page.path)

    const route: Route = {
      name: '',
      path: '',
      component,
      customBlock,
    }

    let parentRoutes = routes

    for (let i = 0; i < pathNodes.length; i++) {
      const node = pathNodes[i]
      const isDynamic = isDynamicRoute(node, nuxtStyle)
      const isCatchAll = isCatchAllRoute(node, nuxtStyle)
      const normalizedName = isDynamic
        ? nuxtStyle
          ? isCatchAll ? 'all' : node.replace(/^_/, '')
          : node.replace(/^\[(\.{3})?/, '').replace(/\]$/, '')
        : node
      const normalizedPath = normalizedName.toLowerCase()

      route.name += route.name ? `-${normalizedName}` : normalizedName

      // Check parent exits
      const parent = parentRoutes.find(node => node.component.replace(extname(node.component), '') === dirname(route.component))

      if (parent) {
        // Make sure children exits in parent
        parent.children = parent.children || []
        // Append to parent's children
        parentRoutes = parent.children
        // Reset path
        route.path = ''
      } else if (normalizedName.toLowerCase() !== 'index') {
        if (isDynamic) {
          route.path += `/:${normalizedName}`
          // Catch-all route
          if (isCatchAll)
            route.path += '(.*)*'
        } else {
          route.path += `/${normalizedPath}`
        }
      }
    }

    parentRoutes.push(route)
  })

  // sort by dynamic routes
  let finalRoutes = sortByDynamicRoute(prepareRoutes(ctx, routes))

  // replace duplicated cache all route
  const allRoute = finalRoutes.find((i) => {
    return isCatchAllRoute(parse(i.component).name, nuxtStyle)
  })
  if (allRoute) {
    finalRoutes = finalRoutes.filter(i => !isCatchAllRoute(parse(i.component).name, nuxtStyle))
    finalRoutes.push(allRoute)
  }

  finalRoutes = (await ctx.options.onRoutesGenerated?.(finalRoutes)) || finalRoutes

  let client = generateClientCode(finalRoutes, ctx.options)
  client = (await ctx.options.onClientGenerated?.(client)) || client
  return client
}