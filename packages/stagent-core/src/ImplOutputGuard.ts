const HOLLOW_IMPL_PATTERNS = [
  /^好的[，,]?\s*已确认/m,
  /^我将(严格按照|按照|遵循)/m,
  /^Confirmed[.,]/mi,
];

export function isHollowImplOutput(text: string): boolean {
  if (/```/.test(text)) {
    return false;
  }
  return HOLLOW_IMPL_PATTERNS.some((re) => re.test(text.trim()));
}
