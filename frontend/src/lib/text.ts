const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
export const normalizeDigits = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
export const normalizeFa = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
