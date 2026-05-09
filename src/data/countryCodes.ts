// Phase 1.3a — country-code list for WhatsApp/phone forms.
//
// Pared-down version of V1's full list. Covers the ~30 jurisdictions where the
// initial V3 customer base sits (Middle East, Europe, North America, India,
// East Asia). Add more as new buyer regions onboard.

export interface CountryCode {
  code: string
  dialCode: string
  name: string
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: 'AE', dialCode: '+971', name: 'United Arab Emirates' },
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia' },
  { code: 'KW', dialCode: '+965', name: 'Kuwait' },
  { code: 'QA', dialCode: '+974', name: 'Qatar' },
  { code: 'BH', dialCode: '+973', name: 'Bahrain' },
  { code: 'OM', dialCode: '+968', name: 'Oman' },
  { code: 'JO', dialCode: '+962', name: 'Jordan' },
  { code: 'LB', dialCode: '+961', name: 'Lebanon' },
  { code: 'EG', dialCode: '+20', name: 'Egypt' },
  { code: 'TR', dialCode: '+90', name: 'Turkey' },
  { code: 'IN', dialCode: '+91', name: 'India' },
  { code: 'PK', dialCode: '+92', name: 'Pakistan' },
  { code: 'BD', dialCode: '+880', name: 'Bangladesh' },
  { code: 'CN', dialCode: '+86', name: 'China' },
  { code: 'JP', dialCode: '+81', name: 'Japan' },
  { code: 'KR', dialCode: '+82', name: 'South Korea' },
  { code: 'SG', dialCode: '+65', name: 'Singapore' },
  { code: 'MY', dialCode: '+60', name: 'Malaysia' },
  { code: 'ID', dialCode: '+62', name: 'Indonesia' },
  { code: 'TH', dialCode: '+66', name: 'Thailand' },
  { code: 'VN', dialCode: '+84', name: 'Vietnam' },
  { code: 'AU', dialCode: '+61', name: 'Australia' },
  { code: 'NZ', dialCode: '+64', name: 'New Zealand' },
  { code: 'US', dialCode: '+1', name: 'United States' },
  { code: 'CA', dialCode: '+1', name: 'Canada' },
  { code: 'MX', dialCode: '+52', name: 'Mexico' },
  { code: 'BR', dialCode: '+55', name: 'Brazil' },
  { code: 'AR', dialCode: '+54', name: 'Argentina' },
  { code: 'CL', dialCode: '+56', name: 'Chile' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom' },
  { code: 'IE', dialCode: '+353', name: 'Ireland' },
  { code: 'DE', dialCode: '+49', name: 'Germany' },
  { code: 'FR', dialCode: '+33', name: 'France' },
  { code: 'IT', dialCode: '+39', name: 'Italy' },
  { code: 'ES', dialCode: '+34', name: 'Spain' },
  { code: 'PT', dialCode: '+351', name: 'Portugal' },
  { code: 'NL', dialCode: '+31', name: 'Netherlands' },
  { code: 'BE', dialCode: '+32', name: 'Belgium' },
  { code: 'CH', dialCode: '+41', name: 'Switzerland' },
  { code: 'AT', dialCode: '+43', name: 'Austria' },
  { code: 'SE', dialCode: '+46', name: 'Sweden' },
  { code: 'NO', dialCode: '+47', name: 'Norway' },
  { code: 'DK', dialCode: '+45', name: 'Denmark' },
  { code: 'FI', dialCode: '+358', name: 'Finland' },
  { code: 'PL', dialCode: '+48', name: 'Poland' },
  { code: 'GR', dialCode: '+30', name: 'Greece' },
  { code: 'IL', dialCode: '+972', name: 'Israel' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa' },
  { code: 'NG', dialCode: '+234', name: 'Nigeria' },
  { code: 'KE', dialCode: '+254', name: 'Kenya' },
  { code: 'MA', dialCode: '+212', name: 'Morocco' },
]

export const DEFAULT_COUNTRY_CODE = COUNTRY_CODES[0]
