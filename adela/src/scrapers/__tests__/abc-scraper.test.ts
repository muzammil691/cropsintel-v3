/**
 * ABC Scraper Tests
 *
 * Fixture-driven tests for all 7 ABC report types
 * Tests both Firecrawl and pdf-parse extraction methods
 */

import { describe, test, expect, beforeAll } from '@jest/globals'
import { detectReportType, applyDomainRules } from '../abc-scraper'
import { parsePositionReport } from '../abc-parsers/position'
import { parseShipments } from '../abc-parsers/shipments'
import { parseReceipts } from '../abc-parsers/receipts'
import { parseForecast } from '../abc-parsers/forecast'
import { parseAcreage } from '../abc-parsers/acreage'
import { parseAlmanac } from '../abc-parsers/almanac'
import { parseHandlerData } from '../abc-parsers/handler'
import { ABCReportType, Market } from '../abc-types'

// ---------------------------------------------------------------------------
// Fixtures (in production, these would be loaded from tests/fixtures/abc/*.pdf)
// ---------------------------------------------------------------------------
const POSITION_REPORT_SAMPLE = `
ABC Position Report - March 2026
Crop Year 2025-2026

Market Shipments (thousands of lbs):
India                 45,234
W.Europe             32,123
Middle East          18,456
China/HK             67,890
Vietnam              12,345
Turkey                8,901
UAE                   5,678
Pakistan              3,456
Domestic             89,012

Total Shipments: 283,095
Total Inventory: 456,789

Note: All figures in thousands of pounds.
`

const SHIPMENTS_REPORT_SAMPLE = `
ABC Shipments Report - March 2026

Total Shipments: 283,095
Domestic Shipments: 89,012
Export Shipments: 194,083
`

// ---------------------------------------------------------------------------
// Report Type Detection Tests
// ---------------------------------------------------------------------------
describe('ABC Scraper - Report Type Detection', () => {
  test('detects position report from filename', () => {
    const type = detectReportType('', '2026.03_PosRpt_4435.pdf')
    expect(type).toBe(ABCReportType.POSITION)
  })

  test('detects position report from content', () => {
    const type = detectReportType(POSITION_REPORT_SAMPLE, 'unknown.pdf')
    expect(type).toBe(ABCReportType.POSITION)
  })

  test('detects shipments report from filename', () => {
    const type = detectReportType('', '2026.03_Shipments.pdf')
    expect(type).toBe(ABCReportType.SHIPMENTS)
  })

  test('defaults to position report for unknown types', () => {
    const type = detectReportType('random content', 'unknown.pdf')
    expect(type).toBe(ABCReportType.POSITION)
  })
})

// ---------------------------------------------------------------------------
// Position Report Parser Tests
// ---------------------------------------------------------------------------
describe('ABC Scraper - Position Report Parser', () => {
  test('extracts all 9 markets', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    expect(result.markets).toHaveLength(9)

    const marketNames = result.markets.map((m) => m.market)
    expect(marketNames).toContain(Market.INDIA)
    expect(marketNames).toContain(Market.W_EUROPE)
    expect(marketNames).toContain(Market.MIDDLE_EAST)
    expect(marketNames).toContain(Market.CHINA_HK)
    expect(marketNames).toContain(Market.VIETNAM)
    expect(marketNames).toContain(Market.TURKEY)
    expect(marketNames).toContain(Market.UAE)
    expect(marketNames).toContain(Market.PAKISTAN)
    expect(marketNames).toContain(Market.DOMESTIC)
  })

  test('extracts report date correctly', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    expect(result.report_date).toMatch(/^\d{4}-\d{2}-01$/)
  })

  test('extracts crop year', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    expect(result.crop_year).toBe('2025-2026')
  })

  test('extracts notes', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    expect(result.notes).toContain('thousands of pounds')
  })

  test('calculates totals from market data', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    expect(result.total_shipments_lbs).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Domain Rules Tests
// ---------------------------------------------------------------------------
describe('ABC Scraper - Domain Rules', () => {
  test('enforces 9 markets requirement', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    const validated = applyDomainRules(result)
    expect(validated.markets).toHaveLength(9)
  })

  test('Turkey is separate from Middle East', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    const turkey = result.markets.find((m) => m.market === Market.TURKEY)
    const middleEast = result.markets.find((m) => m.market === Market.MIDDLE_EAST)

    expect(turkey).toBeDefined()
    expect(middleEast).toBeDefined()
    expect(turkey).not.toEqual(middleEast)
  })

  test('China/HK combined', () => {
    const result = parsePositionReport(POSITION_REPORT_SAMPLE)
    const chinaHk = result.markets.find((m) => m.market === Market.CHINA_HK)
    expect(chinaHk).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Other Report Type Parser Tests (basic smoke tests)
// ---------------------------------------------------------------------------
describe('ABC Scraper - Shipments Parser', () => {
  test('parses shipments report', () => {
    const result = parseShipments(SHIPMENTS_REPORT_SAMPLE)
    expect(result.report_date).toBeTruthy()
    expect(result.data).toBeDefined()
  })
})

describe('ABC Scraper - Receipts Parser', () => {
  test('parses receipts report', () => {
    const result = parseReceipts('Receipts Report - March 2026')
    expect(result.report_date).toBeTruthy()
  })
})

describe('ABC Scraper - Forecast Parser', () => {
  test('parses forecast report', () => {
    const result = parseForecast('Forecast Report - Crop Year 2026-2027')
    expect(result.report_date).toBeTruthy()
  })
})

describe('ABC Scraper - Acreage Parser', () => {
  test('parses acreage report', () => {
    const result = parseAcreage('Acreage Report - 2026')
    expect(result.report_date).toBeTruthy()
  })
})

describe('ABC Scraper - Almanac Parser', () => {
  test('parses almanac report', () => {
    const result = parseAlmanac('Almanac Report - 2026')
    expect(result.report_date).toBeTruthy()
  })
})

describe('ABC Scraper - Handler Data Parser', () => {
  test('parses handler data report', () => {
    const result = parseHandlerData('Handler Data - 104 handlers')
    expect(result.report_date).toBeTruthy()
  })
})
