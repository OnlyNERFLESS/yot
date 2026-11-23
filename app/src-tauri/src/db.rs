//! SQLite storage: settings, secrets, tracks, tasks, saved places.

use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, started_at INTEGER NOT NULL,
  ended_at INTEGER, distance_m REAL NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
  last_lat REAL, last_lon REAL
);
CREATE TABLE IF NOT EXISTS track_points (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lon REAL NOT NULL, t INTEGER NOT NULL, speed REAL, accuracy REAL
);
CREATE INDEX IF NOT EXISTS track_points_by_track ON track_points(track_id, t);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  due TEXT, done INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  start_ms INTEGER NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
  repeat TEXT NOT NULL, alerts TEXT NOT NULL,
  place_name TEXT, place_lat REAL, place_lon REAL, radius_m REAL,
  task_id INTEGER, snooze_until INTEGER, done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
";

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch("PRAGMA foreign_keys = ON;")?;
    c.execute_batch(SCHEMA)?;
    Ok(c)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn kv_get(c: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    c.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()
}

pub fn kv_set(c: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn kv_delete(c: &Connection, key: &str) -> rusqlite::Result<()> {
    c.execute("DELETE FROM kv WHERE key = ?1", [key])?;
    Ok(())
}

#[derive(Serialize)]
pub struct Track {
    pub id: i64,
    pub name: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub distance_m: f64,
    pub points: i64,
}

pub fn track_row(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: r.get(0)?,
        name: r.get(1)?,
        started_at: r.get(2)?,
        ended_at: r.get(3)?,
        distance_m: r.get(4)?,
        points: r.get(5)?,
    })
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct TrackPoint {
    pub lat: f64,
    pub lon: f64,
    pub t: i64,
    pub speed: Option<f64>,
    pub accuracy: Option<f64>,
}

#[derive(Serialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub due: Option<String>,
    pub done: bool,
    pub priority: u8,
    pub created_at: i64,
}

pub fn task_row(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        due: r.get(3)?,
        done: r.get::<_, i64>(4)? != 0,
        priority: r.get::<_, i64>(5)? as u8,
        created_at: r.get(6)?,
    })
}

#[derive(Deserialize)]
pub struct TaskInput {
    pub id: Option<i64>,
    pub title: String,
    pub notes: String,
    pub due: Option<String>,
    pub done: bool,
    pub priority: u8,
}

/// How a reminder repeats. Validated on save; stored as JSON.
#[derive(Serialize, Deserialize, Clone)]
pub struct Repeat {
    /// none | daily | weekdays | weekly | monthly | yearly | interval
    pub freq: String,
    #[serde(default)]
    pub interval: Option<u32>,
    /// Weekdays for "weekly", 0 = Sunday.
    #[serde(default)]
    pub days: Option<Vec<u8>>,
    #[serde(default)]
    pub until_ms: Option<i64>,
    #[serde(default)]
    pub count: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ReminderPlace {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub radius_m: f64,
}

#[derive(Serialize)]
pub struct Reminder {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub start_ms: i64,
    pub all_day: bool,
    pub repeat: Repeat,
    /// Minutes before each occurrence at which to alert; 0 = at the time.
    pub alerts: Vec<i32>,
    pub place: Option<ReminderPlace>,
    pub task_id: Option<i64>,
    pub snooze_until: Option<i64>,
    pub done: bool,
}

#[derive(Deserialize)]
pub struct ReminderInput {
    pub id: Option<i64>,
    pub title: String,
    pub notes: String,
    pub start_ms: i64,
    pub all_day: bool,
    pub repeat: Repeat,
    pub alerts: Vec<i32>,
    pub place: Option<ReminderPlace>,
    pub task_id: Option<i64>,
    pub done: bool,
}

pub fn reminder_row(r: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    let repeat: String = r.get(5)?;
    let alerts: String = r.get(6)?;
    let place = match (r.get::<_, Option<String>>(7)?, r.get::<_, Option<f64>>(8)?, r.get::<_, Option<f64>>(9)?) {
        (Some(name), Some(lat), Some(lon)) => Some(ReminderPlace { name, lat, lon, radius_m: r.get::<_, Option<f64>>(10)?.unwrap_or(200.0) }),
        _ => None,
    };
    Ok(Reminder {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        start_ms: r.get(3)?,
        all_day: r.get::<_, i64>(4)? != 0,
        repeat: serde_json::from_str(&repeat).unwrap_or(Repeat { freq: "none".into(), interval: None, days: None, until_ms: None, count: None }),
        alerts: serde_json::from_str(&alerts).unwrap_or_else(|_| vec![0]),
        place,
        task_id: r.get(11)?,
        snooze_until: r.get(12)?,
        done: r.get::<_, i64>(13)? != 0,
    })
}

#[derive(Serialize)]
pub struct Place {
    pub id: i64,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub note: String,
}

#[derive(Deserialize)]
pub struct PlaceInput {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub note: String,
}
