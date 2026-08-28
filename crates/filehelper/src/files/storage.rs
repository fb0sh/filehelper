
pub fn ensure_dirs(data_dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir.join("files"))?;
    std::fs::create_dir_all(data_dir.join("tmp"))?;
    std::fs::create_dir_all(data_dir.join("trash"))?;
    Ok(())
}