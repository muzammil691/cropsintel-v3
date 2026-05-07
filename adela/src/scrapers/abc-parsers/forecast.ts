/**
 * Forecast Report Parser
 *
 * Parses ABC forecast reports
 */

import { GenericReportExtraction } from '../abc-types'

export function parseForecast(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  const data = {
    crop_year: extractCropYear(text),
    forecast_production: extractForecastProduction(text),
    forecast_yield: extractForecastYield(text),
  }

  return {
    report_date: reportDate,
    data,
    notes,
  }
}

function extractReportDate(text: string): string {
  const match = text.match(/(\d{4})-(\d{2})/)
  if (match) {
    return `${match[1]}-${match[2]}-01`
  }

  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function extractNotes(text: string): string | null {
  const match = text.match(/note[s]?:(.+?)(?:\n\n|\n[A-Z]|$)/is)
  return match ? match[1].trim().substring(0, 500) : null
}

function extractCropYear(text: string): string | null {
  const match = text.match(/crop\s+year[:\s]+(\d{4})[\/\-](\d{4})/i)
  return match ? `${match[1]}-${match[2]}` : null
}

function extractForecastProduction(text: string): number | null {
  const match = text.match(/forecast\s+production[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) * 1000
  }
  return null
}

function extractForecastYield(text: string): number | null {
  const match = text.match(/yield[:\s]+(\d[\d,\.]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''))
  }
  return null
}
