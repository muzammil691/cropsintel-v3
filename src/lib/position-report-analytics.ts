// CropsIntel V3 — Position Report Analytics Layer
//
// Ported from V1's positionReportAnalyticsLayer.ts
// All functions return { value, trend, confidence } for consistent UX treatment
//
// NEVER modify this logic without reviewing against V1's original implementation.

export interface AnalyticsResult {
  value: number
  trend: 'up' | 'down' | 'flat'
  confidence: number
}

/**
 * Compute year-over-year performance
 * @param current - Current period value
 * @param prior - Prior year same period value
 * @returns YoY change percentage with trend indicator
 */
export function computeYoY(current: number, prior: number): AnalyticsResult {
  if (prior === 0) {
    return {
      value: current > 0 ? 100 : 0,
      trend: current > 0 ? 'up' : 'flat',
      confidence: prior === 0 && current === 0 ? 0.3 : 0.7,
    }
  }

  const yoyChange = ((current - prior) / prior) * 100
  const threshold = 2 // 2% threshold for "flat"

  let trend: 'up' | 'down' | 'flat'
  if (Math.abs(yoyChange) < threshold) {
    trend = 'flat'
  } else if (yoyChange > 0) {
    trend = 'up'
  } else {
    trend = 'down'
  }

  // Higher confidence when both values are non-zero and substantial
  const avgValue = (current + prior) / 2
  const confidence = avgValue > 1000 ? 0.95 : avgValue > 100 ? 0.85 : 0.7

  return { value: yoyChange, trend, confidence }
}

/**
 * Compute pace vs prior year (normalized for days elapsed)
 * @param ytd - Year-to-date total
 * @param priorYtd - Prior year YTD at same point
 * @param daysElapsed - Days into the year
 * @returns Pace comparison with trend
 */
export function computePaceVsPriorYear(
  ytd: number,
  priorYtd: number,
  daysElapsed: number
): AnalyticsResult {
  if (daysElapsed <= 0) {
    return { value: 0, trend: 'flat', confidence: 0 }
  }

  // Daily pace calculation
  const currentPace = ytd / daysElapsed
  const priorPace = priorYtd / daysElapsed

  if (priorPace === 0) {
    return {
      value: currentPace > 0 ? 100 : 0,
      trend: currentPace > 0 ? 'up' : 'flat',
      confidence: 0.5,
    }
  }

  const paceChange = ((currentPace - priorPace) / priorPace) * 100
  const threshold = 3 // 3% threshold for pace changes

  let trend: 'up' | 'down' | 'flat'
  if (Math.abs(paceChange) < threshold) {
    trend = 'flat'
  } else if (paceChange > 0) {
    trend = 'up'
  } else {
    trend = 'down'
  }

  // Confidence increases with more days of data
  const confidence = Math.min(0.95, 0.5 + (daysElapsed / 365) * 0.45)

  return { value: paceChange, trend, confidence }
}

/**
 * Compute commitment rate (shipped / contracted)
 * @param shipped - Total shipped quantity
 * @param contracted - Total contracted quantity
 * @returns Commitment rate as percentage
 */
export function computeCommitmentRate(
  shipped: number,
  contracted: number
): AnalyticsResult {
  if (contracted === 0) {
    return {
      value: 0,
      trend: 'flat',
      confidence: 0.2,
    }
  }

  const commitmentRate = (shipped / contracted) * 100

  // Ideal commitment rate is 80-100%
  // Below 60% is concerning (down), above 90% is strong (up)
  let trend: 'up' | 'down' | 'flat'
  if (commitmentRate >= 90) {
    trend = 'up'
  } else if (commitmentRate < 60) {
    trend = 'down'
  } else {
    trend = 'flat'
  }

  // Higher confidence when contracted amount is substantial
  const confidence = contracted > 10000 ? 0.95 : contracted > 1000 ? 0.85 : 0.7

  return { value: commitmentRate, trend, confidence }
}

/**
 * Compute available inventory (crop - shipped - in_transit)
 * @param crop - Total crop size
 * @param shipped - Already shipped quantity
 * @param inTransit - Currently in transit quantity
 * @returns Available inventory in lbs
 */
export function computeAvailableInventory(
  crop: number,
  shipped: number,
  inTransit: number
): AnalyticsResult {
  const available = Math.max(0, crop - shipped - inTransit)

  // Trend based on percentage of crop still available
  const percentageAvailable = crop > 0 ? (available / crop) * 100 : 0

  let trend: 'up' | 'down' | 'flat'
  if (percentageAvailable > 50) {
    trend = 'up' // Plenty available
  } else if (percentageAvailable < 20) {
    trend = 'down' // Running low
  } else {
    trend = 'flat' // Moderate availability
  }

  // Confidence based on data completeness
  const hasAllData = crop > 0 && (shipped > 0 || inTransit > 0)
  const confidence = hasAllData ? 0.9 : 0.6

  return { value: available, trend, confidence }
}

/**
 * Compute demand strength (current pace vs historical average)
 * @param currentPace - Current pace (e.g., lbs/day)
 * @param historicalAvg - Historical average pace
 * @returns Demand strength indicator
 */
export function computeDemandStrength(
  currentPace: number,
  historicalAvg: number
): AnalyticsResult {
  if (historicalAvg === 0) {
    return {
      value: currentPace,
      trend: currentPace > 0 ? 'up' : 'flat',
      confidence: 0.4,
    }
  }

  const demandRatio = (currentPace / historicalAvg) * 100

  // Strong demand: > 110% of historical
  // Weak demand: < 90% of historical
  let trend: 'up' | 'down' | 'flat'
  if (demandRatio > 110) {
    trend = 'up'
  } else if (demandRatio < 90) {
    trend = 'down'
  } else {
    trend = 'flat'
  }

  // Higher confidence with more historical data and higher average
  const confidence = historicalAvg > 1000 ? 0.9 : historicalAvg > 100 ? 0.75 : 0.6

  return { value: demandRatio, trend, confidence }
}
