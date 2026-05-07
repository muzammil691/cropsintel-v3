/**
 * News RSS Scraper Tests (Phase 1.6d)
 *
 * Fixture-driven tests for the news scraper.
 * Tests RSS/Atom feed parsing and field validation from XML fixtures.
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
// Parser (extracted from news-scraper.ts for testing)
// ---------------------------------------------------------------------------
const RSS_SELECTORS = {
  item: 'item, entry',
  title: 'title',
  link: 'link',
  pubDate: 'pubDate, published, updated',
  description: 'description, summary, content',
} as const

interface ParsedFeedItem {
  title: string
  link: string
  pubDate: string | null
  description: string | null
}

function parseFeed(xml: string): ParsedFeedItem[] {
  const $ = cheerioLoad(xml, { xmlMode: true })
  const items: ParsedFeedItem[] = []

  $(RSS_SELECTORS.item).each((_, el) => {
    const title = $(el).find(RSS_SELECTORS.title).first().text().trim()
    if (!title) return

    let link = $(el).find(RSS_SELECTORS.link).first().attr('href') ?? ''
    if (!link) {
      link = $(el).find(RSS_SELECTORS.link).first().text().trim()
    }
    if (!link) return

    const pubDate = $(el).find(RSS_SELECTORS.pubDate).first().text().trim() || null
    const description = $(el).find(RSS_SELECTORS.description).first().text().trim() || null

    items.push({ title, link, pubDate, description })
  })

  return items
}

function validateFeedItem(item: ParsedFeedItem): boolean {
  return !!(item.title && item.link && item.pubDate)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('News Scraper - ABC Feed Parsing', () => {
  test('parses ABC fixture with non-null title, url, published_date', () => {
    const xml = loadFixture('news-sample-abc.xml')
    const items = parseFeed(xml)

    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      expect(item.title).toBeTruthy()
      expect(item.link).toBeTruthy()
      expect(item.pubDate).toBeTruthy()
    }
  })

  test('extracts all items from ABC feed', () => {
    const xml = loadFixture('news-sample-abc.xml')
    const items = parseFeed(xml)

    expect(items.length).toBe(3)
  })

  test('validates all ABC feed items', () => {
    const xml = loadFixture('news-sample-abc.xml')
    const items = parseFeed(xml)

    for (const item of items) {
      expect(validateFeedItem(item)).toBe(true)
    }
  })
})

describe('News Scraper - Fresh Plaza Feed Parsing', () => {
  test('parses Fresh Plaza fixture with non-null title, url, published_date', () => {
    const xml = loadFixture('news-sample-freshplaza.xml')
    const items = parseFeed(xml)

    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      expect(item.title).toBeTruthy()
      expect(item.link).toBeTruthy()
      expect(item.pubDate).toBeTruthy()
    }
  })

  test('extracts all items from Fresh Plaza feed', () => {
    const xml = loadFixture('news-sample-freshplaza.xml')
    const items = parseFeed(xml)

    expect(items.length).toBe(2)
  })
})

describe('News Scraper - ProduceReport Feed Parsing', () => {
  test('parses ProduceReport fixture with non-null title, url, published_date', () => {
    const xml = loadFixture('news-sample-producereport.xml')
    const items = parseFeed(xml)

    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      expect(item.title).toBeTruthy()
      expect(item.link).toBeTruthy()
      expect(item.pubDate).toBeTruthy()
    }
  })

  test('extracts all items from ProduceReport feed', () => {
    const xml = loadFixture('news-sample-producereport.xml')
    const items = parseFeed(xml)

    expect(items.length).toBe(2)
  })
})

describe('News Scraper - Field Validation', () => {
  test('rejects items with missing title', () => {
    const item: ParsedFeedItem = {
      title: '',
      link: 'https://example.com',
      pubDate: '2026-02-01',
      description: 'Test',
    }
    expect(validateFeedItem(item)).toBe(false)
  })

  test('rejects items with missing link', () => {
    const item: ParsedFeedItem = {
      title: 'Test',
      link: '',
      pubDate: '2026-02-01',
      description: 'Test',
    }
    expect(validateFeedItem(item)).toBe(false)
  })

  test('rejects items with missing pubDate', () => {
    const item: ParsedFeedItem = {
      title: 'Test',
      link: 'https://example.com',
      pubDate: null,
      description: 'Test',
    }
    expect(validateFeedItem(item)).toBe(false)
  })

  test('accepts items with missing description', () => {
    const item: ParsedFeedItem = {
      title: 'Test',
      link: 'https://example.com',
      pubDate: '2026-02-01',
      description: null,
    }
    expect(validateFeedItem(item)).toBe(true)
  })

  test('accepts valid items', () => {
    const item: ParsedFeedItem = {
      title: 'Test',
      link: 'https://example.com',
      pubDate: '2026-02-01',
      description: 'Test description',
    }
    expect(validateFeedItem(item)).toBe(true)
  })
})

describe('News Scraper - Idempotency', () => {
  test('parsing same fixture twice produces identical results', () => {
    const xml = loadFixture('news-sample-abc.xml')
    const items1 = parseFeed(xml)
    const items2 = parseFeed(xml)

    expect(items1.length).toBe(items2.length)
    expect(items1).toEqual(items2)
  })
})

describe('News Scraper - Cross-Feed Consistency', () => {
  test('all three feeds parse without errors', () => {
    const abcXml = loadFixture('news-sample-abc.xml')
    const freshPlazaXml = loadFixture('news-sample-freshplaza.xml')
    const produceReportXml = loadFixture('news-sample-producereport.xml')

    const abcItems = parseFeed(abcXml)
    const freshPlazaItems = parseFeed(freshPlazaXml)
    const produceReportItems = parseFeed(produceReportXml)

    expect(abcItems.length).toBe(3)
    expect(freshPlazaItems.length).toBe(2)
    expect(produceReportItems.length).toBe(2)

    const allItems = [...abcItems, ...freshPlazaItems, ...produceReportItems]
    expect(allItems.length).toBe(7)

    for (const item of allItems) {
      expect(validateFeedItem(item)).toBe(true)
    }
  })
})
