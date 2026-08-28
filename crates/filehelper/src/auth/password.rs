use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, argon2::password_hash::Error> {
    let parsed_hash = PasswordHash::new(hash)?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn derive_keys(password: &str, salt: &[u8]) -> ([u8; 32], [u8; 32]) {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"auth-salt:");
    hasher.update(salt);
    hasher.update(b":");
    hasher.update(password.as_bytes());
    let auth_key: [u8; 32] = hasher.finalize_reset().into();

    hasher.update(b"session-key:");
    hasher.update(salt);
    hasher.update(b":");
    hasher.update(password.as_bytes());
    let session_key: [u8; 32] = hasher.finalize().into();

    (auth_key, session_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let hash = hash_password("test123").unwrap();
        assert!(verify_password("test123", &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
    }
}
