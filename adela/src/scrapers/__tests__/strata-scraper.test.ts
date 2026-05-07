/**
 * Strata Price Scraper Tests (Phase 1.6d)
 *
 * Fixture-driven tests for the Strata price scraper.
 * Tests parsing of variety × form × grade × price from HTML fixtures.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { load as cheerioLoad } from 'cheerio'

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------
function loadFixture(filename: string): string {
  const fixturePath = resolve(__dirname, 'fixtures', filename)
  return readFileSync(fixturePath, 'utf-8')
}

// ---------------------------------------------------------------------------
// Parser (extracted from strata-scraper.ts for testing)
// ---------------------------------------------------------------------------
const STRATA_PRICE_SELECTORS = {
  priceTable: "table.prices, table.price-sheet, table[data-type='prices']",
  priceRow: "tr.price-row, tr[data-type='price']",
  variety: "td.variety, td[data-field='variety']",
  form: "td.form, td.product-type, td[data-field='form']",
  grade: "td.grade, td.size, td[data-field='grade']",
  price: "td.price, td.usd-per-lb, td[data-field='price']",
} as const

interface PriceRow {
  variety: string | null
  form: string | null
  grade: string | null
  price: number | null
}

function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "").trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsePricesHtml(html: string): PriceRow[] {
  const $ = cheerioLoad(html)
  const rows: PriceRow[] = []

  const tableSelector = STRATA_PRICE_SELECTORS.priceTable
  const rowSelector = STRATA_PRICE_SELECTORS.priceRow

  $(tableSelector).each((_, table) => {
    $(table)
      .find(rowSelector)
      .each((_, el) => {
        const variety = $(el).find(STRATA_PRICE_SELECTORS.variety).text().trim() || null
        const form = $(el).find(STRATA_PRICE_SELECTORS.form).text().trim() || null
        const grade = $(el).find(STRATA_PRICE_SELECTORS.grade).text().trim() || null
        const priceText = $(el).find(STRATA_PRICE_SELECTORS.price).text().trim()

        const price = parsePrice(priceText)
        if (price == null) return

        rows.push({ variety, form, grade, price })
      })
  })

  return rows
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Strata Price Scraper - Parsing', () => {
  test('parses fixture with non-null variety, form, grade, price', () => {
    const html = loadFixture('strata-sample.html')
    const rows = parsePricesHtml(html)

    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      expect(row.variety).toBeTruthy()
      expect(row.form).toBeTruthy()
      expect(row.grade).toBeTruthy()
      expect(row.price).toBeGreaterThan(0)
    }
  })

  test('extracts expected varieties from fixture', () => {
    const html = loadFixture('strata-sample.html')
    const rows = parsePricesHtml(html)

    const varieties = rows.map((r) => r.variety)
    expect(varieties).toContain('Nonpareil')
    expect(varieties).toContain('Carmel')
    expect(varieties).toContain('Butte')
  })

  test('extracts expected forms from fixture', () => {
    const html = loadFixture('strata-sample.html')
    const rows = parsePricesHtml(html)

    const forms = rows.map((r) => r.form)
    expect(forms).toContain('Whole')
    expect(forms).toContain('Sliced')
    expect(forms).toContain('Pieces')
  })

  test('extracts expected grades from fixture', () => {
    const html = loadFixture('strata-sample.html')
    const rows = parsePricesHtml(html)

    const grades = rows.map((r) => r.grade)
    expect(grades).toContain('23/25')
    expect(grades).toContain('27/30')
    expect(grades).toContain('25/27')
  })

  test('parses prices correctly', () => {
    const html = loadFixture('strata-sample.html')
    const rows = parsePricesHtml(html)

    expect(rows.length).toBe(4)
    expect(rows[0].price).toBe(3.45)
    expect(rows[1].price).toBe(3.20)
    expect(rows[2].price).toBe(2.95)
    expect(rows[3].price).toBe(2.10)
  })
})

describe('Strata Price Scraper - Idempotency', () => {
  test('parsing same fixture twice produces identical results', () => {
    const html = loadFixture('strata-sample.html')
    const rows1 = parsePricesHtml(html)
    const rows2 = parsePricesHtml(html)

    expect(rows1.length).toBe(rows2.length)
    expect(rows1).toEqual(rows2)
  })
})

describe('Strata Price Scraper - Price Parsing Edge Cases', () => {
  test('handles prices with dollar signs', () => {
    expect(parsePrice('$3.45')).toBe(3.45)
  })

  test('handles prices with commas', () => {
    expect(parsePrice('1,234.56')).toBe(1234.56)
  })

  test('handles prices with spaces', () => {
    expect(parsePrice(' 3.45 ')).toBe(3.45)
  })

  test('rejects empty strings', () => {
    expect(parsePrice('')).toBeNull()
  })

  test('rejects non-numeric strings', () => {
    expect(parsePrice('N/A')).toBeNull()
  })

  test('rejects negative prices', () => {
    expect(parsePrice('-3.45')).toBeNull()
  })

  test('rejects zero prices', () => {
    expect(parsePrice('0.00')).toBeNull()
  })
})
