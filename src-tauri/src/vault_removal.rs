//! Authenticated removal with a verified, recoverable encrypted backup.
use std::{fs, io::Write, path::Path};

pub fn remove(vault: &Path, hello: &Path, backups: &Path, password: &str) -> Result<String, String> {
    let regular = |p: &Path| fs::symlink_metadata(p).map(|m| m.file_type().is_file()).unwrap_or(false);
    if !regular(vault) || (hello.exists() && !regular(hello))
        || !fs::symlink_metadata(backups).map(|m| m.file_type().is_dir()).unwrap_or(false)
    { return Err("Caminho do cofre ou backup inválido.".into()); }
    let original = fs::read(vault).map_err(|_| "Não foi possível ler o cofre.")?;
    let raw = std::str::from_utf8(&original).map_err(|_| "Cofre inválido.")?;
    if !super::crypto_vault::verify_backup_payload(raw, password).ok {
        return Err("Senha mestra incorreta ou cofre inválido.".into());
    }
    // A private, uniquely-created directory prevents overwriting any backup.
    let archive = (0..100).find_map(|n| {
        let p = backups.join(format!("deleted-{}-{n}", super::now_epoch_millis()));
        fs::create_dir(&p).ok().map(|_| p)
    }).ok_or("Não foi possível preparar a cópia de recuperação.")?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&archive, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Não foi possível proteger a cópia de recuperação.")?;
    }
    let filename = vault.file_name().ok_or("Nome de cofre inválido.")?;
    let saved = archive.join(filename);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&saved).map_err(|_| "Não foi possível criar a cópia de recuperação.")?;
    file.write_all(&original).and_then(|_| file.sync_all())
        .map_err(|_| "Falha ao gravar a cópia; o cofre foi preservado.")?;
    if fs::read(&saved).ok().as_deref() != Some(original.as_slice())
        || fs::read(vault).ok().as_deref() != Some(original.as_slice())
    { return Err("Cofre alterado ou cópia inválida; exclusão cancelada.".into()); }
    // A surviving Hello record must never unlock a new vault of the same name.
    // Preserve it disabled alongside the backup instead of deleting it.
    if hello.exists() {
        fs::rename(hello, archive.join("windows-hello.disabled"))
            .map_err(|_| "Não foi possível desativar Windows Hello; cofre preservado.")?;
    }
    fs::remove_file(vault).map_err(|_| "Não foi possível excluir o cofre; a cópia foi preservada.")?;
    Ok(saved.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(label: &str) -> (std::path::PathBuf, Vec<u8>, String) {
        let dir = std::env::temp_dir().join(format!("kpassword-removal-{label}-{}-{}", std::process::id(), super::super::now_epoch_millis()));
        fs::create_dir_all(dir.join("backups")).unwrap();
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/vault-vectors.json")).unwrap();
        let bytes = serde_json::to_vec(&v["v2"]).unwrap();
        fs::write(dir.join("vault.kpvault"), &bytes).unwrap();
        (dir, bytes, v["password"].as_str().unwrap().into())
    }
    #[test] fn preserves_exact_ciphertext_and_disables_hello() {
        let (d, bytes, p) = fixture("success");
        fs::write(d.join("vault.kphello"), "fictitious hello").unwrap();
        let saved = remove(&d.join("vault.kpvault"), &d.join("vault.kphello"), &d.join("backups"), &p).unwrap();
        assert_eq!(fs::read(&saved).unwrap(), bytes);
        assert!(!d.join("vault.kpvault").exists()); assert!(!d.join("vault.kphello").exists());
        assert!(Path::new(&saved).parent().unwrap().join("windows-hello.disabled").exists());
        assert!(super::super::crypto_vault::verify_backup_payload(&fs::read_to_string(saved).unwrap(), &p).ok);
        fs::remove_dir_all(d).unwrap();
    }
    #[test] fn wrong_password_changes_nothing() {
        let (d, bytes, _) = fixture("wrong");
        assert!(remove(&d.join("vault.kpvault"), &d.join("vault.kphello"), &d.join("backups"), "wrong").is_err());
        assert_eq!(fs::read(d.join("vault.kpvault")).unwrap(), bytes);
        assert_eq!(fs::read_dir(d.join("backups")).unwrap().count(), 0);
        fs::remove_dir_all(d).unwrap();
    }
    #[test] fn backup_failure_preserves_vault() {
        let (d, bytes, p) = fixture("backup-failure");
        fs::write(d.join("blocked"), "not a directory").unwrap();
        assert!(remove(&d.join("vault.kpvault"), &d.join("vault.kphello"), &d.join("blocked"), &p).is_err());
        assert_eq!(fs::read(d.join("vault.kpvault")).unwrap(), bytes);
        fs::remove_dir_all(d).unwrap();
    }
    #[cfg(unix)]
    #[test] fn symlink_vault_is_rejected() {
        let (d, bytes, p) = fixture("symlink");
        std::os::unix::fs::symlink(d.join("vault.kpvault"), d.join("linked.kpvault")).unwrap();
        assert!(remove(&d.join("linked.kpvault"), &d.join("vault.kphello"), &d.join("backups"), &p).is_err());
        assert_eq!(fs::read(d.join("vault.kpvault")).unwrap(), bytes);
        fs::remove_dir_all(d).unwrap();
    }
}
