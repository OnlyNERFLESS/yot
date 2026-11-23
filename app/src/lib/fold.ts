// Fold text for matching: Arabic letter variants to Persian, no diacritics or
// half-spaces, Persian digits to ASCII, lowercase. Mirrors geo-core's fold().
export function fold(s: string): string {
  return s
    .replace(/[يىئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[أإٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[\u200C\u200D\-_.,،()/]/g, ' ')
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
