//! packer <in.osm.pbf> <out-prefix> <min_lon> <min_lat> <max_lon> <max_lat>
//!
//! Writes <out-prefix>.graph (routing) and <out-prefix>.places (search).
//! One pass: PBF files list nodes before ways, so coordinates are known by the
//! time the ways that use them arrive.

use std::collections::HashMap;
use std::time::Instant;

use geo_core::format::{access, class_id, Graph, Place, Places, Seg, NO_NAME};
use geo_core::geo::{haversine, to_deg};
use osmpbf::{Element, ElementReader};

struct WayRec {
    refs: Vec<i64>,
    class: u8,
    maxspeed: u8,
    access: u8,
    name: u32,
}

#[derive(Default)]
struct Interner {
    map: HashMap<String, u32>,
    list: Vec<String>,
}
impl Interner {
    fn id(&mut self, s: &str) -> u32 {
        if let Some(&i) = self.map.get(s) {
            return i;
        }
        let i = self.list.len() as u32;
        self.map.insert(s.to_string(), i);
        self.list.push(s.to_string());
        i
    }
}

const CAR_CLASSES: &[&str] = &[
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
    "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
    "service", "road",
];
const NO_FOOT: &[&str] = &["motorway", "motorway_link", "trunk", "trunk_link"];
const POI_KEYS: &[&str] = &[
    "amenity", "shop", "tourism", "leisure", "healthcare", "office", "craft", "historic", "place",
    "public_transport", "railway", "aeroway", "man_made", "natural", "building",
];

fn yes(v: Option<&str>) -> Option<bool> {
    match v? {
        "yes" | "designated" | "permissive" | "destination" | "1" | "true" => Some(true),
        "no" | "private" | "0" | "false" | "use_sidepath" => Some(false),
        _ => None,
    }
}

fn parse_speed(v: Option<&str>) -> u8 {
    let Some(v) = v else { return 0 };
    let n: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
    let mut k: f64 = n.parse().unwrap_or(0.0);
    if v.contains("mph") {
        k *= 1.609;
    }
    k.min(250.0) as u8
}

fn way_access(t: &HashMap<&str, &str>, class: &str) -> u8 {
    let g = |k: &str| t.get(k).copied();
    let base_car = CAR_CLASSES.contains(&class);
    let mut car = base_car;
    let mut foot = !NO_FOOT.contains(&class);
    if let Some(a) = yes(g("access")) {
        car = car && a;
        foot = foot && a;
    }
    if let Some(v) = yes(g("vehicle")) { car = base_car && v; }
    if let Some(v) = yes(g("motor_vehicle")) { car = base_car && v; }
    let mut moto = car;
    if let Some(v) = yes(g("motorcar")) { car = base_car && v; }
    if let Some(v) = yes(g("motorcycle")) { moto = base_car && v; }
    if let Some(v) = yes(g("foot")) { foot = v; }
    if g("area") == Some("yes") && class != "pedestrian" {
        car = false;
        moto = false;
    }

    let oneway = match g("oneway") {
        Some("yes" | "1" | "true") => 1,
        Some("-1" | "reverse") => -1,
        Some("no") => 0,
        _ => {
            let roundabout = matches!(g("junction"), Some("roundabout" | "circular"));
            if roundabout || class == "motorway" || class == "motorway_link" { 1 } else { 0 }
        }
    };
    let (fwd, bwd) = (oneway >= 0, oneway <= 0);
    let mut bits = 0u8;
    if car { if fwd { bits |= access::CAR_FWD } if bwd { bits |= access::CAR_BWD } }
    if moto { if fwd { bits |= access::MOTO_FWD } if bwd { bits |= access::MOTO_BWD } }
    if foot { bits |= access::FOOT_FWD | access::FOOT_BWD }
    bits
}

fn poi_kind(t: &HashMap<&str, &str>) -> Option<String> {
    for k in POI_KEYS {
        if let Some(v) = t.get(k) {
            if *k == "building" && t.len() > 3 {
                continue; // a named building with other tags is described by those
            }
            if *k == "railway" && *v != "station" && *v != "subway_entrance" {
                continue;
            }
            return Some(format!("{k}={v}"));
        }
    }
    None
}

/// Phone, opening hours, website and street address, each empty when unknown.
fn details(t: &HashMap<&str, &str>) -> [String; 4] {
    let g = |ks: &[&str]| ks.iter().find_map(|k| t.get(k)).map(|v| v.to_string()).unwrap_or_default();
    let street = g(&["addr:street"]);
    let number = g(&["addr:housenumber"]);
    let address = match (street.is_empty(), number.is_empty()) {
        (false, false) => format!("{street} {number}"),
        (false, true) => street,
        _ => String::new(),
    };
    [
        g(&["phone", "contact:phone", "contact:mobile"]),
        g(&["opening_hours"]),
        g(&["website", "contact:website"]),
        address,
    ]
}

#[derive(serde::Serialize)]
struct TransitStop {
    name: String,
    name_en: String,
    lng: f64,
    lat: f64,
}

#[derive(serde::Serialize)]
struct TransitLine {
    kind: &'static str,
    r#ref: String,
    name: String,
    name_en: String,
    colour: String,
    /// Polylines of [lng, lat], one per member way.
    geom: Vec<Vec<[f64; 2]>>,
    /// Stations in travel order.
    stops: Vec<TransitStop>,
}

/// A Tehran metro or BRT route relation, cut to the box; None for anything else.
fn transit_line(
    t: &HashMap<&str, &str>, r: &osmpbf::Relation, coord: &HashMap<i64, (i32, i32)>,
    stop_names: &HashMap<i64, (String, String)>, way_refs: &HashMap<i64, Vec<i64>>,
) -> Option<TransitLine> {
    if t.get("type") != Some(&"route") {
        return None;
    }
    let name = t.get("name").copied().unwrap_or("");
    let name_en = t.get("name:en").copied().unwrap_or("");
    let kind = match t.get("route").copied() {
        Some("subway") | Some("light_rail") | Some("monorail") => "metro",
        Some("bus") if name.contains("تندرو") || name.to_uppercase().contains("BRT") || name_en.to_uppercase().contains("BRT")
            || t.get("bus") == Some(&"brt") => "brt",
        _ => {
            if std::env::var("PACKER_DEBUG").is_ok() && t.get("route") == Some(&"bus") {
                let in_box = r.members().filter(|m| m.member_type == osmpbf::RelMemberType::Node && coord.contains_key(&m.member_id)).count();
                if in_box > 3 {
                    eprintln!("BUS in-box {} | {} | {} | net={:?} op={:?} ref={:?}", in_box, name, name_en, t.get("network"), t.get("operator"), t.get("ref"));
                }
            }
            return None;
        }
    };
    // Karaj's metro sits inside the box but is a different network.
    if t.get("network").is_some_and(|n| n.contains("کرج") || n.contains("Karaj")) {
        return None;
    }
    let deg = |p: (i32, i32)| [p.1 as f64 / 1e7, p.0 as f64 / 1e7];
    let mut geom = Vec::new();
    let mut stops: Vec<TransitStop> = Vec::new();
    // BRT relations often leave stop positions unnamed and name the platforms instead.
    let mut platforms: Vec<TransitStop> = Vec::new();
    for m in r.members() {
        let role = m.role().unwrap_or("");
        match m.member_type {
            osmpbf::RelMemberType::Way if !role.starts_with("platform") => {
                if let Some(refs) = way_refs.get(&m.member_id) {
                    let pts: Vec<[f64; 2]> = refs.iter().filter_map(|n| coord.get(n).copied()).map(deg).collect();
                    if pts.len() >= 2 {
                        geom.push(pts);
                    }
                }
            }
            osmpbf::RelMemberType::Node if role.starts_with("stop") || role.starts_with("platform") => {
                let list = if role.starts_with("stop") { &mut stops } else { &mut platforms };
                if let (Some(c), Some((n, en))) = (coord.get(&m.member_id), stop_names.get(&m.member_id)) {
                    if list.last().map_or(true, |s| &s.name != n) {
                        let [lng, lat] = deg(*c);
                        list.push(TransitStop { name: n.clone(), name_en: en.clone(), lng, lat });
                    }
                }
            }
            _ => {}
        }
    }
    if std::env::var("PACKER_DEBUG").is_ok() && kind == "brt" {
        let total_nodes = r.members().filter(|m| m.member_type == osmpbf::RelMemberType::Node).count();
        let in_box = r.members().filter(|m| m.member_type == osmpbf::RelMemberType::Node && coord.contains_key(&m.member_id)).count();
        eprintln!("BRT {:?} route={:?}: nodes {} in-box {} named-stops {} named-platforms {}", name_en, t.get("route"), total_nodes, in_box, stops.len(), platforms.len());
    }
    if stops.len() < platforms.len() {
        stops = platforms;
    }
    if stops.len() < 2 {
        return None;
    }
    let colour = match t.get("colour").copied().unwrap_or("") {
        "yellow" => "#F5C518".to_string(),
        "" => if kind == "brt" { "#E53935".to_string() } else { "#9AA3A0".to_string() },
        c => c.to_string(),
    };
    Some(TransitLine {
        kind,
        r#ref: t.get("ref").copied().unwrap_or("").to_string(),
        name: name.to_string(),
        name_en: name_en.to_string(),
        colour,
        geom,
        stops,
    })
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 7 {
        eprintln!("usage: packer <in.osm.pbf> <out-prefix> <min_lon> <min_lat> <max_lon> <max_lat>");
        std::process::exit(2);
    }
    let (min_lon, min_lat, max_lon, max_lat): (f64, f64, f64, f64) =
        (a[3].parse().unwrap(), a[4].parse().unwrap(), a[5].parse().unwrap(), a[6].parse().unwrap());
    let t0 = Instant::now();

    let mut coord: HashMap<i64, (i32, i32)> = HashMap::new();
    let mut ways: Vec<WayRec> = Vec::new();
    let mut names = Interner::default();
    let mut names_en: Vec<String> = Vec::new();
    let mut kinds = Interner::default();
    let mut places: Vec<Place> = Vec::new();
    // Streets for search: one entry per (name, ~1 km cell).
    let mut streets: HashMap<(u32, i32, i32), (i32, i32, u8)> = HashMap::new();
    let mut street_en: HashMap<u32, String> = HashMap::new();

    let inside = |lat: f64, lon: f64| lat >= min_lat && lat <= max_lat && lon >= min_lon && lon <= max_lon;

    let reader = ElementReader::from_path(&a[1]).expect("open pbf");
    /// (coords, name, name_en, kind, phone, hours, website, address)
    type Pending = ((i32, i32), String, String, String, [String; 4]);
    fn add_node(
        coord: &mut HashMap<i64, (i32, i32)>, stop_names: &mut HashMap<i64, (String, String)>,
        inside: &dyn Fn(f64, f64) -> bool,
        id: i64, lat: f64, lon: f64, tags: &mut dyn Iterator<Item = (&str, &str)>,
    ) -> Option<Pending> {
        if !inside(lat, lon) {
            return None;
        }
        let e7 = ((lat * 1e7).round() as i32, (lon * 1e7).round() as i32);
        coord.insert(id, e7);
        let t: HashMap<&str, &str> = tags.collect();
        // Remember the names of transit stops so route relations can label their stations.
        if t.contains_key("public_transport") || t.contains_key("railway") || t.get("highway") == Some(&"bus_stop") {
            if let Some(n) = t.get("name") {
                stop_names.insert(id, (n.to_string(), t.get("name:en").unwrap_or(&"").to_string()));
            }
        }
        if let (Some(name), Some(kind)) = (t.get("name"), poi_kind(&t)) {
            return Some((e7, name.to_string(), t.get("name:en").unwrap_or(&"").to_string(), kind, details(&t)));
        }
        None
    }

    let mut pending_places: Vec<Pending> = Vec::new();
    let mut pending_way_places: Vec<(Vec<i64>, String, String, String, [String; 4])> = Vec::new();
    // Centroid of every in-box way, so relations (multi-part areas such as big
    // landmarks, parks and campuses) can be placed from their member ways.
    let mut way_centre: HashMap<i64, (i32, i32)> = HashMap::new();
    // Transit: stop names, way geometry for route members, and the lines found.
    let mut stop_names: HashMap<i64, (String, String)> = HashMap::new();
    let mut way_refs: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut lines: Vec<TransitLine> = Vec::new();

    reader
        .for_each(|el| match el {
            Element::DenseNode(n) => {
                if let Some(p) = add_node(&mut coord, &mut stop_names, &inside, n.id(), n.lat(), n.lon(), &mut n.tags()) {
                    pending_places.push(p);
                }
            }
            Element::Node(n) => {
                if let Some(p) = add_node(&mut coord, &mut stop_names, &inside, n.id(), n.lat(), n.lon(), &mut n.tags()) {
                    pending_places.push(p);
                }
            }
            Element::Way(w) => {
                let t: HashMap<&str, &str> = w.tags().collect();
                let refs: Vec<i64> = w.refs().collect();
                if (t.contains_key("railway") || t.contains_key("highway")) && refs.iter().any(|r| coord.contains_key(r)) {
                    way_refs.insert(w.id(), refs.clone());
                }
                {
                    let pts: Vec<(i32, i32)> = refs.iter().filter_map(|r| coord.get(r).copied()).collect();
                    if !pts.is_empty() {
                        let n = pts.len() as i64;
                        way_centre.insert(w.id(), (
                            (pts.iter().map(|p| p.0 as i64).sum::<i64>() / n) as i32,
                            (pts.iter().map(|p| p.1 as i64).sum::<i64>() / n) as i32,
                        ));
                    }
                }
                if let Some(hw) = t.get("highway") {
                    if let Some(class) = class_id(hw) {
                        let acc = way_access(&t, hw);
                        let kept: Vec<i64> = refs.iter().copied().filter(|r| coord.contains_key(r)).collect();
                        if acc != 0 && kept.len() >= 2 {
                            let name = match t.get("name") {
                                Some(n) => {
                                    let id = names.id(n);
                                    if id as usize == names_en.len() {
                                        names_en.push(t.get("name:en").unwrap_or(&"").to_string());
                                    }
                                    id
                                }
                                None => NO_NAME,
                            };
                            if name != NO_NAME {
                                let mid = coord[&kept[kept.len() / 2]];
                                let key = (name, mid.0 / 100_000, mid.1 / 100_000);
                                streets.entry(key).or_insert((mid.0, mid.1, class));
                                if let Some(en) = t.get("name:en") {
                                    street_en.insert(name, en.to_string());
                                }
                            }
                            ways.push(WayRec { refs, class, maxspeed: parse_speed(t.get("maxspeed").copied()), access: acc, name });
                        }
                        return;
                    }
                }
                if let (Some(name), Some(kind)) = (t.get("name"), poi_kind(&t)) {
                    pending_way_places.push((refs, name.to_string(), t.get("name:en").unwrap_or(&"").to_string(), kind, details(&t)));
                }
            }
            Element::Relation(r) => {
                let t: HashMap<&str, &str> = r.tags().collect();
                if let Some(line) = transit_line(&t, &r, &coord, &stop_names, &way_refs) {
                    lines.push(line);
                }
                if let (Some(name), Some(kind)) = (t.get("name"), poi_kind(&t)) {
                    let pts: Vec<(i32, i32)> = r
                        .members()
                        .filter(|m| m.member_type == osmpbf::RelMemberType::Way)
                        .filter_map(|m| way_centre.get(&m.member_id).copied())
                        .collect();
                    if !pts.is_empty() {
                        let n = pts.len() as i64;
                        let c = (
                            (pts.iter().map(|p| p.0 as i64).sum::<i64>() / n) as i32,
                            (pts.iter().map(|p| p.1 as i64).sum::<i64>() / n) as i32,
                        );
                        pending_places.push((c, name.to_string(), t.get("name:en").unwrap_or(&"").to_string(), kind, details(&t)));
                    }
                }
            }
            _ => {}
        })
        .expect("read pbf");
    eprintln!("read: {} nodes in box, {} routable ways, {:.1}s", coord.len(), ways.len(), t0.elapsed().as_secs_f64());

    // ---- transit ----
    let tj = serde_json::to_string(&serde_json::json!({ "lines": lines })).expect("transit json");
    std::fs::write(format!("{}.transit", a[2]), &tj).expect("write transit");
    let stops: usize = lines.iter().map(|l| l.stops.len()).sum();
    eprintln!("transit: {} line directions, {} stops -> {:.0} KB", lines.len(), stops, tj.len() as f64 / 1e3);

    // ---- graph ----
    let mut uses: HashMap<i64, u16> = HashMap::new();
    for w in &ways {
        for r in &w.refs {
            if coord.contains_key(r) {
                *uses.entry(*r).or_default() += 1;
            }
        }
    }
    let mut node_ix: HashMap<i64, u32> = HashMap::new();
    let (mut lat, mut lon): (Vec<i32>, Vec<i32>) = (Vec::new(), Vec::new());
    let mut segs: Vec<Seg> = Vec::new();
    let mut shape: Vec<i32> = Vec::new();
    let mut ix = |id: i64, lat: &mut Vec<i32>, lon: &mut Vec<i32>| -> u32 {
        *node_ix.entry(id).or_insert_with(|| {
            let c = coord[&id];
            lat.push(c.0);
            lon.push(c.1);
            (lat.len() - 1) as u32
        })
    };
    for w in &ways {
        // Split into runs of consecutive in-box nodes.
        let mut runs: Vec<Vec<i64>> = vec![Vec::new()];
        for r in &w.refs {
            if coord.contains_key(r) {
                runs.last_mut().unwrap().push(*r);
            } else if !runs.last().unwrap().is_empty() {
                runs.push(Vec::new());
            }
        }
        for run in runs.into_iter().filter(|r| r.len() >= 2) {
            let mut start = 0;
            for i in 1..run.len() {
                let split = i == run.len() - 1 || uses.get(&run[i]).copied().unwrap_or(0) >= 2;
                if !split {
                    continue;
                }
                let piece = &run[start..=i];
                let off = (shape.len() / 2) as u32;
                let mut len = 0.0;
                for (k, id) in piece.iter().enumerate() {
                    let c = coord[id];
                    shape.push(c.0);
                    shape.push(c.1);
                    if k > 0 {
                        let p = coord[&piece[k - 1]];
                        len += haversine(to_deg(p.0), to_deg(p.1), to_deg(c.0), to_deg(c.1));
                    }
                }
                let a = ix(piece[0], &mut lat, &mut lon);
                let b = ix(piece[piece.len() - 1], &mut lat, &mut lon);
                segs.push(Seg {
                    a, b, len_m: len as f32, shape_off: off, shape_len: piece.len() as u32,
                    name: w.name, class: w.class, maxspeed: w.maxspeed, access: w.access,
                });
                start = i;
            }
        }
    }
    let g = Graph::new(lat, lon, segs, shape, names.list.clone(), names_en);
    let gb = g.to_bytes();
    std::fs::write(format!("{}.graph", a[2]), &gb).expect("write graph");
    eprintln!(
        "graph: {} junctions, {} segments, {} shape points, {} names -> {:.1} MB",
        g.lat.len(), g.segs.len(), g.shape.len() / 2, g.names.len(), gb.len() as f64 / 1e6
    );

    // ---- places ----
    let mk = |lat: i32, lon: i32, kind: u16, name: String, name_en: String, d: [String; 4]| {
        let [phone, hours, website, address] = d;
        Place { lat, lon, kind, name, name_en, phone, hours, website, address }
    };
    for (e7, name, en, kind, d) in pending_places {
        let k = kinds.id(&kind) as u16;
        places.push(mk(e7.0, e7.1, k, name, en, d));
    }
    for (refs, name, en, kind, d) in pending_way_places {
        let pts: Vec<(i32, i32)> = refs.iter().filter_map(|r| coord.get(r).copied()).collect();
        if pts.is_empty() {
            continue;
        }
        let n = pts.len() as i64;
        let la = (pts.iter().map(|p| p.0 as i64).sum::<i64>() / n) as i32;
        let lo = (pts.iter().map(|p| p.1 as i64).sum::<i64>() / n) as i32;
        let k = kinds.id(&kind) as u16;
        places.push(mk(la, lo, k, name, en, d));
    }
    let poi_count = places.len();
    for ((name, _, _), (la, lo, class)) in &streets {
        let kind = format!("highway={}", geo_core::format::CLASSES[*class as usize]);
        let k = kinds.id(&kind) as u16;
        places.push(mk(
            *la, *lo, k,
            names.list[*name as usize].clone(),
            street_en.get(name).cloned().unwrap_or_default(),
            Default::default(),
        ));
    }
    let p = Places::new(kinds.list, places);
    let pb = p.to_bytes();
    std::fs::write(format!("{}.places", a[2]), &pb).expect("write places");
    eprintln!(
        "places: {} points of interest + {} street entries -> {:.1} MB; total {:.1}s",
        poi_count, p.items.len() - poi_count, pb.len() as f64 / 1e6, t0.elapsed().as_secs_f64()
    );
}
