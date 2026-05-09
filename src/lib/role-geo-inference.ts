// CropsIntel V3 — Role + geography keyword inference (Phase 1.3b placeholder).
//
// Today's implementation is naïve keyword matching. Phase 1.10 swaps the body
// of `inferRole` and `inferGeography` for a Claude classification edge call,
// but keeps the function shape so callers don't change.
//
// Master plan tie-in: §9.2 R1 Zyra owns natural-language understanding once it
// ships. Until then, we lean on heuristics so the landing UX feels alive.

import { ALL_COUNTRIES, type CountryEntry } from '@/data/countryCityData'

/** Loose role taxonomy used by the landing scaffold (not yet a DB enum). */
export type LandingRole = 'customer' | 'packer' | 'broker' | 'analyst' | 'unknown'

const ROLE_KEYWORDS: Record<Exclude<LandingRole, 'unknown'>, string[]> = {
  customer: [
    'buying',
    'importing',
    'buyer',
    'importer',
    'procurement',
    'sourcing',
    'roaster',
    'distributor',
    'private label',
    'we buy',
    "we're buying",
  ],
  packer: [
    'exporting',
    'packer',
    'exporter',
    'producing',
    'farm',
    'grower',
    'co-op',
    'coop',
    'huller',
    'huller-sheller',
    'we pack',
    'we ship',
    "we're exporting",
  ],
  broker: [
    'broker',
    'brokering',
    'arbitrage',
    'flipping',
    'trading desk',
    'spread',
    'market maker',
    'origination',
  ],
  analyst: ['analyst', 'research', 'just exploring', 'curious', 'studying', 'student'],
}

export interface GeographyHit {
  country?: string
  iso2?: string
  city?: string
}

export function inferRole(message: string): LandingRole {
  const lower = ` ${message.toLowerCase()} `
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS) as [
    Exclude<LandingRole, 'unknown'>,
    string[],
  ][]) {
    if (keywords.some((k) => lower.includes(k))) return role
  }
  return 'unknown'
}

export function inferGeography(message: string): GeographyHit {
  const lower = ` ${message.toLowerCase()} `
  let countryHit: CountryEntry | null = null
  let cityHit: string | undefined

  for (const country of ALL_COUNTRIES) {
    const aliasMatch =
      country.aliases.some((a) => lower.includes(` ${a} `) || lower.includes(` ${a},`) || lower.includes(` ${a}.`)) ||
      lower.includes(` ${country.name.toLowerCase()} `)
    if (aliasMatch) {
      countryHit = country
      break
    }
  }

  // Even without a country alias, a city name can pin geography
  for (const country of ALL_COUNTRIES) {
    for (const city of country.cities) {
      if (lower.includes(` ${city.toLowerCase()} `)) {
        cityHit = city
        if (!countryHit) countryHit = country
        break
      }
    }
    if (cityHit) break
  }

  return {
    country: countryHit?.name,
    iso2: countryHit?.iso2,
    city: cityHit,
  }
}

/** Convert the loose role taxonomy onto the AppRole-adjacent label used in DB columns. */
export function landingRoleToProfileRole(role: LandingRole): string | null {
  if (role === 'unknown') return null
  return role
}
