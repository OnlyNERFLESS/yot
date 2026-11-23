//! Toolbox app core: packs, offline routing and search, tracks, tasks, places,
//! settings. Online providers (Neshan, Google) are called from the web layer,
//! which already has a working TLS stack on every platform.

mod db;
mod packs;

use std::sync::Arc;

use geo_core::{route as georoute, search as geosearch, Mode};
use rusqlite::params;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};

use db::{Db, PlaceInput, TaskInput, TrackPoint};
use packs::{PackInfo, Packs};

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

fn valid_ll(v: [f64; 2]) -> bool {
    v[0].is_finite() && v[1].is_finite() && v[0].abs() <= 180.0 && v[1].abs() <= 90.0
}

// ---------------- packs ----------------

#[tauri::command]
fn packs_list(packs: State<Arc<Packs>>) -> Vec<PackInfo> {
    packs.names().iter().map(|n| packs.info(n)).collect()
}

#[tauri::command]
fn packs_dir(packs: State<Arc<Packs>>) -> String {
    packs.dir.display().to_string()
}

#[tauri::command]
fn packs_delete(packs: State<Arc<Packs>>, name: String) -> R<()> {
    packs.delete(&name)
}

/// Raw tile bytes for the map. Returned as binary, not JSON, so a 200 KB tile
/// costs one copy rather than a base64 round trip.
#[tauri::command]
fn pack_read_range(packs: State<Arc<Packs>>, name: String, offset: u64, length: usize) -> R<Response> {
    if length > 16 << 20 {
        return Err("range too large".into());
    }
    packs.read_range(&name, offset, length).map(Response::new)
}

/// Body: raw bytes. Headers: x-file (e.g. "tehran.pmtiles"), x-offset, x-done.
#[tauri::command]
fn packs_write(packs: State<Arc<Packs>>, request: Request) -> R<()> {
    let h = request.headers();
    let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let file = get("x-file").ok_or("missing x-file")?;
    let offset: u64 = get("x-offset").and_then(|v| v.parse().ok()).ok_or("missing x-offset")?;
    let done = get("x-done").as_deref() == Some("1");
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    packs.write_chunk(&file, offset, data, done)
}

// ---------------- routing & search ----------------

#[derive(Serialize)]
struct OfflineRoute {
    provider: &'static str,
    #[serde(flatten)]
    route: georoute::Route,
}

/// The road search played back by the "finding your route" animation, as
/// bytes: u8 reached, u32 line count, then per line u16 point count and that
/// many (f32 lon, f32 lat), little-endian. Binary because a cross-city search
/// is thousands of segments, which as JSON would be megabytes per tap.
#[tauri::command]
async fn route_explore(packs: State<'_, Arc<Packs>>, mode: Mode, from: [f64; 2], to: [f64; 2]) -> R<Response> {
    if !valid_ll(from) || !valid_ll(to) {
        return Err("invalid coordinates".into());
    }
    let name = packs
        .covering(from[1], from[0])
        .filter(|n| packs.covering(to[1], to[0]).as_deref() == Some(n.as_str()))
        .ok_or("no offline map covers both points")?;
    let g = packs.graph(&name)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Spread wide first; if that runs out of budget before arriving,
        // lean harder on the target so the growth still touches it.
        let mut res = (Vec::new(), false);
        for greed in [0.6, 0.9, 1.0, 1.4] {
            res = georoute::explore(&g, mode, (from[1], from[0]), (to[1], to[0]), greed, 60_000)?;
            if res.1 {
                break;
            }
        }
        let (lines, reached) = res;
        let mut b: Vec<u8> = Vec::with_capacity(5 + lines.iter().map(|l| 2 + l.len() * 8).sum::<usize>());
        b.push(reached as u8);
        b.extend_from_slice(&(lines.len() as u32).to_le_bytes());
        for l in &lines {
            let l = &l[..l.len().min(u16::MAX as usize)];
            b.extend_from_slice(&(l.len() as u16).to_le_bytes());
            for p in l {
                b.extend_from_slice(&p[0].to_le_bytes());
                b.extend_from_slice(&p[1].to_le_bytes());
            }
        }
        Ok::<_, String>(Response::new(b))
    })
    .await
    .map_err(e)?
}

#[tauri::command]
async fn route_offline(packs: State<'_, Arc<Packs>>, mode: Mode, from: [f64; 2], to: [f64; 2]) -> R<OfflineRoute> {
    if !valid_ll(from) || !valid_ll(to) {
        return Err("invalid coordinates".into());
    }
    let name = packs
        .covering(from[1], from[0])
        .filter(|n| packs.covering(to[1], to[0]).as_deref() == Some(n.as_str()))
        .ok_or("no offline map covers both points")?;
    let g = packs.graph(&name)?;
    // Routing is CPU work; keep it off the IPC thread.
    tauri::async_runtime::spawn_blocking(move || {
        georoute::route(&g, mode, (from[1], from[0]), (to[1], to[0])).map(|route| OfflineRoute { provider: "offline", route })
    })
    .await
    .map_err(e)?
}

#[tauri::command]
async fn search(packs: State<'_, Arc<Packs>>, query: String, near: Option<[f64; 2]>) -> R<Vec<geosearch::Hit>> {
    if query.chars().count() > 100 {
        return Err("query too long".into());
    }
    let near_ll = near.filter(|v| valid_ll(*v)).map(|v| (v[1], v[0]));
    let all: Vec<_> = packs.names().iter().filter_map(|n| packs.places(n).ok()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut hits: Vec<geosearch::Hit> = all.iter().flat_map(|p| geosearch::search(p, &query, near_ll, 20)).collect();
        hits.truncate(20);
        hits
    })
    .await
    .map_err(e)
}

/// Nearest places of the given kinds (category chips).
#[tauri::command]
async fn nearby(packs: State<'_, Arc<Packs>>, kinds: Vec<String>, near: [f64; 2], radius_m: f64) -> R<Vec<geosearch::Hit>> {
    if !valid_ll(near) || kinds.is_empty() || kinds.len() > 20 || kinds.iter().any(|k| k.len() > 64) {
        return Err("invalid request".into());
    }
    let radius = radius_m.clamp(100.0, 50_000.0);
    let all: Vec<_> = packs.names().iter().filter_map(|n| packs.places(n).ok()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut hits: Vec<geosearch::Hit> =
            all.iter().flat_map(|p| geosearch::nearby(p, &kinds, (near[1], near[0]), radius, 40)).collect();
        hits.sort_by(|a, b| a.distance_m.partial_cmp(&b.distance_m).unwrap());
        hits.truncate(40);
        hits
    })
    .await
    .map_err(e)
}

#[derive(Serialize)]
struct RoadAt {
    name: String,
    name_en: String,
    distance_m: f64,
}

/// The nearest named road to a tapped point, for labelling a dropped pin.
#[tauri::command]
async fn road_at(packs: State<'_, Arc<Packs>>, at: [f64; 2]) -> R<Option<RoadAt>> {
    if !valid_ll(at) {
        return Err("invalid coordinates".into());
    }
    let Some(name) = packs.covering(at[1], at[0]) else { return Ok(None) };
    let g = packs.graph(&name)?;
    tauri::async_runtime::spawn_blocking(move || {
        g.snap(at[1], at[0], 250.0, |s| s.name != geo_core::format::NO_NAME).map(|sn| {
            let s = &g.segs[sn.seg as usize];
            RoadAt { name: g.names[s.name as usize].clone(), name_en: g.names_en[s.name as usize].clone(), distance_m: sn.dist_m }
        })
    })
    .await
    .map_err(e)
}

/// Every installed transit network, as the packs' JSON documents.
#[tauri::command]
fn transit_list(packs: State<Arc<Packs>>) -> Vec<String> {
    packs.names().iter().filter_map(|n| packs.transit(n).ok()).collect()
}

/// Details for a place label tapped on the map.
#[tauri::command]
async fn place_at(packs: State<'_, Arc<Packs>>, name: String, at: [f64; 2]) -> R<Option<geosearch::Hit>> {
    if !valid_ll(at) || name.chars().count() > 200 {
        return Err("invalid request".into());
    }
    let all: Vec<_> = packs.names().iter().filter_map(|n| packs.places(n).ok()).collect();
    tauri::async_runtime::spawn_blocking(move || all.iter().find_map(|p| geosearch::place_at(p, &name, (at[1], at[0]), 120.0)))
        .await
        .map_err(e)
}

// ---------------- settings & secrets ----------------

#[derive(Serialize)]
struct Settings {
    lang: String,
    theme: String,
    provider_pref: String,
    default_mode: String,
    avoid_traffic_zone: bool,
    avoid_odd_even: bool,
    has_neshan_service_key: bool,
    has_neshan_web_key: bool,
    has_google_key: bool,
    ringtone: String,
}

const SECRETS: &[&str] = &["neshan_service_key", "neshan_web_key", "google_key"];

/// Keys compiled in by build.rs from the private .env.local. A key saved on
/// the device still wins, so one can be rotated without a rebuild.
fn builtin_secret(name: &str) -> Option<&'static str> {
    match name {
        "neshan_service_key" => option_env!("YOT_BUILTIN_NESHAN_SERVICE_KEY"),
        "neshan_web_key" => option_env!("YOT_BUILTIN_NESHAN_WEB_KEY"),
        "google_key" => option_env!("YOT_BUILTIN_GOOGLE_KEY"),
        _ => None,
    }
    .filter(|v| !v.is_empty())
}

#[tauri::command]
fn settings_get(db: State<Db>) -> R<Settings> {
    let c = db.0.lock().unwrap();
    let s = |k: &str, d: &str| -> R<String> {
        Ok(db::kv_get(&c, k).map_err(e)?.and_then(|v| serde_json::from_str::<String>(&v).ok()).unwrap_or_else(|| d.into()))
    };
    let b = |k: &str, d: bool| -> R<bool> {
        Ok(db::kv_get(&c, k).map_err(e)?.and_then(|v| serde_json::from_str::<bool>(&v).ok()).unwrap_or(d))
    };
    let has = |k: &str| -> R<bool> {
        Ok(builtin_secret(k).is_some() || db::kv_get(&c, &format!("secret:{k}")).map_err(e)?.is_some())
    };
    Ok(Settings {
        lang: s("lang", "en")?,
        theme: s("theme", "system")?,
        provider_pref: s("provider_pref", "auto")?,
        default_mode: s("default_mode", "car")?,
        avoid_traffic_zone: b("avoid_traffic_zone", false)?,
        avoid_odd_even: b("avoid_odd_even", false)?,
        has_neshan_service_key: has("neshan_service_key")?,
        has_neshan_web_key: has("neshan_web_key")?,
        has_google_key: has("google_key")?,
        ringtone: s("ringtone", "emerald")?,
    })
}

/// `value` is JSON. Only known keys with the right type and allowed values are stored.
#[tauri::command]
fn settings_set(db: State<Db>, key: String, value: String) -> R<()> {
    let v: serde_json::Value = serde_json::from_str(&value).map_err(e)?;
    let one_of = |opts: &[&str]| v.as_str().is_some_and(|s| opts.contains(&s));
    let ok = match key.as_str() {
        "lang" => one_of(&["en", "fa"]),
        "theme" => one_of(&["system", "light", "dark"]),
        "provider_pref" => one_of(&["auto", "offline"]),
        "default_mode" => one_of(&["car", "motorcycle", "walk"]),
        "avoid_traffic_zone" | "avoid_odd_even" => v.is_boolean(),
        "ringtone" => one_of(RINGTONES) || v.as_str() == Some("silent"),
        _ => return Err(format!("unknown setting: {key}")),
    };
    if !ok {
        return Err(format!("invalid value for {key}"));
    }
    db::kv_set(&db.0.lock().unwrap(), &key, &value).map_err(e)
}

/// Empty value removes the secret.
#[tauri::command]
fn secret_set(db: State<Db>, name: String, value: String) -> R<()> {
    if !SECRETS.contains(&name.as_str()) {
        return Err(format!("unknown secret: {name}"));
    }
    let value = value.trim();
    if value.len() > 200 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("that does not look like an API key".into());
    }
    let c = db.0.lock().unwrap();
    let k = format!("secret:{name}");
    if value.is_empty() { db::kv_delete(&c, &k) } else { db::kv_set(&c, &k, value) }.map_err(e)
}

#[tauri::command]
fn secret_get(db: State<Db>, name: String) -> R<Option<String>> {
    if !SECRETS.contains(&name.as_str()) {
        return Err(format!("unknown secret: {name}"));
    }
    let stored = db::kv_get(&db.0.lock().unwrap(), &format!("secret:{name}")).map_err(e)?;
    Ok(stored.or_else(|| builtin_secret(&name).map(str::to_string)))
}

// ---------------- notification sounds ----------------

const RINGTONES: &[&str] = &["emerald", "pulse", "bloom", "marimba", "beacon"];

/// Windows update: fetch the new installer with the curl.exe that ships with
/// Windows (GitHub's download links refuse in-page fetches), then run it in
/// passive mode. `/P` shows only a progress bar, `/UPDATE` installs over this
/// copy, `/R` starts the new version when done; this one exits to make way.
#[tauri::command]
async fn update_install(app: tauri::AppHandle, url: String) -> R<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const NO_WINDOW: u32 = 0x0800_0000;
        if !url.starts_with("https://github.com/OnlyNERFLESS/yot/releases/download/") {
            return Err("unexpected update address".into());
        }
        let dest = std::env::temp_dir().join("YOT-update-setup.exe");
        let d2 = dest.clone();
        let out = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new("curl.exe")
                .args(["-fsSL", "--retry", "2", "--connect-timeout", "20", "-o"])
                .arg(&d2)
                .arg(&url)
                .creation_flags(NO_WINDOW)
                .output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("download failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        std::process::Command::new(&dest).args(["/P", "/R", "/UPDATE"]).spawn().map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, url);
        Err("not supported on this platform".into())
    }
}

/// Opens the OS page where location access is switched on. Windows only: on
/// Android the app asks for the permission itself.
#[tauri::command]
fn open_location_settings(app: tauri::AppHandle) -> R<()> {
    #[cfg(windows)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().open_url("ms-settings:privacy-location", None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("not supported on this platform".into())
    }
}

/// The tones ship inside the binary; Windows toasts need a real file path, so
/// the chosen one is written to the app data folder once and its path returned.
/// Android plays the copies in res/raw by resource name instead.
#[tauri::command]
fn sound_file(app: tauri::AppHandle, name: String) -> R<String> {
    let bytes: &[u8] = match name.as_str() {
        "emerald" => include_bytes!("../sounds/emerald.wav"),
        "pulse" => include_bytes!("../sounds/pulse.wav"),
        "bloom" => include_bytes!("../sounds/bloom.wav"),
        "marimba" => include_bytes!("../sounds/marimba.wav"),
        "beacon" => include_bytes!("../sounds/beacon.wav"),
        _ => return Err(format!("unknown sound: {name}")),
    };
    let dir = app.path().app_data_dir().map_err(e)?.join("sounds");
    std::fs::create_dir_all(&dir).map_err(e)?;
    let path = dir.join(format!("{name}.wav"));
    if std::fs::metadata(&path).map(|m| m.len() as usize != bytes.len()).unwrap_or(true) {
        std::fs::write(&path, bytes).map_err(e)?;
    }
    Ok(path.to_string_lossy().into_owned())
}

// ---------------- tracks ----------------

#[tauri::command]
fn track_start(db: State<Db>, name: String) -> R<i64> {
    let c = db.0.lock().unwrap();
    let name: String = name.trim().chars().take(80).collect();
    c.execute("INSERT INTO tracks(name, started_at) VALUES(?1, ?2)", params![name, db::now_ms()]).map_err(e)?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
fn track_point(db: State<Db>, id: i64, p: TrackPoint) -> R<()> {
    if !valid_ll([p.lon, p.lat]) {
        return Err("invalid point".into());
    }
    let mut c = db.0.lock().unwrap();
    let tx = c.transaction().map_err(e)?;
    let last: (Option<f64>, Option<f64>, Option<i64>) = tx
        .query_row("SELECT last_lat, last_lon, ended_at FROM tracks WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(e)?;
    if last.2.is_some() {
        return Err("track already stopped".into());
    }
    let step = match (last.0, last.1) {
        (Some(la), Some(lo)) => geo_core::geo::haversine(la, lo, p.lat, p.lon),
        _ => 0.0,
    };
    tx.execute(
        "INSERT INTO track_points(track_id, lat, lon, t, speed, accuracy) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, p.lat, p.lon, p.t, p.speed, p.accuracy],
    )
    .map_err(e)?;
    tx.execute(
        "UPDATE tracks SET distance_m = distance_m + ?2, points = points + 1, last_lat = ?3, last_lon = ?4 WHERE id = ?1",
        params![id, step, p.lat, p.lon],
    )
    .map_err(e)?;
    tx.commit().map_err(e)
}

#[tauri::command]
fn track_stop(db: State<Db>, id: i64) -> R<db::Track> {
    let c = db.0.lock().unwrap();
    c.execute("UPDATE tracks SET ended_at = ?2 WHERE id = ?1 AND ended_at IS NULL", params![id, db::now_ms()])
        .map_err(e)?;
    c.query_row("SELECT id,name,started_at,ended_at,distance_m,points FROM tracks WHERE id = ?1", [id], db::track_row)
        .map_err(e)
}

#[tauri::command]
fn tracks_list(db: State<Db>) -> R<Vec<db::Track>> {
    let c = db.0.lock().unwrap();
    let mut s = c
        .prepare("SELECT id,name,started_at,ended_at,distance_m,points FROM tracks ORDER BY started_at DESC")
        .map_err(e)?;
    let rows = s.query_map([], db::track_row).map_err(e)?;
    rows.collect::<Result<_, _>>().map_err(e)
}

fn points_of(c: &rusqlite::Connection, id: i64) -> R<Vec<TrackPoint>> {
    let mut s = c
        .prepare("SELECT lat,lon,t,speed,accuracy FROM track_points WHERE track_id = ?1 ORDER BY t")
        .map_err(e)?;
    let rows = s
        .query_map([id], |r| {
            Ok(TrackPoint { lat: r.get(0)?, lon: r.get(1)?, t: r.get(2)?, speed: r.get(3)?, accuracy: r.get(4)? })
        })
        .map_err(e)?;
    rows.collect::<Result<_, _>>().map_err(e)
}

#[tauri::command]
fn track_points(db: State<Db>, id: i64) -> R<Vec<TrackPoint>> {
    points_of(&db.0.lock().unwrap(), id)
}

#[tauri::command]
fn track_delete(db: State<Db>, id: i64) -> R<()> {
    db.0.lock().unwrap().execute("DELETE FROM tracks WHERE id = ?1", [id]).map(|_| ()).map_err(e)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Days since 1970-01-01 to (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[tauri::command]
fn track_gpx(db: State<Db>, id: i64) -> R<String> {
    let c = db.0.lock().unwrap();
    let name: String = c.query_row("SELECT name FROM tracks WHERE id = ?1", [id], |r| r.get(0)).map_err(e)?;
    let pts = points_of(&c, id)?;
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"Toolbox\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n",
    );
    out += &format!("<trk><name>{}</name><trkseg>\n", xml_escape(&name));
    for p in pts {
        let secs = p.t.div_euclid(1000);
        let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
        let (y, m, d) = civil_from_days(days);
        out += &format!(
            "<trkpt lat=\"{:.7}\" lon=\"{:.7}\"><time>{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z</time></trkpt>\n",
            p.lat,
            p.lon,
            rem / 3600,
            rem % 3600 / 60,
            rem % 60
        );
    }
    out += "</trkseg></trk>\n</gpx>\n";
    Ok(out)
}

// ---------------- tasks ----------------

#[tauri::command]
fn tasks_list(db: State<Db>) -> R<Vec<db::Task>> {
    let c = db.0.lock().unwrap();
    let mut s = c
        .prepare(
            "SELECT id,title,notes,due,done,priority,created_at FROM tasks \
             ORDER BY done, due IS NULL, due, priority DESC, created_at DESC",
        )
        .map_err(e)?;
    let rows = s.query_map([], db::task_row).map_err(e)?;
    rows.collect::<Result<_, _>>().map_err(e)
}

fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

#[tauri::command]
fn task_save(db: State<Db>, task: TaskInput) -> R<db::Task> {
    let title = task.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err("title must be 1 to 200 characters".into());
    }
    if task.notes.chars().count() > 5000 {
        return Err("notes are too long".into());
    }
    if task.due.as_deref().is_some_and(|d| !valid_date(d)) {
        return Err("due date must be YYYY-MM-DD".into());
    }
    let priority = task.priority.min(2) as i64;
    let c = db.0.lock().unwrap();
    let id = match task.id {
        Some(id) => {
            c.execute(
                "UPDATE tasks SET title=?2, notes=?3, due=?4, done=?5, priority=?6 WHERE id=?1",
                params![id, title, task.notes, task.due, task.done as i64, priority],
            )
            .map_err(e)?;
            id
        }
        None => {
            c.execute(
                "INSERT INTO tasks(title,notes,due,done,priority,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![title, task.notes, task.due, task.done as i64, priority, db::now_ms()],
            )
            .map_err(e)?;
            c.last_insert_rowid()
        }
    };
    c.query_row("SELECT id,title,notes,due,done,priority,created_at FROM tasks WHERE id=?1", [id], db::task_row)
        .map_err(e)
}

#[tauri::command]
fn task_delete(db: State<Db>, id: i64) -> R<()> {
    db.0.lock().unwrap().execute("DELETE FROM tasks WHERE id = ?1", [id]).map(|_| ()).map_err(e)
}

// ---------------- reminders ----------------

const REMINDER_COLS: &str =
    "id,title,notes,start_ms,all_day,repeat,alerts,place_name,place_lat,place_lon,radius_m,task_id,snooze_until,done";

#[tauri::command]
fn reminders_list(db: State<Db>) -> R<Vec<db::Reminder>> {
    let c = db.0.lock().unwrap();
    let mut s = c.prepare(&format!("SELECT {REMINDER_COLS} FROM reminders ORDER BY start_ms")).map_err(e)?;
    let rows = s.query_map([], db::reminder_row).map_err(e)?;
    rows.collect::<Result<_, _>>().map_err(e)
}

fn check_reminder(r: &db::ReminderInput) -> R<()> {
    let title = r.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err("title must be 1 to 200 characters".into());
    }
    if r.notes.chars().count() > 5000 {
        return Err("notes are too long".into());
    }
    // 1970..2100
    if !(0..=4_102_444_800_000).contains(&r.start_ms) {
        return Err("invalid date".into());
    }
    if !matches!(r.repeat.freq.as_str(), "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "interval") {
        return Err("invalid repeat".into());
    }
    if r.repeat.interval.is_some_and(|n| n == 0 || n > 366) {
        return Err("repeat interval must be 1 to 366".into());
    }
    if r.repeat.days.as_ref().is_some_and(|d| d.len() > 7 || d.iter().any(|x| *x > 6)) {
        return Err("invalid repeat days".into());
    }
    if r.repeat.count.is_some_and(|n| n == 0 || n > 10_000) {
        return Err("invalid repeat count".into());
    }
    if r.alerts.len() > 8 || r.alerts.iter().any(|m| !(0..=60 * 24 * 30).contains(m)) {
        return Err("alerts must be between 0 minutes and 30 days before".into());
    }
    if let Some(p) = &r.place {
        if !valid_ll([p.lon, p.lat]) || !(50.0..=5000.0).contains(&p.radius_m) || p.name.chars().count() > 120 {
            return Err("invalid place".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn reminder_save(db: State<Db>, r: db::ReminderInput) -> R<db::Reminder> {
    check_reminder(&r)?;
    let repeat = serde_json::to_string(&r.repeat).map_err(e)?;
    let mut alerts = r.alerts.clone();
    alerts.sort_unstable();
    alerts.dedup();
    let alerts = serde_json::to_string(&alerts).map_err(e)?;
    let (pn, plat, plon, prad) = match &r.place {
        Some(p) => (Some(p.name.trim().to_string()), Some(p.lat), Some(p.lon), Some(p.radius_m)),
        None => (None, None, None, None),
    };
    let c = db.0.lock().unwrap();
    let id = match r.id {
        Some(id) => {
            c.execute(
                "UPDATE reminders SET title=?2, notes=?3, start_ms=?4, all_day=?5, repeat=?6, alerts=?7, place_name=?8, \
                 place_lat=?9, place_lon=?10, radius_m=?11, task_id=?12, done=?13, snooze_until=NULL WHERE id=?1",
                params![id, r.title.trim(), r.notes, r.start_ms, r.all_day as i64, repeat, alerts, pn, plat, plon, prad, r.task_id, r.done as i64],
            )
            .map_err(e)?;
            id
        }
        None => {
            c.execute(
                "INSERT INTO reminders(title,notes,start_ms,all_day,repeat,alerts,place_name,place_lat,place_lon,radius_m,task_id,done,created_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![r.title.trim(), r.notes, r.start_ms, r.all_day as i64, repeat, alerts, pn, plat, plon, prad, r.task_id, r.done as i64, db::now_ms()],
            )
            .map_err(e)?;
            c.last_insert_rowid()
        }
    };
    c.query_row(&format!("SELECT {REMINDER_COLS} FROM reminders WHERE id=?1"), [id], db::reminder_row).map_err(e)
}

#[tauri::command]
fn reminder_delete(db: State<Db>, id: i64) -> R<()> {
    db.0.lock().unwrap().execute("DELETE FROM reminders WHERE id = ?1", [id]).map(|_| ()).map_err(e)
}

/// Push the next alert to `until_ms` (snooze), or clear it with None.
#[tauri::command]
fn reminder_snooze(db: State<Db>, id: i64, until_ms: Option<i64>) -> R<()> {
    if until_ms.is_some_and(|u| !(0..=4_102_444_800_000).contains(&u)) {
        return Err("invalid time".into());
    }
    db.0.lock().unwrap().execute("UPDATE reminders SET snooze_until=?2 WHERE id=?1", params![id, until_ms]).map(|_| ()).map_err(e)
}

// ---------------- saved places ----------------

#[tauri::command]
fn places_list(db: State<Db>) -> R<Vec<db::Place>> {
    let c = db.0.lock().unwrap();
    let mut s = c.prepare("SELECT id,name,lat,lon,note FROM places ORDER BY name").map_err(e)?;
    let rows = s
        .query_map([], |r| {
            Ok(db::Place { id: r.get(0)?, name: r.get(1)?, lat: r.get(2)?, lon: r.get(3)?, note: r.get(4)? })
        })
        .map_err(e)?;
    rows.collect::<Result<_, _>>().map_err(e)
}

#[tauri::command]
fn place_save(db: State<Db>, p: PlaceInput) -> R<db::Place> {
    let name = p.name.trim();
    if name.is_empty() || name.chars().count() > 120 || p.note.chars().count() > 1000 {
        return Err("name must be 1 to 120 characters".into());
    }
    if !valid_ll([p.lon, p.lat]) {
        return Err("invalid coordinates".into());
    }
    let c = db.0.lock().unwrap();
    c.execute("INSERT INTO places(name,lat,lon,note) VALUES(?1,?2,?3,?4)", params![name, p.lat, p.lon, p.note])
        .map_err(e)?;
    Ok(db::Place { id: c.last_insert_rowid(), name: name.into(), lat: p.lat, lon: p.lon, note: p.note })
}

#[tauri::command]
fn place_delete(db: State<Db>, id: i64) -> R<()> {
    db.0.lock().unwrap().execute("DELETE FROM places WHERE id = ?1", [id]).map(|_| ()).map_err(e)
}

/// The offline data a release build ships with (feature `bundled-packs`).
#[cfg(feature = "bundled-packs")]
const BUNDLED_PACKS: &[(&str, &[u8])] = &[
    ("iran.pmtiles", include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../release-packs/iran.pmtiles"))),
    ("tehran.pmtiles", include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../release-packs/tehran.pmtiles"))),
    ("tehran.graph", include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../release-packs/tehran.graph"))),
    ("tehran.places", include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../release-packs/tehran.places"))),
    ("tehran.transit", include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../release-packs/tehran.transit"))),
];

/// Writes the bundled packs into the packs folder on first launch, or when an
/// update ships a different file. Written to a temporary name and renamed, so
/// an interrupted first launch never leaves a half pack behind.
fn install_bundled_packs(dir: &std::path::Path) -> std::io::Result<()> {
    #[cfg(feature = "bundled-packs")]
    {
        std::fs::create_dir_all(dir)?;
        for (name, bytes) in BUNDLED_PACKS {
            let path = dir.join(name);
            if std::fs::metadata(&path).map(|m| m.len() != bytes.len() as u64).unwrap_or(true) {
                let tmp = dir.join(format!("{name}.part"));
                std::fs::write(&tmp, bytes)?;
                std::fs::rename(&tmp, &path)?;
            }
        }
    }
    let _ = dir;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_geolocation::init());
    }
    builder
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let conn = db::open(&data.join("toolbox.db"))?;
            app.manage(Db(std::sync::Mutex::new(conn)));
            install_bundled_packs(&data.join("packs"))?;
            app.manage(Arc::new(Packs::new(data.join("packs"))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sound_file,
            open_location_settings,
            update_install,
            route_explore,
            packs_list,
            packs_dir,
            packs_delete,
            pack_read_range,
            packs_write,
            route_offline,
            search,
            nearby,
            place_at,
            road_at,
            transit_list,
            settings_get,
            settings_set,
            secret_set,
            secret_get,
            track_start,
            track_point,
            track_stop,
            tracks_list,
            track_points,
            track_delete,
            track_gpx,
            tasks_list,
            task_save,
            task_delete,
            reminders_list,
            reminder_save,
            reminder_delete,
            reminder_snooze,
            places_list,
            place_save,
            place_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
