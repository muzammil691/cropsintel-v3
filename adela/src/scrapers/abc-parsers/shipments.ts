/**
 * Shipments Report Parser
 *
 * Parses ABC shipments data reports
 */

import { GenericReportExtraction } from '../abc-types'

export function parseShipments(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  // Extract shipment data
  const data = {
    total_shipments: extractTotalShipments(text),
    domestic_shipments: extractDomesticShipments(text),
    export_shipments: extractExportShipments(text),
    by_market: extractMarketBreakdown(text),
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

function extractTotalShipments(text: string): number | null {
  const match = text.match(/total\s+shipments?[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) * 1000
  }
  return null
}

function extractDomesticShipments(text: string): number | null {
  const match = text.match(/domestic\s+shipments?[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) * 1000
  }
  return null
}

function extractExportShipments(text: string): number | null {
  const match = text.match(/export\s+shipments?[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) * 1000
  }
  return null
}

function extractMarketBreakdown(text: string): Record<string, number> {
  // Placeholder - would need actual report format analysis
  return {}
}
