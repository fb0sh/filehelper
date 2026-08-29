use std::path::{Path, PathBuf};

pub fn ensure_dirs(data_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir.join("files"))?;
    std::fs::create_dir_all(data_dir.join("tmp"))?;
    std::fs::create_dir_all(data_dir.join("trash"))?;
    Ok(())
}

// Atomically move a stored file into trash (same-filesystem rename).
// The caller may unlink it from trash right away; if that fails the
// startup GC sweeps trash anyway.
pub async fn move_to_trash(
    files_dir: &Path,
    trash_dir: &Path,
    storage_name: &str,
) -> std::io::Result<PathBuf> {
    let dest = trash_dir.join(storage_name);
    tokio::fs::rename(files_dir.join(storage_name), &dest).await?;
    Ok(dest)
}
