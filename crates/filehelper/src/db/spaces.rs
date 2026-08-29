#![allow(dead_code)]
use crate::error::AppError;
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;

#[derive(Debug, sqlx::FromRow)]
pub struct SpaceRow {
    pub id: String,
    pub auth_verifier: Vec<u8>,
}

/// Create a new space. Returns SPACE_EXISTS on a duplicate id.
pub async fn create_space(
    pool: &SqlitePool,
    space_id: &str,
    auth_verifier: &[u8; 32],
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO spaces (id, auth_verifier, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(space_id)
    .bind(auth_verifier.as_slice())
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => AppError::SpaceExists,
        other => other.into(),
    })?;
    Ok(())
}

/// Verify a client's derived auth key against the stored verifier.
/// Returns Ok(true) if the space exists and the key matches, Ok(false) if
/// the space exists but the key is wrong, and SpaceNotFound otherwise.
pub async fn verify_space(
    pool: &SqlitePool,
    space_id: &str,
    auth_key_sha256: &[u8; 32],
) -> Result<(), AppError> {
    let row = sqlx::query_as::<_, SpaceRow>("SELECT id, auth_verifier FROM spaces WHERE id = ?1")
        .bind(space_id)
        .fetch_optional(pool)
        .await?;

    let Some(row) = row else {
        return Err(AppError::SpaceNotFound);
    };

    // Constant-time comparison of the SHA-256 digests.
    let matches = auth_key_sha256
        .as_slice()
        .ct_eq(row.auth_verifier.as_slice());
    if bool::from(matches) {
        // Touch updated_at — cheap liveness marker, not required for auth.
        let _ = sqlx::query("UPDATE spaces SET updated_at_ms = ?1 WHERE id = ?2")
            .bind(chrono::Utc::now().timestamp_millis())
            .bind(space_id)
            .execute(pool)
            .await;
        Ok(())
    } else {
        Err(AppError::AuthFailed)
    }
}

pub async fn space_exists(pool: &SqlitePool, space_id: &str) -> Result<bool, AppError> {
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM spaces WHERE id = ?1")
        .bind(space_id)
        .fetch_one(pool)
        .await?;
    Ok(count > 0)
}
