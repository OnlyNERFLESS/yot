//! A* routing over a `Graph` for car, motorcycle and walking.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

use crate::format::{access, Graph, Seg, Snap, CLASSES, NO_NAME};
use crate::geo::{bearing, haversine, to_deg};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Car,
    Motorcycle,
    Walk,
}

impl Mode {
    fn bits(self) -> (u8, u8) {
        match self {
            Mode::Car => (access::CAR_FWD, access::CAR_BWD),
            Mode::Motorcycle => (access::MOTO_FWD, access::MOTO_BWD),
            Mode::Walk => (access::FOOT_FWD, access::FOOT_BWD),
        }
    }

    /// Fastest speed this mode can ever be assigned, m/s, for an admissible heuristic.
    fn vmax(self) -> f64 {
        match self {
            Mode::Car | Mode::Motorcycle => 100.0 / 3.6,
            Mode::Walk => 5.0 / 3.6,
        }
    }

    /// Fixed cost per junction passed, seconds. Stops the car route zig-zagging
    /// through side streets to save a few metres.
    fn junction_s(self) -> f64 {
        match self {
            Mode::Walk => 0.0,
            _ => 4.0,
        }
    }

    pub fn can(self, s: &Seg, reverse: bool) -> bool {
        let (f, b) = self.bits();
        s.access & if reverse { b } else { f } != 0
    }

    pub fn can_any(self, s: &Seg) -> bool {
        let (f, b) = self.bits();
        s.access & (f | b) != 0
    }

    /// Free-flow travel speed in m/s. Urban Tehran figures, deliberately below
    /// the legal limit: these are what traffic-free driving actually averages.
    pub fn speed(self, s: &Seg) -> f64 {
        let class = CLASSES.get(s.class as usize).copied().unwrap_or("road");
        let kmh = match self {
            Mode::Walk => if class == "steps" { 2.0 } else { 4.8 },
            Mode::Car | Mode::Motorcycle => {
                let table = match class {
                    "motorway" => 75.0,
                    "trunk" => 65.0,
                    "motorway_link" => 45.0,
                    "trunk_link" => 40.0,
                    "primary" => 40.0,
                    "secondary" => 35.0,
                    "tertiary" => 30.0,
                    "primary_link" | "secondary_link" => 30.0,
                    "tertiary_link" | "unclassified" | "road" => 25.0,
                    "residential" => 20.0,
                    "service" => 12.0,
                    "living_street" => 8.0,
                    _ => 15.0,
                };
                let kmh = if s.maxspeed > 0 { (s.maxspeed as f64 * 0.75).min(table * 1.25) } else { table };
                if self == Mode::Motorcycle { kmh * 1.05 } else { kmh }
            }
        };
        kmh / 3.6
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    /// depart | turn | continue | arrive
    pub kind: &'static str,
    /// straight | slight_left | left | sharp_left | slight_right | right | sharp_right | uturn
    pub modifier: &'static str,
    pub name: String,
    pub name_en: String,
    pub distance_m: f64,
    pub duration_s: f64,
    /// Where the manoeuvre happens, [lon, lat].
    pub at: [f64; 2],
}

#[derive(Clone, Debug, Serialize)]
pub struct Route {
    pub mode: Mode,
    pub distance_m: f64,
    pub duration_s: f64,
    /// [lon, lat] pairs, GeoJSON order.
    pub coords: Vec<[f64; 2]>,
    pub steps: Vec<Step>,
}

#[derive(Copy, Clone)]
struct Item {
    f: f64,
    node: u32,
}
impl PartialEq for Item {
    fn eq(&self, o: &Self) -> bool { self.f == o.f }
}
impl Eq for Item {}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) }
}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering { o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal) }
}

/// One stretch of a route: segment `seg` walked from fraction t0 to t1.
#[derive(Clone, Copy, Debug)]
struct Part {
    seg: u32,
    t0: f64,
    t1: f64,
}

const SNAP_M: f64 = 400.0;
const NONE: u32 = u32::MAX;
const FROM_START: u32 = u32::MAX - 1;

pub fn route(g: &Graph, mode: Mode, from: (f64, f64), to: (f64, f64)) -> Result<Route, String> {
    let ok = |s: &Seg| mode.can_any(s);
    let a = g.snap(from.0, from.1, SNAP_M, ok).ok_or("start is not near a usable road")?;
    let b = g.snap(to.0, to.1, SNAP_M, ok).ok_or("destination is not near a usable road")?;
    let parts = search(g, mode, &a, &b).ok_or("no route found between these points")?;
    Ok(build(g, mode, &a, &b, &parts))
}

fn seg_time(g: &Graph, mode: Mode, si: u32, frac: f64) -> f64 {
    let s = &g.segs[si as usize];
    s.len_m as f64 * frac / mode.speed(s)
}

fn search(g: &Graph, mode: Mode, a: &Snap, b: &Snap) -> Option<Vec<Part>> {
    let n = g.lat.len();
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![NONE; n];
    let mut heap = BinaryHeap::new();
    let (tlat, tlon) = (b.lat, b.lon);
    let h = |v: u32| haversine(to_deg(g.lat[v as usize]), to_deg(g.lon[v as usize]), tlat, tlon) / mode.vmax();

    let sa = &g.segs[a.seg as usize];
    let sb = &g.segs[b.seg as usize];

    // Best complete answer so far: (cost, parts-in-reverse-order-builder).
    let mut best = f64::INFINITY;
    let mut best_end: Option<(u32, Part)> = None; // (node reached, final partial part)
    let mut direct: Option<Part> = None;

    if a.seg == b.seg {
        let rev = b.t < a.t;
        if mode.can(sa, rev) {
            best = seg_time(g, mode, a.seg, (b.t - a.t).abs());
            direct = Some(Part { seg: a.seg, t0: a.t, t1: b.t });
        }
    }

    // Seeds: leave the start point toward either end of its segment.
    if mode.can(sa, false) {
        let c = seg_time(g, mode, a.seg, 1.0 - a.t);
        if c < dist[sa.b as usize] {
            dist[sa.b as usize] = c;
            prev[sa.b as usize] = FROM_START;
            heap.push(Item { f: c + h(sa.b), node: sa.b });
        }
    }
    if mode.can(sa, true) {
        let c = seg_time(g, mode, a.seg, a.t);
        if c < dist[sa.a as usize] {
            dist[sa.a as usize] = c;
            prev[sa.a as usize] = FROM_START | 0; // marker; direction resolved on rebuild
            heap.push(Item { f: c + h(sa.a), node: sa.a });
        }
    }

    while let Some(Item { f, node }) = heap.pop() {
        if f >= best {
            break;
        }
        let d = dist[node as usize];
        if f - h(node) > d + 1e-9 {
            continue;
        }
        // Can we finish from here into the target segment?
        if node == sb.a && mode.can(sb, false) {
            let c = d + seg_time(g, mode, b.seg, b.t);
            if c < best {
                best = c;
                best_end = Some((node, Part { seg: b.seg, t0: 0.0, t1: b.t }));
                direct = None;
            }
        }
        if node == sb.b && mode.can(sb, true) {
            let c = d + seg_time(g, mode, b.seg, 1.0 - b.t);
            if c < best {
                best = c;
                best_end = Some((node, Part { seg: b.seg, t0: 1.0, t1: b.t }));
                direct = None;
            }
        }
        let j = mode.junction_s();
        for &e in &g.adj[g.first[node as usize] as usize..g.first[node as usize + 1] as usize] {
            let si = e & !(1 << 31);
            let rev = e >> 31 == 1;
            let s = &g.segs[si as usize];
            if !mode.can(s, rev) {
                continue;
            }
            let to = if rev { s.a } else { s.b };
            let c = d + s.len_m as f64 / mode.speed(s) + j;
            if c < dist[to as usize] {
                dist[to as usize] = c;
                prev[to as usize] = e;
                heap.push(Item { f: c + h(to), node: to });
            }
        }
    }

    if let Some(p) = direct {
        return Some(vec![p]);
    }
    let (end_node, last) = best_end?;
    let mut parts = vec![last];
    let mut v = end_node;
    loop {
        let e = prev[v as usize];
        if e == FROM_START {
            // First partial: from the start point to node v along the start segment.
            let t1 = if v == sa.b { 1.0 } else { 0.0 };
            parts.push(Part { seg: a.seg, t0: a.t, t1 });
            break;
        }
        let si = e & !(1 << 31);
        let rev = e >> 31 == 1;
        parts.push(if rev { Part { seg: si, t0: 1.0, t1: 0.0 } } else { Part { seg: si, t0: 0.0, t1: 1.0 } });
        let s = &g.segs[si as usize];
        v = if rev { s.b } else { s.a };
    }
    parts.reverse();
    parts.retain(|p| (p.t1 - p.t0).abs() > 1e-9);
    if parts.is_empty() {
        parts.push(Part { seg: a.seg, t0: a.t, t1: a.t });
    }
    Some(parts)
}

/// Shape points of `seg` between fractions t0 and t1 (reversed if t1 < t0), [lon, lat].
fn slice(g: &Graph, seg: u32, t0: f64, t1: f64) -> Vec<[f64; 2]> {
    let s = &g.segs[seg as usize];
    let pts: Vec<(f64, f64)> = g.shape_points(s).collect();
    let total = s.len_m as f64;
    let (lo, hi) = if t0 <= t1 { (t0, t1) } else { (t1, t0) };
    let (lo_m, hi_m) = (lo * total, hi * total);
    let mut out = Vec::new();
    let mut walked = 0.0;
    let lerp = |p: (f64, f64), q: (f64, f64), k: f64| [p.1 + (q.1 - p.1) * k, p.0 + (q.0 - p.0) * k];
    for w in pts.windows(2) {
        let piece = haversine(w[0].0, w[0].1, w[1].0, w[1].1);
        let (s0, s1) = (walked, walked + piece);
        if s1 >= lo_m && s0 <= hi_m && piece > 0.0 {
            let k0 = ((lo_m - s0) / piece).clamp(0.0, 1.0);
            let k1 = ((hi_m - s0) / piece).clamp(0.0, 1.0);
            if out.is_empty() {
                out.push(lerp(w[0], w[1], k0));
            }
            out.push(lerp(w[0], w[1], k1));
        }
        walked = s1;
    }
    if out.is_empty() {
        out.push([pts[0].1, pts[0].0]);
    }
    if t1 < t0 {
        out.reverse();
    }
    out
}

fn turn(delta: f64) -> &'static str {
    let d = ((delta + 540.0) % 360.0) - 180.0; // -180..180, positive = right
    let a = d.abs();
    match (a, d > 0.0) {
        (a, _) if a < 20.0 => "straight",
        (a, true) if a < 45.0 => "slight_right",
        (a, false) if a < 45.0 => "slight_left",
        (a, true) if a < 135.0 => "right",
        (a, false) if a < 135.0 => "left",
        (a, true) if a < 170.0 => "sharp_right",
        (a, false) if a < 170.0 => "sharp_left",
        _ => "uturn",
    }
}

/// Bearing of the route around coords[idx]: forward = leaving idx, else arriving at idx.
fn bearing_at(coords: &[[f64; 2]], idx: usize, forward: bool, m: f64) -> f64 {
    let p = coords[idx];
    let mut q = p;
    let mut walked = 0.0;
    let mut i = idx;
    loop {
        let next = if forward { i + 1 } else { i.wrapping_sub(1) };
        if next >= coords.len() {
            break;
        }
        walked += haversine(coords[i][1], coords[i][0], coords[next][1], coords[next][0]);
        q = coords[next];
        i = next;
        if walked >= m {
            break;
        }
    }
    if forward { bearing(p[1], p[0], q[1], q[0]) } else { bearing(q[1], q[0], p[1], p[0]) }
}

struct Group {
    name: u32,
    /// coords index where this group (including any folded connector) starts.
    start: usize,
    /// coords index where the named road itself starts (after a folded connector).
    road_start: usize,
    m: f64,
    s: f64,
}

fn build(g: &Graph, mode: Mode, a: &Snap, b: &Snap, parts: &[Part]) -> Route {
    let mut coords: Vec<[f64; 2]> = vec![[a.lon, a.lat]];
    let mut groups: Vec<Group> = Vec::new();
    let mut total_m = 0.0;
    let mut total_s = 0.0;

    for p in parts {
        let s = &g.segs[p.seg as usize];
        let pts = slice(g, p.seg, p.t0, p.t1);
        let m = s.len_m as f64 * (p.t1 - p.t0).abs();
        let sec = m / mode.speed(s);
        let start = coords.len() - 1;
        for q in pts.iter().skip(1) {
            if coords.last() != Some(q) {
                coords.push(*q);
            }
        }
        match groups.last_mut() {
            Some(gr) if gr.name == s.name => { gr.m += m; gr.s += sec; }
            _ => groups.push(Group { name: s.name, start, road_start: start, m, s: sec }),
        }
        total_m += m;
        total_s += sec;
    }
    total_s += mode.junction_s() * parts.len().saturating_sub(1) as f64;
    if coords.last() != Some(&[b.lon, b.lat]) {
        coords.push([b.lon, b.lat]);
    }

    // Fold unnamed stretches (ramps, slip roads, service links) into the named
    // road they lead to, so "take the ramp onto X" is one instruction.
    let mut folded: Vec<Group> = Vec::with_capacity(groups.len());
    let mut carry: Option<Group> = None;
    for gr in groups {
        if gr.name == NO_NAME {
            carry = Some(match carry {
                Some(c) => Group { m: c.m + gr.m, s: c.s + gr.s, ..c },
                None => gr,
            });
            continue;
        }
        match carry.take() {
            Some(c) => folded.push(Group { name: gr.name, start: c.start, road_start: gr.start, m: c.m + gr.m, s: c.s + gr.s }),
            None => folded.push(gr),
        }
    }
    if let Some(c) = carry {
        match folded.last_mut() {
            Some(last) => { last.m += c.m; last.s += c.s; }
            None => folded.push(c),
        }
    }

    let mut steps = Vec::with_capacity(folded.len() + 1);
    for (i, gr) in folded.iter().enumerate() {
        let (kind, modifier) = if i == 0 {
            ("depart", "straight")
        } else {
            let in_b = bearing_at(&coords, gr.start, false, 30.0);
            let out_b = bearing_at(&coords, gr.road_start, true, 30.0);
            let md = turn(out_b - in_b);
            (if md == "straight" { "continue" } else { "turn" }, md)
        };
        let (name, name_en) = if gr.name == NO_NAME {
            (String::new(), String::new())
        } else {
            (g.names[gr.name as usize].clone(), g.names_en[gr.name as usize].clone())
        };
        steps.push(Step { kind, modifier, name, name_en, distance_m: gr.m, duration_s: gr.s, at: coords[gr.start] });
    }
    steps.push(Step {
        kind: "arrive", modifier: "straight", name: String::new(), name_en: String::new(),
        distance_m: 0.0, duration_s: 0.0, at: [b.lon, b.lat],
    });

    Route { mode, distance_m: total_m, duration_s: total_s, coords, steps }
}

/// The search itself, for the "finding your route" animation: the road
/// segments a weighted A* settles, in the order it reaches them, each as a
/// polyline oriented from where the search came from. A heuristic weight
/// under 1 makes the search spread wider than plain A*, so the playback
/// branches through the streets like growth before it touches the target.
/// Stops when the target segment is reached or after `max_edges`.
pub fn explore(g: &Graph, mode: Mode, from: (f64, f64), to: (f64, f64), greed: f64, max_edges: usize) -> Result<(Vec<Vec<[f32; 2]>>, bool), String> {
    let ok = |s: &Seg| mode.can_any(s);
    let a = g.snap(from.0, from.1, SNAP_M, ok).ok_or("start is not near a usable road")?;
    let b = g.snap(to.0, to.1, SNAP_M, ok).ok_or("destination is not near a usable road")?;
    let n = g.lat.len();
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![NONE; n];
    let mut done = vec![false; n];
    let mut heap = BinaryHeap::new();
    let h = |v: u32| greed * haversine(to_deg(g.lat[v as usize]), to_deg(g.lon[v as usize]), b.lat, b.lon) / mode.vmax();
    let sa = &g.segs[a.seg as usize];
    let sb = &g.segs[b.seg as usize];
    for (node, c) in [(sa.b, seg_time(g, mode, a.seg, 1.0 - a.t)), (sa.a, seg_time(g, mode, a.seg, a.t))] {
        if c < dist[node as usize] {
            dist[node as usize] = c;
            prev[node as usize] = FROM_START;
            heap.push(Item { f: c + h(node), node });
        }
    }
    let shape = |si: u32, rev: bool| -> Vec<[f32; 2]> {
        let s = &g.segs[si as usize];
        let mut pts: Vec<[f32; 2]> = g.shape_points(s).map(|(lat, lon)| [lon as f32, lat as f32]).collect();
        if rev {
            pts.reverse();
        }
        pts
    };
    let mut out: Vec<Vec<[f32; 2]>> = vec![shape(a.seg, false)];
    let mut reached = a.seg == b.seg;
    let j = mode.junction_s();
    while let Some(Item { node, .. }) = heap.pop() {
        if reached || out.len() >= max_edges {
            break;
        }
        if done[node as usize] {
            continue;
        }
        done[node as usize] = true;
        let e = prev[node as usize];
        if e != FROM_START && e != NONE {
            out.push(shape(e & !(1 << 31), e >> 31 == 1));
        }
        if node == sb.a || node == sb.b {
            out.push(shape(b.seg, node == sb.b));
            reached = true;
            break;
        }
        let d = dist[node as usize];
        for &e in &g.adj[g.first[node as usize] as usize..g.first[node as usize + 1] as usize] {
            let si = e & !(1 << 31);
            let rev = e >> 31 == 1;
            let s = &g.segs[si as usize];
            if !mode.can(s, rev) {
                continue;
            }
            let to = if rev { s.a } else { s.b };
            let c = d + s.len_m as f64 / mode.speed(s) + j;
            if c < dist[to as usize] {
                dist[to as usize] = c;
                prev[to as usize] = e;
                heap.push(Item { f: c + h(to), node: to });
            }
        }
    }
    Ok((out, reached))
}
