/**
 * Acreage Report Parser
 *
 * Parses ABC acreage reports
 */

import { GenericReportExtraction } from '../abc-types'

export function parseAcreage(text: string): GenericReportExtraction {
  const reportDate = extractReportDate(text)
  const notes = extractNotes(text)

  const data = {
    crop_year: extractCropYear(text),
    bearing_acreage: extractBearingAcreage(text),
    non_bearing_acreage: extractNonBearingAcreage(text),
    total_acreage: extractTotalAcreage(text),
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

function extractBearingAcreage(text: string): number | null {
  const match = text.match(/bearing[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''))
  }
  return null
}

function extractNonBearingAcreage(text: string): number | null {
  const match = text.match(/non[- ]bearing[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''))
  }
  return null
}

function extractTotalAcreage(text: string): number | null {
  const match = text.match(/total\s+acreage[:\s]+(\d[\d,]*)/i)
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''))
  }
  return null
}
