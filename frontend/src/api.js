import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const getHealth     = ()            => api.get('/health')
export const getCategories = ()            => api.get('/categories')

export const scanCategory   = (category, options)   => api.post('/scan/category', { category, options })
export const scanCategories = (categories, options) => api.post('/scan/categories', { categories, options })
export const scanAsin       = (asin, buyPrice)      => api.post('/scan/asin', { asin, buyPrice })

export const calcProfit    = (asin, buyPrice)  => api.post('/profit', { asin, buyPrice })
export const checkApproval = (asin)            => api.post('/approval', { asin })

export const getSchedulerStatus  = ()                           => api.get('/scheduler/status')
export const startScheduler      = (cron, categories, options)  => api.post('/scheduler/start', { cron, categories, options })
export const stopScheduler       = ()                           => api.post('/scheduler/stop')
export const triggerScan         = (categories, options)        => api.post('/scheduler/run', { categories, options })
export const getSchedulerResults = ()                           => api.get('/scheduler/results')

export const analyzeLead  = (lead)        => api.post('/ai/analyze', { lead })
export const analyzeLeads = (leads)       => api.post('/ai/analyze/batch', { leads })
export const quickTake    = (lead)        => api.post('/ai/quicktake', { lead })

export const checkUngating       = (asin, category) => api.post('/ungating', { asin, category })
export const getUngatingStatus   = ()               => api.get('/ungating/status')
export const getSupplierSources  = (lead)           => api.post('/supplier/sources', { lead })
