import { getSupabase } from '@siggistore/supabase'

const supabase = getSupabase()

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'failed',
  'canceled',
  'cancelled',
  'refunded',
]

export const PRODUCT_RUNTIME_TABLE =
  import.meta.env.VITE_SUPABASE_PRODUCTS_TABLE || 'products_runtime'

const DISPLAY_VARIANTS_CHANNEL_PREFIX = '__display_variants:'
const DISPLAY_META_CHANNEL_PREFIX = '__display_meta:'

function encodeDisplayVariantsChannel(variants = []) {
  try {
    return `${DISPLAY_VARIANTS_CHANNEL_PREFIX}${encodeURIComponent(JSON.stringify(variants))}`
  } catch {
    return `${DISPLAY_VARIANTS_CHANNEL_PREFIX}%5B%5D`
  }
}

function decodeDisplayVariantsChannel(channel) {
  if (!String(channel || '').startsWith(DISPLAY_VARIANTS_CHANNEL_PREFIX)) return null

  try {
    const value = String(channel).slice(DISPLAY_VARIANTS_CHANNEL_PREFIX.length)
    const parsed = JSON.parse(decodeURIComponent(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function encodeDisplayMetaChannel(meta = {}) {
  try {
    return `${DISPLAY_META_CHANNEL_PREFIX}${encodeURIComponent(JSON.stringify(meta))}`
  } catch {
    return `${DISPLAY_META_CHANNEL_PREFIX}%7B%7D`
  }
}

function decodeDisplayMetaChannel(channel) {
  if (!String(channel || '').startsWith(DISPLAY_META_CHANNEL_PREFIX)) return null

  try {
    const value = String(channel).slice(DISPLAY_META_CHANNEL_PREFIX.length)
    const parsed = JSON.parse(decodeURIComponent(value))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function splitRuntimeChannels(channels = []) {
  const visibleChannels = []
  let displayVariants = null
  let displayMeta = null

  ;(Array.isArray(channels) ? channels : []).forEach((channel) => {
    const meta = decodeDisplayMetaChannel(String(channel))
    if (meta) {
      displayMeta = meta
      return
    }
    const decoded = decodeDisplayVariantsChannel(String(channel))
    if (decoded) {
      displayVariants = decoded
      return
    }
    if (channel) visibleChannels.push(String(channel))
  })

  return { visibleChannels, displayVariants, displayMeta }
}

function normalizeDisplayVariants(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .map((variant) => ({
      size: String(variant?.size || '').trim(),
      color: String(variant?.color || '').trim(),
      quantity: Math.max(
        0,
        Number(variant?.quantity ?? variant?.stock ?? variant?.inventory ?? 0) || 0,
      ),
    }))
    .filter((variant) => variant.size && variant.color)
}

function getDisplayVariantStock(variants = []) {
  return normalizeDisplayVariants(variants).reduce(
    (sum, variant) => sum + variant.quantity,
    0,
  )
}

function applyRange(query, limit, offset = 0) {
  if (typeof limit !== 'number') return query

  const from = Math.max(0, offset)
  const to = from + Math.max(0, limit) - 1

  return query.range(from, to)
}

function normalizeOrder(row) {
  if (!row) return row

  return {
    ...row,
    user_id: row.user_id ?? row.customer_id ?? null,
    total_amount: Number(row.total_amount ?? row.total ?? 0),
  }
}

function normalizeCustomer(row) {
  if (!row) return row

  return {
    ...row,
    user_id: row.user_id ?? row.id ?? null,
    name:
      row.name ||
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      row.email ||
      'Unknown customer',
  }
}

function normalizeProductRuntime(row) {
  if (!row) return row
  const { visibleChannels, displayVariants, displayMeta } = splitRuntimeChannels(row.channels)
  const normalizedDisplayVariants = normalizeDisplayVariants(
    Array.isArray(row.display_variants)
      ? row.display_variants
      : Array.isArray(row.variants)
        ? row.variants
        : displayVariants || [],
  )
  const variantStock = getDisplayVariantStock(normalizedDisplayVariants)
  const stock = normalizedDisplayVariants.length
    ? variantStock
    : row.stock == null
      ? Number(row.inventory ?? 0) || 0
      : Number(row.stock) || 0

  return {
    ...row,
    sanity_product_id:
      row.sanity_product_id ?? row.product_id ?? row.sanity_id ?? row.slug ?? null,
    price:
      row.price == null
        ? null
        : Number(row.price),
    compare_at_price:
      row.compare_at_price == null
        ? null
        : Number(row.compare_at_price),
    stock,
    sales_count: Number(row.sales_count ?? 0) || 0,
    status: row.status || 'publish',
    is_available:
      normalizedDisplayVariants.length
        ? variantStock > 0
        : row.is_available === undefined || row.is_available === null
        ? true
        : Boolean(row.is_available),
    channels: visibleChannels,
    display_variants: normalizedDisplayVariants,
    display_category: row.display_category || displayMeta?.category || null,
  }
}

async function safeProductRuntimeQuery(executor) {
  try {
    return await executor()
  } catch (error) {
    if (
      error?.code === '42P01' ||
      error?.message?.includes('relation') ||
      error?.message?.includes('does not exist')
    ) {
      return []
    }

    throw error
  }
}

export async function fetchOrders(options = {}) {
  const { limit, offset, status, from, to, query: search } = options

  let request = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    request = request.eq('status', status)
  }

  if (from) {
    request = request.gte('created_at', from)
  }

  if (to) {
    request = request.lte('created_at', to)
  }

  if (search) {
    request = request.or(
      `id.ilike.%${search}%,user_id.ilike.%${search}%,customer_id.ilike.%${search}%`
    )
  }

  request = applyRange(request, limit, offset)

  const { data, error } = await request

  if (error) throw error

  return (data ?? []).map(normalizeOrder)
}

export async function fetchOrderById(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (error) throw error

  return normalizeOrder(data)
}

export async function fetchOrdersSince(sinceIso) {
  return fetchOrders({ from: sinceIso })
}

export async function fetchOrdersBetween(startIso, endIso) {
  return fetchOrders({ from: startIso, to: endIso })
}

export async function fetchCustomers(options = {}) {
  const { limit, offset, from, to, query: search } = options

  let request = supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })

  if (from) {
    request = request.gte('created_at', from)
  }

  if (to) {
    request = request.lte('created_at', to)
  }

  if (search) {
    request = request.or(
      `email.ilike.%${search}%,name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
    )
  }

  request = applyRange(request, limit, offset)

  const { data, error } = await request

  if (error) throw error

  return (data ?? []).map(normalizeCustomer)
}

export async function fetchCustomersBetween(startIso, endIso) {
  return fetchCustomers({ from: startIso, to: endIso })
}

export async function fetchCustomersByIds(ids = []) {
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .in('id', ids)

  if (error) throw error

  return (data ?? []).map(normalizeCustomer)
}

export async function fetchProfilesByIds(ids = []) {
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids)

  if (error) throw error

  return data ?? []
}

export async function fetchOrderItemsByOrderIds(orderIds = []) {
  if (!orderIds.length) return []

  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)

  if (error) throw error

  return data ?? []
}

export async function updateOrderStatus(orderId, status) {
  const updatedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      updated_at: updatedAt,
    })
    .eq('id', orderId)
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) {
    throw new Error(`Order ${orderId} was not found in Supabase.`)
  }

  return normalizeOrder({
    id: orderId,
    status,
    updated_at: updatedAt,
  })
}

export async function deleteOrder(orderId) {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', orderId)

  if (error) throw error

  return { id: orderId }
}

export async function fetchDiscounts(options = {}) {
  const { limit, offset, status, query: search } = options

  let request = supabase
    .from('discounts')
    .select('*')
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    request = request.eq('status', status)
  }

  if (search) {
    request = request.or(`code.ilike.%${search}%,type.ilike.%${search}%`)
  }

  request = applyRange(request, limit, offset)

  const { data, error } = await request

  if (error) throw error

  return data ?? []
}

export async function fetchProductRuntime(options = {}) {
  const {
    limit,
    offset,
    ids = [],
    status,
    query: search,
    table = PRODUCT_RUNTIME_TABLE,
  } = options

  return safeProductRuntimeQuery(async () => {
    const normalizedIds = [...new Set(ids.filter(Boolean).map(String))]
    let request = supabase
      .from(table)
      .select('*')
      .order('updated_at', { ascending: false, nullsFirst: false })

    if (status && status !== 'all') {
      request = request.eq('status', status)
    }

    if (search) {
      request = request.or(
        `sanity_product_id.ilike.%${search}%,product_id.ilike.%${search}%,slug.ilike.%${search}%,sku.ilike.%${search}%`
      )
    }

    request = applyRange(request, limit, offset)

    const { data, error } = await request
    if (error) throw error

    const normalizedRows = (data ?? []).map(normalizeProductRuntime)

    if (!normalizedIds.length) {
      return normalizedRows
    }

    return normalizedRows.filter((row) =>
      [row.sanity_product_id, row.product_id, row.slug, row.sku]
        .filter(Boolean)
        .some((value) => normalizedIds.includes(String(value)))
    )
  })
}

export async function fetchProductRuntimeByIds(ids = [], options = {}) {
  if (!ids.length) return []

  return fetchProductRuntime({
    ...options,
    ids,
  })
}

export function getProductStockState(product, options = {}) {
  const lowStockThreshold = Number(options.lowStockThreshold ?? 5)
  const stock = Math.max(0, Number(product?.stock ?? 0) || 0)
  const isAvailable = Boolean(product?.isAvailable)

  if (!isAvailable || stock <= 0) {
    return {
      key: 'out_of_stock',
      label: 'Out of stock',
      stock,
    }
  }

  if (stock <= lowStockThreshold) {
    return {
      key: 'low_stock',
      label: 'Low in stock',
      stock,
    }
  }

  return {
    key: 'in_stock',
    label: 'In stock',
    stock,
  }
}

export async function updateProductRuntimeAvailability(
  product,
  isAvailable,
  options = {},
) {
  const table = options.table || PRODUCT_RUNTIME_TABLE
  const nextAvailability = Boolean(isAvailable)
  const identifiers = {
    sanity_product_id: product?.runtime?.sanity_product_id || product?.id || null,
    product_id: product?.runtime?.product_id || null,
    slug: product?.slug || null,
    sku: product?.sku || null,
  }

  const payload = {
    ...identifiers,
    stock: Math.max(0, Number(product?.stock ?? 0) || 0),
    status: nextAvailability ? 'publish' : 'unpublish',
    is_available: nextAvailability,
    updated_at: new Date().toISOString(),
  }

  if (product?.runtime?.id) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', product.runtime.id)
      .select('*')
      .single()

    if (error) throw error
    return normalizeProductRuntime(data)
  }

  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return normalizeProductRuntime(data)
}

export async function updateProductRuntimeDisplay(
  product,
  display = {},
  options = {},
) {
  const table = options.table || PRODUCT_RUNTIME_TABLE
  const variants = normalizeDisplayVariants(display.variants)
  const tags = Array.isArray(display.tags)
    ? display.tags.filter(Boolean).map(String)
    : []
  const stock = getDisplayVariantStock(variants)
  const nextAvailability = stock > 0
  const identifiers = {
    sanity_product_id: product?.runtime?.sanity_product_id || product?.id || null,
    product_id: product?.runtime?.product_id || null,
    slug: product?.slug || null,
    sku: product?.sku || null,
  }

  const payload = {
    ...identifiers,
    stock,
    status: nextAvailability ? 'publish' : 'unpublish',
    is_available: nextAvailability,
    channels: [
      ...tags,
      encodeDisplayMetaChannel({ category: display.category || null }),
      encodeDisplayVariantsChannel(variants),
    ],
    updated_at: new Date().toISOString(),
  }

  if (product?.runtime?.id) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', product.runtime.id)
      .select('*')
      .single()

    if (error) throw error
    return normalizeProductRuntime(data)
  }

  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return normalizeProductRuntime(data)
}

export function mergeProductWithRuntime(product, runtime) {
  if (!runtime) return product
  const displayVariants = normalizeDisplayVariants(runtime.display_variants)
  const variantStock = getDisplayVariantStock(displayVariants)
  const hasDisplayVariants = displayVariants.length > 0

  return {
    ...product,
    runtime,
    sku: runtime.sku || product.sku,
    price:
      runtime.price == null || Number.isNaN(runtime.price)
        ? product.price
        : runtime.price,
    compareAtPrice:
      runtime.compare_at_price == null || Number.isNaN(runtime.compare_at_price)
        ? product.compareAtPrice
        : runtime.compare_at_price,
    stock: hasDisplayVariants
      ? variantStock
      : runtime.stock == null || Number.isNaN(runtime.stock)
        ? product.stock
        : runtime.stock,
    status: runtime.status || product.status,
    isAvailable:
      hasDisplayVariants
        ? variantStock > 0
        : runtime.is_available === undefined || runtime.is_available === null
        ? product.isAvailable
        : Boolean(runtime.is_available),
    channels:
      Array.isArray(runtime.channels) && runtime.channels.length
        ? runtime.channels
        : product.channels,
    displayVariants:
      hasDisplayVariants
        ? displayVariants
        : product.displayVariants,
    displayCategory: runtime.display_category || product.displayCategory,
    salesCount: Number(runtime.sales_count ?? product.salesCount ?? 0) || 0,
    featured:
      runtime.featured === undefined
        ? Boolean(product.featured)
        : Boolean(runtime.featured),
  }
}

export async function fetchConversations(options = {}) {
  const { limit, offset, query: search } = options

  let request = supabase
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (search) {
    request = request.or(
      `id.ilike.%${search}%,customer_id.ilike.%${search}%,last_message.ilike.%${search}%`
    )
  }

  request = applyRange(request, limit, offset)

  const { data, error } = await request

  if (error) throw error

  return data ?? []
}

export async function fetchMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return data ?? []
}

export async function sendMessage({
  conversationId,
  senderId = null,
  senderRole,
  content,
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      content,
    })
    .select('*')
    .single()

  if (error) throw error

  return data
}

export async function getOverviewMetrics(options = {}) {
  const { recentLimit = 10, rangeDays = 30 } = options
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - rangeDays)

  const [orders, customers] = await Promise.all([
    fetchOrders({ from: sinceDate.toISOString(), limit: 500 }),
    fetchCustomers({ from: sinceDate.toISOString(), limit: 500 }),
  ])

  const revenue = orders.reduce(
    (sum, order) => sum + Number(order.total_amount ?? 0),
    0
  )

  const pendingOrders = orders.filter((order) => order.status === 'pending')
  const failedOrders = orders.filter((order) => order.status === 'failed')
  const refundedOrders = orders.filter((order) => order.status === 'refunded')

  return {
    metrics: {
      revenue,
      orders: orders.length,
      customers: customers.length,
      averageOrderValue: orders.length ? revenue / orders.length : 0,
      pendingOrders: pendingOrders.length,
      failedOrders: failedOrders.length,
      refundedOrders: refundedOrders.length,
    },
    recentOrders: orders.slice(0, recentLimit),
    recentCustomers: customers.slice(0, recentLimit),
  }
}

export function getOrderTotal(order) {
  return Number(order?.total_amount ?? order?.total ?? 0)
}

export function getOrderItemUnitPrice(item) {
  return Number(item?.price_snapshot ?? item?.price ?? 0)
}

export default {
  supabase,
  fetchOrders,
  fetchOrderById,
  fetchOrdersSince,
  fetchOrdersBetween,
  fetchCustomers,
  fetchCustomersBetween,
  fetchCustomersByIds,
  fetchProfilesByIds,
  fetchOrderItemsByOrderIds,
  updateOrderStatus,
  deleteOrder,
  fetchDiscounts,
  fetchProductRuntime,
  fetchProductRuntimeByIds,
  getProductStockState,
  mergeProductWithRuntime,
  updateProductRuntimeAvailability,
  updateProductRuntimeDisplay,
  fetchConversations,
  fetchMessages,
  sendMessage,
  getOverviewMetrics,
  getOrderTotal,
  getOrderItemUnitPrice,
}
