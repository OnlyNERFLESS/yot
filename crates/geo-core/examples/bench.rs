//! cargo run --release -p geo-core --example bench -- <packs-prefix>
use std::time::Instant;

use geo_core::{route, search, Graph, Mode, Places};

fn main() {
    let prefix = std::env::args().nth(1).expect("packs prefix");
    let t = Instant::now();
    let gb = std::fs::read(format!("{prefix}.graph")).unwrap();
    let g = Graph::from_bytes(&gb).unwrap();
    println!("graph load: {:.0} ms", t.elapsed().as_secs_f64() * 1e3);
    let t = Instant::now();
    let pb = std::fs::read(format!("{prefix}.places")).unwrap();
    let p = Places::from_bytes(&pb).unwrap();
    println!("places load: {:.0} ms ({} entries)", t.elapsed().as_secs_f64() * 1e3, p.items.len());

    let azadi = (35.6997, 51.3380);
    let tajrish = (35.8045, 51.4337);
    for mode in [Mode::Car, Mode::Motorcycle, Mode::Walk] {
        let mut times = vec![];
        let mut last = None;
        for _ in 0..5 {
            let t = Instant::now();
            let r = route::route(&g, mode, azadi, tajrish);
            times.push(t.elapsed().as_secs_f64() * 1e3);
            last = Some(r);
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        match last.unwrap() {
            Ok(r) => {
                println!(
                    "{mode:?}: {:.1} km, {:.0} min, {} points, {} steps | route time median {:.0} ms (min {:.0}, max {:.0})",
                    r.distance_m / 1e3, r.duration_s / 60.0, r.coords.len(), r.steps.len(), times[2], times[0], times[4]
                );
                if mode == Mode::Car {
                    for s in r.steps.iter().take(8) {
                        println!("   {} {} {} | {:.0} m", s.kind, s.modifier, s.name, s.distance_m);
                    }
                }
            }
            Err(e) => println!("{mode:?}: ERROR {e}"),
        }
    }
    for q in ["تجریش", "بازار تجریش", "میدان آزادی", "Milad Tower", "بيمارستان", "ولیعصر"] {
        let t = Instant::now();
        let hits = search::search(&p, q, Some(azadi), 5);
        let ms = t.elapsed().as_secs_f64() * 1e3;
        let first: Vec<String> = hits.iter().take(3).map(|h| format!("{} [{}] {:.1}km", h.name, h.kind, h.distance_m / 1e3)).collect();
        println!("search {q:?}: {} hits in {ms:.0} ms -> {}", hits.len(), first.join(" | "));
    }
}
