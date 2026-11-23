//! Offline routing and place search over compact packs built by `packer`.
//!
//! Everything here is plain Rust with no platform code, so it runs the same on
//! Windows and Android and can be benchmarked from a test.

pub mod format;
pub mod geo;
pub mod normalize;
pub mod route;
pub mod search;

pub use format::{Graph, Places};
pub use route::{Mode, Route, Step};
pub use search::Hit;
