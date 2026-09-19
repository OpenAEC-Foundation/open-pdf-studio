use anyhow::{Context, Result};
use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;

pub const SHM_SIZE: usize = 64 * 1024 * 1024; // 64 MB per worker
pub const HEADER_SIZE: usize = 32;
/// Largest RGBA payload (bytes) that fits in the SHM region after the header.
pub const PAYLOAD_CAP: usize = SHM_SIZE - HEADER_SIZE;

/// Check BEFORE rendering whether an RGBA bitmap of `width`x`height` px fits
/// in the SHM region, so an oversized render becomes a clean error instead of
/// a full rasterisation whose result is thrown away (pdfium-render's
/// `as_rgba_bytes` copies the buffer twice: ~2.5x the bitmap size in peak
/// memory, and a failed Rust allocation aborts the worker process).
/// Computed in u128 so absurd sizes cannot overflow (an overflow would panic
/// in a debug build). Non-positive sizes count as 0 bytes; PDFium rejects
/// those itself with a clean error.
pub fn ensure_bitmap_fits(width: i32, height: i32) -> Result<()> {
    let bytes = (width.max(0) as u128) * (height.max(0) as u128) * 4;
    if bytes > PAYLOAD_CAP as u128 {
        anyhow::bail!(
            "bitmap too large for SHM: {}x{} px = {} bytes > {} (cap)",
            width,
            height,
            bytes,
            PAYLOAD_CAP
        );
    }
    Ok(())
}

pub struct Shm {
    mmap: MmapMut,
}

impl Shm {
    /// Build the SHM backing-file path for a given namespace + slot. The
    /// namespace is the OWNING app process id, so multiple app instances
    /// (e.g. a detached document window running as its own process) never
    /// collide on the same `pdfium-worker-*.shm` file. Main and worker must
    /// compute the SAME path — they share this helper's format.
    pub fn path_for(ns: &str, slot: u32) -> String {
        format!(
            "{}/pdfium-worker-{}-{}.shm",
            std::env::temp_dir().to_string_lossy(),
            ns,
            slot
        )
    }

    /// Create (or replace) the SHM backing file under the OS temp dir.
    /// `ns` namespaces the file by owning-process id so concurrent app
    /// instances don't clobber each other's SHM.
    pub fn create(ns: &str, slot: u32) -> Result<Self> {
        let path = Self::path_for(ns, slot);
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .with_context(|| format!("open SHM file {}", path))?;
        file.set_len(SHM_SIZE as u64)
            .context("set SHM file length")?;
        let mmap = unsafe {
            MmapOptions::new()
                .len(SHM_SIZE)
                .map_mut(&file)
                .context("mmap SHM file")?
        };
        Ok(Self { mmap })
    }

    /// Write width + height to header, copy rgba into payload starting at
    /// offset HEADER_SIZE. Returns total payload bytes written.
    pub fn write_bitmap(&mut self, width: u32, height: u32, rgba: &[u8]) -> Result<u64> {
        if rgba.len() > PAYLOAD_CAP {
            anyhow::bail!(
                "bitmap too large for SHM: {} bytes > {} (cap)",
                rgba.len(),
                PAYLOAD_CAP
            );
        }
        self.mmap[0..4].copy_from_slice(&width.to_le_bytes());
        self.mmap[4..8].copy_from_slice(&height.to_le_bytes());
        // zero-fill the rest of the header (slots 8..32 reserved)
        for i in 8..HEADER_SIZE {
            self.mmap[i] = 0;
        }
        let end = HEADER_SIZE + rgba.len();
        self.mmap[HEADER_SIZE..end].copy_from_slice(rgba);
        self.mmap.flush_async().context("flush SHM after write")?;
        Ok(rgba.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_header() {
        let path = Shm::path_for("test", 999);
        let mut shm = Shm::create("test", 999).unwrap();
        let rgba = vec![0xAB; 1000];
        let bytes = shm.write_bitmap(123, 456, &rgba).unwrap();
        assert_eq!(bytes, 1000);
        // Re-read the file from disk and verify header
        let file_bytes = std::fs::read(path).unwrap();
        assert_eq!(
            u32::from_le_bytes([file_bytes[0], file_bytes[1], file_bytes[2], file_bytes[3]]),
            123
        );
        assert_eq!(
            u32::from_le_bytes([file_bytes[4], file_bytes[5], file_bytes[6], file_bytes[7]]),
            456
        );
        assert_eq!(file_bytes[HEADER_SIZE + 500], 0xAB);
    }

    #[test]
    fn write_too_large_returns_err() {
        let mut shm = Shm::create("test", 998).unwrap();
        let huge = vec![0u8; SHM_SIZE];
        let r = shm.write_bitmap(1, 1, &huge);
        assert!(r.is_err());
    }

    #[test]
    fn write_accepts_exactly_the_payload_cap() {
        let mut shm = Shm::create("test", 997).unwrap();
        assert!(shm.write_bitmap(1, 1, &vec![0u8; PAYLOAD_CAP]).is_ok());
        assert!(shm.write_bitmap(1, 1, &vec![0u8; PAYLOAD_CAP + 1]).is_err());
    }

    #[test]
    fn bitmap_check_matches_payload_cap() {
        // Largest square that fits: 4095 x 4095 x 4 <= 64 MiB - 32.
        assert!(ensure_bitmap_fits(4095, 4095).is_ok());
        // 4096 x 4095 x 4 = 67_092_480 <= 67_108_832: fits.
        assert!(ensure_bitmap_fits(4096, 4095).is_ok());
        // 4096 x 4096 x 4 = 67_108_864: exactly the header (32 bytes) too big.
        let err = ensure_bitmap_fits(4096, 4096).unwrap_err().to_string();
        assert!(err.contains("too large for SHM"), "{}", err);
        assert!(err.contains("67108864 bytes > 67108832"), "{}", err);
    }

    #[test]
    fn bitmap_check_rejects_a1_at_250_percent() {
        // A1 (2384 x 1684 pt) at scale 2.5 = 5960 x 4210 px = 100_366_400 bytes.
        let err = ensure_bitmap_fits(5960, 4210).unwrap_err().to_string();
        assert!(err.contains("100366400 bytes"), "{}", err);
    }

    #[test]
    fn bitmap_check_does_not_overflow_or_panic() {
        assert!(ensure_bitmap_fits(i32::MAX, i32::MAX).is_err());
        assert!(ensure_bitmap_fits(i32::MAX, 1).is_err());
        // Non-positive sizes are left to PDFium (clean error there).
        assert!(ensure_bitmap_fits(0, 0).is_ok());
        assert!(ensure_bitmap_fits(-5, i32::MAX).is_ok());
    }

    #[test]
    fn bitmap_check_agrees_with_write_bitmap() {
        // What the pre-check accepts, write_bitmap must accept too (and v.v.).
        let mut shm = Shm::create("test", 996).unwrap();
        for (w, h) in [(4096, 4095), (4096, 4096), (2048, 8191), (2048, 8193)] {
            let pre = ensure_bitmap_fits(w, h).is_ok();
            let rgba = vec![0u8; (w as usize) * (h as usize) * 4];
            let write = shm.write_bitmap(w as u32, h as u32, &rgba).is_ok();
            assert_eq!(pre, write, "{}x{}", w, h);
        }
    }
}
