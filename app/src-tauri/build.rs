// Bakes the private API keys into the binary at build time, so agents never
// see or type a key. They are read from the workspace's gitignored .env.local
// (or from the same names in the build environment, for CI) and never appear
// in source. Anything compiled in can be extracted from the APK, so the keys
// should be restricted to this app in the provider's panel.
use std::{env, fs, path::Path};

const KEYS: &[(&str, &str)] = &[
    ("NESHAN_SERVICE_KEY", "YOT_BUILTIN_NESHAN_SERVICE_KEY"),
    ("NESHAN_WEB_KEY", "YOT_BUILTIN_NESHAN_WEB_KEY"),
    ("GOOGLE_KEY", "YOT_BUILTIN_GOOGLE_KEY"),
];

fn main() {
    let dotenv = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../.env.local");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    let text = fs::read_to_string(&dotenv).unwrap_or_default();
    for (name, out) in KEYS {
        println!("cargo:rerun-if-env-changed={name}");
        let from_file = text.lines().map(str::trim).filter(|l| !l.starts_with('#')).find_map(|l| {
            let (k, v) = l.split_once('=')?;
            (k.trim() == *name).then(|| v.trim().trim_matches('"').to_string())
        });
        let value = env::var(name).ok().or(from_file).unwrap_or_default();
        if !value.is_empty() && value.chars().all(|c| c.is_ascii_graphic()) {
            println!("cargo:rustc-env={out}={value}");
        }
    }
    tauri_build::build()
}
