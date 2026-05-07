/**
 * Receipts Report Parser
 *
 * Parses ABC receipts data reports
 */

import { GenericReportExtraction } from '../abc-types'

export function parseReceipts(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  const data = {
    total_receipts: extractTotalReceipts(text),
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

function extractTotalReceipts(text: string): number | null {
  const match = text.match(/total\s+receipts?[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) * 1000
  }
  return null
}

function extractHandlerBreakdown(text: string): Record<string, number> {
  // Placeholder
  return {}
}
