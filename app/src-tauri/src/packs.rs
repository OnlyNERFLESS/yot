//! Data packs: `<name>.pmtiles` (map), `<name>.graph` (routing), `<name>.places`
//! (search), all in one folder. Graphs and places are loaded lazily and kept;
//! map tiles are read by byte range on demand so a 30 MB map costs no memory.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use geo_core::{Graph, Places};
use serde::Serialize;

pub struct Packs {
    pub dir: PathBuf,
    graphs: RwLock<HashMap<String, Arc<Graph>>>,
    places: RwLock<HashMap<String, Arc<Places>>>,
    files: Mutex<HashMap<String, File>>,
}

#[derive(Serialize)]
pub struct PackInfo {
    pub name: String,
    pub has_tiles: bool,
    pub has_graph: bool,
    pub has_places: bool,
    pub size_bytes: u64,
    pub bounds: Option<[f64; 4]>,
}

/// Pack names are file stems chosen by us or the user: keep them to a safe
/// alphabet so a name can never walk out of the packs folder.
pub fn valid_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(format!("invalid pack name: {name}")) }
}

impl Packs {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Packs {
            dir,
            graphs: RwLock::new(HashMap::new()),
            places: RwLock::new(HashMap::new()),
            files: Mutex::new(HashMap::new()),
        }
    }

    fn path(&self, name: &str, ext: &str) -> PathBuf {
        self.dir.join(format!("{name}.{ext}"))
    }

    pub fn names(&self) -> Vec<String> {
        let mut out: Vec<String> = std::fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let ext = p.extension()?.to_str()?;
                if matches!(ext, "pmtiles" | "graph" | "places" | "transit") {
                    p.file_stem()?.to_str().map(str::to_string)
                } else {
                    None
                }
            })
            .filter(|n| valid_name(n).is_ok())
            .collect();
        out.sort();
        out.dedup();
        out
    }

    pub fn info(&self, name: &str) -> PackInfo {
        let size = |ext: &str| std::fs::metadata(self.path(name, ext)).map(|m| m.len()).ok();
        let (t, g, p) = (size("pmtiles"), size("graph"), size("places"));
        PackInfo {
            name: name.to_string(),
            has_tiles: t.is_some(),
            has_graph: g.is_some(),
            has_places: p.is_some(),
            size_bytes: t.unwrap_or(0) + g.unwrap_or(0) + p.unwrap_or(0),
            bounds: self.graph(name).ok().map(|g| g.bounds()),
        }
    }

    pub fn graph(&self, name: &str) -> Result<Arc<Graph>, String> {
        if let Some(g) = self.graphs.read().unwrap().get(name) {
            return Ok(g.clone());
        }
        let bytes = std::fs::read(self.path(name, "graph")).map_err(|e| format!("{name}.graph: {e}"))?;
        let g = Arc::new(Graph::from_bytes(&bytes)?);
        self.graphs.write().unwrap().insert(name.to_string(), g.clone());
        Ok(g)
    }

    /// The transit network JSON (metro lines and stations), when the pack has one.
    pub fn transit(&self, name: &str) -> Result<String, String> {
        valid_name(name)?;
        std::fs::read_to_string(self.path(name, "transit")).map_err(|e| format!("{name}.transit: {e}"))
    }

    pub fn places(&self, name: &str) -> Result<Arc<Places>, String> {
        if let Some(p) = self.places.read().unwrap().get(name) {
            return Ok(p.clone());
        }
        let bytes = std::fs::read(self.path(name, "places")).map_err(|e| format!("{name}.places: {e}"))?;
        let p = Arc::new(Places::from_bytes(&bytes)?);
        self.places.write().unwrap().insert(name.to_string(), p.clone());
        Ok(p)
    }

    /// Read `length` bytes at `offset` of `<name>.pmtiles`.
    pub fn read_range(&self, name: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        valid_name(name)?;
        let mut files = self.files.lock().unwrap();
        if !files.contains_key(name) {
            let f = File::open(self.path(name, "pmtiles")).map_err(|e| format!("{name}.pmtiles: {e}"))?;
            files.insert(name.to_string(), f);
        }
        let f = files.get_mut(name).unwrap();
        let len = f.metadata().map_err(|e| e.to_string())?.len();
        let end = (offset + length as u64).min(len);
        let mut buf = vec![0u8; end.saturating_sub(offset) as usize];
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        f.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    }

    /// Append a chunk to `<file>.part`; `done` renames it into place.
    pub fn write_chunk(&self, file: &str, offset: u64, data: &[u8], done: bool) -> Result<(), String> {
        let (stem, ext) = file.rsplit_once('.').ok_or("file needs an extension")?;
        valid_name(stem)?;
        if !matches!(ext, "pmtiles" | "graph" | "places" | "transit") {
            return Err(format!("unsupported pack file: {file}"));
        }
        let part = self.dir.join(format!("{file}.part"));
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(offset == 0)
            .open(&part)
            .map_err(|e| e.to_string())?;
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut f, data).map_err(|e| e.to_string())?;
        if done {
            drop(f);
            self.forget(stem);
            std::fs::rename(&part, self.dir.join(file)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn forget(&self, name: &str) {
        self.graphs.write().unwrap().remove(name);
        self.places.write().unwrap().remove(name);
        self.files.lock().unwrap().remove(name);
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        valid_name(name)?;
        self.forget(name);
        for ext in ["pmtiles", "graph", "places", "transit"] {
            let p = self.path(name, ext);
            if p.exists() {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// The pack whose road network covers a point, if any.
    pub fn covering(&self, lat: f64, lon: f64) -> Option<String> {
        self.names().into_iter().find(|n| {
            self.graph(n)
                .map(|g| {
                    let [w, s, e, nn] = g.bounds();
                    lon >= w && lon <= e && lat >= s && lat <= nn
                })
                .unwrap_or(false)
        })
    }
}

