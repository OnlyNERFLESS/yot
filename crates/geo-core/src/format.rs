//! On-disk pack formats. Little-endian, versioned by a 4-byte magic.
//!
//! Graph (`*.graph`): intersections are nodes, each road stretch between two
//! intersections is one segment carrying its shape points, so a street with
//! fifty bends costs one edge in the search rather than fifty.

use crate::geo::{project, to_deg};
use crate::normalize::fold;

pub const GRAPH_MAGIC: &[u8; 4] = b"PTG2";
pub const PLACES_MAGIC: &[u8; 4] = b"PTP2";

/// Highway classes, indexed by `Seg::class`.
pub const CLASSES: &[&str] = &[
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "road", "pedestrian", "footway",
    "path", "steps", "cycleway", "track", "corridor",
];

pub fn class_id(name: &str) -> Option<u8> {
    CLASSES.iter().position(|c| *c == name).map(|i| i as u8)
}

pub mod access {
    pub const CAR_FWD: u8 = 1;
    pub const CAR_BWD: u8 = 2;
    pub const MOTO_FWD: u8 = 4;
    pub const MOTO_BWD: u8 = 8;
    pub const FOOT_FWD: u8 = 16;
    pub const FOOT_BWD: u8 = 32;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Seg {
    pub a: u32,
    pub b: u32,
    pub len_m: f32,
    pub shape_off: u32,
    pub shape_len: u32,
    pub name: u32,
    pub class: u8,
    pub maxspeed: u8,
    pub access: u8,
}

pub const NO_NAME: u32 = u32::MAX;
const CELL: f64 = 0.004; // ~400 m

pub struct Graph {
    pub lat: Vec<i32>,
    pub lon: Vec<i32>,
    /// CSR: edges of node n are adj[first[n]..first[n+1]]; bit 31 = segment walked b->a.
    pub first: Vec<u32>,
    pub adj: Vec<u32>,
    pub segs: Vec<Seg>,
    /// Interleaved lat,lon (e7) for every segment's shape, a..b inclusive.
    pub shape: Vec<i32>,
    pub names: Vec<String>,
    pub names_en: Vec<String>,
    grid: Grid,
}

struct Grid {
    min_lat: f64,
    min_lon: f64,
    cols: usize,
    rows: usize,
    start: Vec<u32>,
    items: Vec<u32>,
}

pub struct Snap {
    pub seg: u32,
    /// Fraction along the segment from a to b.
    pub t: f64,
    pub lat: f64,
    pub lon: f64,
    pub dist_m: f64,
}

// ---------- byte helpers ----------

pub struct Out(pub Vec<u8>);

impl Out {
    pub fn u8(&mut self, v: u8) { self.0.push(v) }
    pub fn u32(&mut self, v: u32) { self.0.extend_from_slice(&v.to_le_bytes()) }
    pub fn i32(&mut self, v: i32) { self.0.extend_from_slice(&v.to_le_bytes()) }
    pub fn str(&mut self, s: &str) {
        let b = s.as_bytes();
        let n = b.len().min(u16::MAX as usize);
        self.0.extend_from_slice(&(n as u16).to_le_bytes());
        self.0.extend_from_slice(&b[..n]);
    }
    pub fn var(&mut self, mut v: u64) {
        while v >= 0x80 { self.0.push((v as u8) | 0x80); v >>= 7; }
        self.0.push(v as u8);
    }
    /// Delta + zigzag varint: neighbouring coordinates differ by little, so most cost 1-3 bytes.
    pub fn deltas(&mut self, v: &[i32], stride: usize) {
        self.var(v.len() as u64);
        let mut last = vec![0i64; stride];
        for (i, x) in v.iter().enumerate() {
            let d = *x as i64 - last[i % stride];
            last[i % stride] = *x as i64;
            self.var(((d << 1) ^ (d >> 63)) as u64);
        }
    }
}

struct In<'a> { b: &'a [u8], i: usize }

impl<'a> In<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let s = self.b.get(self.i..self.i + n).ok_or("pack truncated")?;
        self.i += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> { Ok(self.take(1)?[0]) }
    fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn i32(&mut self) -> Result<i32, String> { Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn str(&mut self) -> Result<String, String> {
        let n = u16::from_le_bytes(self.take(2)?.try_into().unwrap()) as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn var(&mut self) -> Result<u64, String> {
        let (mut r, mut sh) = (0u64, 0);
        loop {
            let c = self.u8()?;
            r |= ((c & 0x7F) as u64) << sh;
            if c < 0x80 { return Ok(r); }
            sh += 7;
            if sh > 63 { return Err("bad varint".into()); }
        }
    }
    fn deltas(&mut self, stride: usize) -> Result<Vec<i32>, String> {
        let n = self.var()? as usize;
        let mut out = Vec::with_capacity(n);
        let mut last = vec![0i64; stride];
        for i in 0..n {
            let z = self.var()?;
            let d = (z >> 1) as i64 ^ -((z & 1) as i64);
            last[i % stride] += d;
            out.push(last[i % stride] as i32);
        }
        Ok(out)
    }
}

// ---------- graph ----------

impl Graph {
    pub fn new(lat: Vec<i32>, lon: Vec<i32>, segs: Vec<Seg>, shape: Vec<i32>, names: Vec<String>, names_en: Vec<String>) -> Self {
        let n = lat.len();
        let mut deg = vec![0u32; n + 1];
        for s in &segs {
            deg[s.a as usize] += 1;
            deg[s.b as usize] += 1;
        }
        let mut first = vec![0u32; n + 1];
        for i in 0..n {
            first[i + 1] = first[i] + deg[i];
        }
        let mut fill = first.clone();
        let mut adj = vec![0u32; first[n] as usize];
        for (i, s) in segs.iter().enumerate() {
            adj[fill[s.a as usize] as usize] = i as u32;
            fill[s.a as usize] += 1;
            adj[fill[s.b as usize] as usize] = i as u32 | 1 << 31;
            fill[s.b as usize] += 1;
        }
        let mut g = Graph { lat, lon, first, adj, segs, shape, names, names_en, grid: Grid::empty() };
        g.grid = Grid::build(&g);
        g
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut o = Out(Vec::new());
        o.0.extend_from_slice(GRAPH_MAGIC);
        o.deltas(&self.lat, 1);
        o.deltas(&self.lon, 1);
        o.var(self.segs.len() as u64);
        // Shapes are stored in segment order, so shape_off is implied and not written.
        for s in &self.segs {
            o.var(s.a as u64); o.var(s.b as u64);
            o.var((s.len_m * 10.0).round() as u64); // decimetres
            o.var(s.shape_len as u64);
            o.var(if s.name == NO_NAME { 0 } else { s.name as u64 + 1 });
            o.u8(s.class); o.u8(s.maxspeed); o.u8(s.access);
        }
        o.deltas(&self.shape, 2);
        o.u32(self.names.len() as u32);
        for (n, e) in self.names.iter().zip(&self.names_en) {
            o.str(n);
            o.str(e);
        }
        o.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        if b.get(..4) != Some(GRAPH_MAGIC) {
            return Err("not a graph pack".into());
        }
        let mut r = In { b, i: 4 };
        let lat = r.deltas(1)?;
        let lon = r.deltas(1)?;
        let ns = r.var()? as usize;
        let mut segs = Vec::with_capacity(ns);
        let mut off = 0u32;
        for _ in 0..ns {
            let a = r.var()? as u32;
            let b = r.var()? as u32;
            let len_m = r.var()? as f32 / 10.0;
            let shape_len = r.var()? as u32;
            let name = match r.var()? { 0 => NO_NAME, n => (n - 1) as u32 };
            segs.push(Seg { a, b, len_m, shape_off: off, shape_len, name, class: r.u8()?, maxspeed: r.u8()?, access: r.u8()? });
            off += shape_len;
        }
        let shape = r.deltas(2)?;
        if off as usize * 2 != shape.len() {
            return Err("graph pack shape count mismatch".into());
        }
        let nn = r.u32()? as usize;
        let (mut names, mut names_en) = (Vec::with_capacity(nn), Vec::with_capacity(nn));
        for _ in 0..nn {
            names.push(r.str()?);
            names_en.push(r.str()?);
        }
        Ok(Graph::new(lat, lon, segs, shape, names, names_en))
    }

    pub fn shape_points(&self, seg: &Seg) -> impl Iterator<Item = (f64, f64)> + '_ {
        let o = seg.shape_off as usize * 2;
        let n = seg.shape_len as usize;
        self.shape[o..o + n * 2].chunks_exact(2).map(|p| (to_deg(p[0]), to_deg(p[1])))
    }

    /// Nearest point on any segment that `ok` accepts, within `max_m` metres.
    pub fn snap(&self, lat: f64, lon: f64, max_m: f64, ok: impl Fn(&Seg) -> bool) -> Option<Snap> {
        let g = &self.grid;
        if g.cols == 0 {
            return None;
        }
        let cx = ((lon - g.min_lon) / CELL).floor() as i64;
        let cy = ((lat - g.min_lat) / CELL).floor() as i64;
        let mut best: Option<Snap> = None;
        let cell_m = CELL * 111_320.0 * lat.to_radians().cos();
        let max_ring = (max_m / cell_m).ceil() as i64 + 1;
        for ring in 0..=max_ring {
            if let Some(b) = &best {
                if (ring - 1) as f64 * cell_m > b.dist_m {
                    break;
                }
            }
            for y in cy - ring..=cy + ring {
                for x in cx - ring..=cx + ring {
                    if (x - cx).abs() != ring && (y - cy).abs() != ring {
                        continue;
                    }
                    if x < 0 || y < 0 || x >= g.cols as i64 || y >= g.rows as i64 {
                        continue;
                    }
                    let c = y as usize * g.cols + x as usize;
                    for &si in &g.items[g.start[c] as usize..g.start[c + 1] as usize] {
                        let s = &self.segs[si as usize];
                        if !ok(s) {
                            continue;
                        }
                        let pts: Vec<(f64, f64)> = self.shape_points(s).collect();
                        let mut walked = 0.0;
                        for w in pts.windows(2) {
                            let ((alat, alon), (blat, blon)) = (w[0], w[1]);
                            let piece = crate::geo::haversine(alat, alon, blat, blon);
                            let (t, d2) = project(lat, lon, alat, alon, blat, blon);
                            let d = d2.sqrt();
                            if d <= max_m && best.as_ref().map_or(true, |b| d < b.dist_m) {
                                let along = if s.len_m > 0.0 { ((walked + t * piece) / s.len_m as f64).clamp(0.0, 1.0) } else { 0.0 };
                                best = Some(Snap {
                                    seg: si, t: along,
                                    lat: alat + (blat - alat) * t, lon: alon + (blon - alon) * t, dist_m: d,
                                });
                            }
                            walked += piece;
                        }
                    }
                }
            }
        }
        best
    }

    pub fn bounds(&self) -> [f64; 4] {
        let g = &self.grid;
        [g.min_lon, g.min_lat, g.min_lon + g.cols as f64 * CELL, g.min_lat + g.rows as f64 * CELL]
    }
}

impl Grid {
    fn empty() -> Self {
        Grid { min_lat: 0.0, min_lon: 0.0, cols: 0, rows: 0, start: vec![0], items: vec![] }
    }

    fn build(g: &Graph) -> Self {
        if g.shape.is_empty() {
            return Grid::empty();
        }
        let (mut min_lat, mut min_lon, mut max_lat, mut max_lon) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in g.shape.chunks_exact(2) {
            let (la, lo) = (to_deg(p[0]), to_deg(p[1]));
            min_lat = min_lat.min(la); max_lat = max_lat.max(la);
            min_lon = min_lon.min(lo); max_lon = max_lon.max(lo);
        }
        let cols = ((max_lon - min_lon) / CELL).floor() as usize + 1;
        let rows = ((max_lat - min_lat) / CELL).floor() as usize + 1;
        let cell_of = |la: f64, lo: f64| -> (usize, usize) {
            (((lo - min_lon) / CELL) as usize, ((la - min_lat) / CELL) as usize)
        };
        let mut lists: Vec<Vec<u32>> = vec![Vec::new(); cols * rows];
        for (i, s) in g.segs.iter().enumerate() {
            let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
            for (la, lo) in g.shape_points(s) {
                let (x, y) = cell_of(la, lo);
                x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y);
            }
            for y in y0..=y1 {
                for x in x0..=x1 {
                    lists[y * cols + x].push(i as u32);
                }
            }
        }
        let mut start = Vec::with_capacity(lists.len() + 1);
        let mut items = Vec::new();
        start.push(0);
        for l in lists {
            items.extend(l);
            start.push(items.len() as u32);
        }
        Grid { min_lat, min_lon, cols, rows, start, items }
    }
}

// ---------- places ----------

pub struct Place {
    pub lat: i32,
    pub lon: i32,
    pub kind: u16,
    pub name: String,
    pub name_en: String,
    /// Details from the map data, empty when unknown.
    pub phone: String,
    pub hours: String,
    pub website: String,
    pub address: String,
}

pub struct Places {
    pub kinds: Vec<String>,
    pub items: Vec<Place>,
    /// Folded "name name_en" per item, for matching.
    pub keys: Vec<String>,
}

impl Places {
    pub fn new(kinds: Vec<String>, items: Vec<Place>) -> Self {
        let keys = items.iter().map(|p| fold(&format!("{} {}", p.name, p.name_en))).collect();
        Places { kinds, items, keys }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut o = Out(Vec::new());
        o.0.extend_from_slice(PLACES_MAGIC);
        o.u32(self.kinds.len() as u32);
        for k in &self.kinds {
            o.str(k);
        }
        o.u32(self.items.len() as u32);
        for p in &self.items {
            o.i32(p.lat); o.i32(p.lon);
            o.0.extend_from_slice(&p.kind.to_le_bytes());
            o.str(&p.name); o.str(&p.name_en);
            o.str(&p.phone); o.str(&p.hours); o.str(&p.website); o.str(&p.address);
        }
        o.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        if b.get(..4) != Some(PLACES_MAGIC) {
            return Err("not a places pack".into());
        }
        let mut r = In { b, i: 4 };
        let nk = r.u32()? as usize;
        let kinds = (0..nk).map(|_| r.str()).collect::<Result<Vec<_>, _>>()?;
        let n = r.u32()? as usize;
        let mut items = Vec::with_capacity(n);
        for _ in 0..n {
            let lat = r.i32()?;
            let lon = r.i32()?;
            let kind = u16::from_le_bytes(r.take(2)?.try_into().unwrap());
            items.push(Place {
                lat, lon, kind, name: r.str()?, name_en: r.str()?,
                phone: r.str()?, hours: r.str()?, website: r.str()?, address: r.str()?,
            });
        }
        Ok(Places::new(kinds, items))
    }
}
