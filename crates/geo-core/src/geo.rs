//! Small geometry helpers. Coordinates are stored as degrees * 1e7 in i32.

pub const E7: f64 = 1e7;
const R: f64 = 6_371_008.8;

#[inline]
pub fn to_deg(v: i32) -> f64 {
    v as f64 / E7
}

#[inline]
pub fn to_e7(v: f64) -> i32 {
    (v * E7).round() as i32
}

/// Great-circle distance in metres.
pub fn haversine(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

/// Initial bearing in degrees, 0 = north, clockwise.
pub fn bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dl = (lon2 - lon1).to_radians();
    let y = dl.sin() * p2.cos();
    let x = p1.cos() * p2.sin() - p1.sin() * p2.cos() * dl.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

/// Project point P onto segment AB in a local equirectangular frame.
/// Returns (t in 0..=1, squared distance in metres^2).
pub fn project(plat: f64, plon: f64, alat: f64, alon: f64, blat: f64, blon: f64) -> (f64, f64) {
    let k = plat.to_radians().cos();
    let m = 111_320.0;
    let (ax, ay) = ((alon - plon) * k * m, (alat - plat) * m);
    let (bx, by) = ((blon - plon) * k * m, (blat - plat) * m);
    let (dx, dy) = (bx - ax, by - ay);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (-(ax * dx + ay * dy) / len2).clamp(0.0, 1.0) };
    let (cx, cy) = (ax + t * dx, ay + t * dy);
    (t, cx * cx + cy * cy)
}
