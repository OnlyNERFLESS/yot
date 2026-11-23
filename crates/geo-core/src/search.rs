//! Offline place search: folded-text match ranked by match quality, importance
//! and distance, with near-duplicates merged.

use serde::Serialize;

use crate::format::Places;
use crate::geo::{haversine, to_deg};
use crate::normalize::fold;

#[derive(Clone, Debug, Serialize)]
pub struct Hit {
    pub name: String,
    pub name_en: String,
    pub kind: String,
    pub lat: f64,
    pub lon: f64,
    pub distance_m: f64,
    pub phone: String,
    pub hours: String,
    pub website: String,
    pub address: String,
}

fn hit(places: &Places, i: usize, distance_m: f64) -> Hit {
    let p = &places.items[i];
    Hit {
        name: p.name.clone(),
        name_en: p.name_en.clone(),
        kind: places.kinds[p.kind as usize].clone(),
        lat: to_deg(p.lat),
        lon: to_deg(p.lon),
        distance_m,
        phone: p.phone.clone(),
        hours: p.hours.clone(),
        website: p.website.clone(),
        address: p.address.clone(),
    }
}

/// Nearest places whose kind matches any of `kinds` ("amenity=fuel", or a whole
/// family "tourism=*"), within `radius_m` of `near`, nearest first.
pub fn nearby(places: &Places, kinds: &[String], near: (f64, f64), radius_m: f64, limit: usize) -> Vec<Hit> {
    let wanted: Vec<bool> = places
        .kinds
        .iter()
        .map(|k| {
            kinds.iter().any(|w| match w.strip_suffix("=*") {
                Some(fam) => k.split('=').next() == Some(fam),
                None => k == w,
            })
        })
        .collect();
    let mut found: Vec<(f64, usize)> = places
        .items
        .iter()
        .enumerate()
        .filter(|(_, p)| wanted[p.kind as usize])
        .map(|(i, p)| (haversine(near.0, near.1, to_deg(p.lat), to_deg(p.lon)), i))
        .filter(|(d, _)| *d <= radius_m)
        .collect();
    found.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    found.into_iter().take(limit).map(|(d, i)| hit(places, i, d)).collect()
}

/// The place a map label refers to: the same name within `max_m`, else the
/// nearest named place within `max_m / 2`.
pub fn place_at(places: &Places, name: &str, at: (f64, f64), max_m: f64) -> Option<Hit> {
    let want = fold(name);
    let mut best: Option<(f64, usize)> = None;
    for (i, p) in places.items.iter().enumerate() {
        let d = haversine(at.0, at.1, to_deg(p.lat), to_deg(p.lon));
        if d > max_m {
            continue;
        }
        let same = !want.is_empty() && (fold(&p.name) == want || fold(&p.name_en) == want);
        let score = if same { d } else if d <= max_m / 2.0 { d + max_m } else { continue };
        if best.map_or(true, |(s, _)| score < s) {
            best = Some((score, i));
        }
    }
    best.map(|(_, i)| hit(places, i, haversine(at.0, at.1, to_deg(places.items[i].lat), to_deg(places.items[i].lon))))
}

/// How much a kind of place should float up, 0..=2.
fn importance(kind: &str) -> f64 {
    let k = kind.split_once('=').map_or(kind, |(k, _)| k);
    match kind {
        "place=city" | "place=town" | "place=suburb" | "place=square" | "place=neighbourhood" | "place=quarter" => 2.0,
        "amenity=marketplace" | "tourism=attraction" | "aeroway=aerodrome" | "railway=station" | "amenity=hospital"
        | "amenity=university" | "shop=mall" | "tourism=museum" => 1.5,
        "highway=motorway" | "highway=trunk" | "highway=primary" => 1.2,
        "highway=secondary" | "highway=tertiary" => 0.6,
        _ if k == "place" || k == "tourism" || k == "historic" => 1.0,
        _ => 0.0,
    }
}

/// Search `places` for `query`, biased toward `near` (lat, lon) when given.
pub fn search(places: &Places, query: &str, near: Option<(f64, f64)>, limit: usize) -> Vec<Hit> {
    let q = fold(query);
    if q.is_empty() {
        return Vec::new();
    }
    let words: Vec<&str> = q.split(' ').collect();
    let padded_q = format!(" {q} ");
    let mut scored: Vec<(f64, usize, f64)> = Vec::new();
    for (i, key) in places.keys.iter().enumerate() {
        if !words.iter().all(|w| key.contains(w)) {
            continue;
        }
        let p = &places.items[i];
        // Exact against either name alone: the key joins both, so `key == q` misses
        // every place that also has an English name.
        let rank = if key == &q || fold(&p.name) == q || fold(&p.name_en) == q {
            0.0
        } else if format!(" {key} ").contains(&padded_q) {
            1.0 // the query appears as whole words
        } else if key.starts_with(&q) {
            2.0
        } else if key.split(' ').any(|k| k.starts_with(words[0])) {
            3.0
        } else {
            4.0
        };
        let d = near.map_or(0.0, |(la, lo)| haversine(la, lo, to_deg(p.lat), to_deg(p.lon)));
        let imp = importance(&places.kinds[p.kind as usize]);
        // A rank step is worth ~13 km of distance and importance up to ~1.2 steps,
        // so "Tajrish" finds Tajrish before a nearby taxi stop named after it,
        // while a category search ("hospital") still sorts by distance.
        let score = rank * 4000.0 + d.min(40_000.0) * 0.3 - imp * 2500.0;
        scored.push((score, i, d));
    }
    scored.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let mut out: Vec<Hit> = Vec::with_capacity(limit);
    let mut taken: Vec<(usize, f64, f64)> = Vec::new();
    for (_, i, d) in scored {
        let p = &places.items[i];
        let (la, lo) = (to_deg(p.lat), to_deg(p.lon));
        // Same name within 300 m is the same place mapped twice (node + area, two street pieces).
        if taken.iter().any(|&(j, tl, to)| places.keys[j] == places.keys[i] && haversine(tl, to, la, lo) < 300.0) {
            continue;
        }
        taken.push((i, la, lo));
        out.push(hit(places, i, d));
        if out.len() == limit {
            break;
        }
    }
    out
}
