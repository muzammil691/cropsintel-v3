/**
 * ABC Scraper Types
 * Shared type definitions for all 7 ABC report types
 */

export enum ABCReportType {
  POSITION = 'position',
  SHIPMENTS = 'shipments',
  RECEIPTS = 'receipts',
  FORECAST = 'forecast',
  ACREAGE = 'acreage',
  ALMANAC = 'almanac',
  HANDLER = 'handler',
}

/**
 * 9 fixed markets for position reports (per task spec critical domain rules)
 */
export enum Market {
  INDIA = 'India',
  W_EUROPE = 'W.Europe',
  MIDDLE_EAST = 'Middle East',
  CHINA_HK = 'China/HK',
  VIETNAM = 'Vietnam',
  TURKEY = 'Turkey',
  UAE = 'UAE',
  PAKISTAN = 'Pakistan',
  DOMESTIC = 'Domestic',
}

/**
 * Position report row - one per market
 */
export interface PositionReportRow {
  market: Market
  shipments_lbs: number | null
  receipts_lbs: number | null
  inventory_lbs: number | null
  ytd_shipments_lbs: number | null
}

/**
 * Complete position report extraction
 */
export interface PositionReportExtraction {
  report_date: string // ISO YYYY-MM-DD
  crop_year: string | null
  markets: PositionReportRow[]
  total_shipments_lbs: number | null
  total_inventory_lbs: number | null
  notes: string | null
}

/**
 * Generic extraction result for other report types
 */
export interface GenericReportExtraction {
  report_date: string
  data: Record<string, unknown>
  notes: string | null
}

/**
 * PDF extraction method
 */
export enum ExtractionMethod {
  FIRECRAWL = 'firecrawl',
  PDF_PARSE = 'pdf-parse',
}

/**
 * PDF fetch result
 */
export interface PdfFetchResult {
  text: string
  method: ExtractionMethod
  filename: string
}

/**
 * Scraper run metadata for audit logging
 */
export interface ScraperRunMeta {
  runId: string
  scraper: string
  reportType: ABCReportType
  reportDate: string
  source: string
  method: ExtractionMethod
  rowsInserted: number
  storagePath: string | null
}
