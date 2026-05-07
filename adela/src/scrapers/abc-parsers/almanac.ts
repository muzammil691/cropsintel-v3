/**
 * Almanac Report Parser
 *
 * Parses ABC almanac reports (industry overview data)
 */

import { GenericReportExtraction } from '../abc-types'

export function parseAlmanac(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  const data = {
    // Almanac typically contains historical summary data
    summary: extractSummaryData(text),
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

function extractSummaryData(text: string): Record<string, unknown> {
  // Almanac format varies - return raw text for now
  return {
    raw_text: text.substring(0, 1000),
  }
}
