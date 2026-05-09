// CropsIntel V3 — Country + city dictionary for landing-page geography inference.
//
// Phase 1.3b: ported in slimmed form from V1 almond-oracle. Used by
// `src/lib/role-geo-inference.ts` to detect a country mention in a guest's
// chat input. Phase 1.10 swaps the keyword pass for Claude classification, but
// the data shape stays the same (so callers don't break).

export interface CountryEntry {
  name: string
  iso2: string
  cities: string[]
  /** Lowercase aliases the keyword scanner accepts ("usa", "us", "united states") */
  aliases: string[]
}

export const ALL_COUNTRIES: CountryEntry[] = [
  {
    name: 'India',
    iso2: 'IN',
    cities: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad'],
    aliases: ['india'],
  },
  {
    name: 'United States',
    iso2: 'US',
    cities: ['Los Angeles', 'San Francisco', 'New York', 'Fresno', 'Modesto', 'Kerman', 'Sacramento'],
    aliases: ['united states', 'usa', 'us', 'america', 'california'],
  },
  {
    name: 'China',
    iso2: 'CN',
    cities: ['Shanghai', 'Beijing', 'Shenzhen', 'Guangzhou', 'Hong Kong'],
    aliases: ['china', 'prc'],
  },
  {
    name: 'Spain',
    iso2: 'ES',
    cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville'],
    aliases: ['spain', 'españa'],
  },
  {
    name: 'Australia',
    iso2: 'AU',
    cities: ['Sydney', 'Melbourne', 'Adelaide', 'Brisbane', 'Perth'],
    aliases: ['australia', 'aus'],
  },
  {
    name: 'United Arab Emirates',
    iso2: 'AE',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
    aliases: ['uae', 'united arab emirates', 'emirates'],
  },
  {
    name: 'Saudi Arabia',
    iso2: 'SA',
    cities: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca'],
    aliases: ['saudi arabia', 'ksa', 'saudi'],
  },
  {
    name: 'Germany',
    iso2: 'DE',
    cities: ['Hamburg', 'Frankfurt', 'Munich', 'Berlin'],
    aliases: ['germany', 'deutschland'],
  },
  {
    name: 'United Kingdom',
    iso2: 'GB',
    cities: ['London', 'Manchester', 'Birmingham', 'Liverpool'],
    aliases: ['uk', 'united kingdom', 'britain', 'england'],
  },
  {
    name: 'Turkey',
    iso2: 'TR',
    cities: ['Istanbul', 'Izmir', 'Ankara', 'Bursa'],
    aliases: ['turkey', 'türkiye'],
  },
  {
    name: 'Italy',
    iso2: 'IT',
    cities: ['Milan', 'Rome', 'Naples', 'Bari'],
    aliases: ['italy', 'italia'],
  },
  {
    name: 'France',
    iso2: 'FR',
    cities: ['Paris', 'Marseille', 'Lyon', 'Bordeaux'],
    aliases: ['france'],
  },
  {
    name: 'Netherlands',
    iso2: 'NL',
    cities: ['Amsterdam', 'Rotterdam', 'The Hague'],
    aliases: ['netherlands', 'holland'],
  },
  {
    name: 'Pakistan',
    iso2: 'PK',
    cities: ['Karachi', 'Lahore', 'Islamabad'],
    aliases: ['pakistan'],
  },
  {
    name: 'Japan',
    iso2: 'JP',
    cities: ['Tokyo', 'Osaka', 'Kyoto', 'Yokohama'],
    aliases: ['japan'],
  },
  {
    name: 'South Korea',
    iso2: 'KR',
    cities: ['Seoul', 'Busan', 'Incheon'],
    aliases: ['south korea', 'korea'],
  },
  {
    name: 'Vietnam',
    iso2: 'VN',
    cities: ['Ho Chi Minh City', 'Hanoi', 'Da Nang'],
    aliases: ['vietnam'],
  },
  {
    name: 'Indonesia',
    iso2: 'ID',
    cities: ['Jakarta', 'Surabaya', 'Bandung'],
    aliases: ['indonesia'],
  },
  {
    name: 'Egypt',
    iso2: 'EG',
    cities: ['Cairo', 'Alexandria', 'Giza'],
    aliases: ['egypt'],
  },
  {
    name: 'Brazil',
    iso2: 'BR',
    cities: ['São Paulo', 'Rio de Janeiro', 'Brasilia'],
    aliases: ['brazil', 'brasil'],
  },
]

export function getCitiesForCountry(country: string): string[] {
  const lower = country.trim().toLowerCase()
  const entry = ALL_COUNTRIES.find(
    (c) => c.name.toLowerCase() === lower || c.aliases.includes(lower) || c.iso2.toLowerCase() === lower,
  )
  return entry?.cities ?? []
}

export function findCountryByAlias(token: string): CountryEntry | null {
  const lower = token.trim().toLowerCase()
  return (
    ALL_COUNTRIES.find(
      (c) => c.name.toLowerCase() === lower || c.aliases.includes(lower) || c.iso2.toLowerCase() === lower,
    ) ?? null
  )
}
