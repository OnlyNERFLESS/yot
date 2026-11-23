//! Text normalisation so Persian, Arabic-keyboard and English input all match.

/// Fold a string for matching: Arabic letter variants to Persian, strip
/// diacritics and tatweel, ZWNJ to space, Persian/Arabic digits to ASCII,
/// lowercase Latin, collapse whitespace.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = true;
    for c in s.chars() {
        let c = match c {
            'ي' | 'ى' | 'ئ' => 'ی',
            'ك' => 'ک',
            'ة' | 'ۀ' => 'ه',
            'أ' | 'إ' | 'ٱ' => 'ا',
            'ؤ' => 'و',
            '\u{064B}'..='\u{065F}' | '\u{0670}' | 'ـ' => continue,
            '\u{200C}' | '\u{200D}' | '-' | '_' | '.' | ',' | '،' | '(' | ')' | '/' => ' ',
            '۰'..='۹' => char::from(b'0' + (c as u32 - '۰' as u32) as u8),
            '٠'..='٩' => char::from(b'0' + (c as u32 - '٠' as u32) as u8),
            _ => c,
        };
        if c.is_whitespace() {
            if !space {
                out.push(' ');
                space = true;
            }
        } else {
            for l in c.to_lowercase() {
                out.push(l);
            }
            space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::fold;

    #[test]
    fn folds_variants() {
        assert_eq!(fold("خيابان  ولي‌عصر"), "خیابان ولی عصر");
        assert_eq!(fold("بانك ۱۲"), "بانک 12");
        assert_eq!(fold("Tajrish Square"), "tajrish square");
    }
}
