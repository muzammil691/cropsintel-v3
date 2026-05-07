/**
 * Handler Data Report Parser
 *
 * Parses ABC handler data reports
 */

import { GenericReportExtraction } from '../abc-types'

export function parseHandlerData(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  const data = {
    handler_count: extractHandlerCount(text),
    by_handler: extractHandlerBreakdown(text),
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

function extractHandlerCount(text: string): number | null {
  const match = text.match(/(\d+)\s+handlers?/i)
  return match ? parseInt(match[1]) : null
}

function extractHandlerBreakdown(text: string): Record<string, unknown> {
  // Placeholder
  return {}
}
