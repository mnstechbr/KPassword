//! Escrita duravel e privada dos arquivos do cofre e politica de retencao.
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

/// Serializa gravar, restaurar e excluir cofres. Os comandos rodam fora da
/// thread principal e um rename concorrente poderia desfazer outra gravacao.
pub static STORAGE_LOCK: Mutex<()> = Mutex::new(());

/// Grava `bytes` em `path` sem nunca deixar um arquivo truncado no lugar:
/// temporario exclusivo (0600 no Unix), fsync, rename e fsync da pasta.
pub fn write_atomic_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("kpassword");
    let temp_path = path.with_file_name(format!(".{file_name}.{}.{nanos}.tmp", std::process::id()));

    let mut options = fs::OpenOptions::new();
    // create_new tambem recusa um symlink plantado no caminho temporario.
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options.open(&temp_path).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    });
    let result = result.and_then(|_| fs::rename(&temp_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
        return result;
    }
    sync_parent_dir(path);
    Ok(())
}

#[cfg(unix)]
fn sync_parent_dir(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) {}

/// Cria a pasta com acesso so do usuario (0700 no Unix) e corrige pastas
/// antigas criadas com as permissoes padrao.
pub fn create_private_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Migra cofres e backups gravados antes desta versao para 0600.
#[cfg(unix)]
pub fn harden_existing_files(dir: &Path, depth: u8) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() && depth > 0 {
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o700));
            harden_existing_files(&path, depth - 1);
        } else if kind.is_file() {
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
    }
}

#[cfg(not(unix))]
pub fn harden_existing_files(_dir: &Path, _depth: u8) {}

/// Backups automaticos que a retencao remove. Mantem:
/// - os 10 mais recentes;
/// - o mais recente de cada um dos ultimos 14 dias;
/// - o mais recente de cada uma das ultimas 8 semanas;
/// - o mais recente de cada um dos ultimos 12 meses (30 dias).
///
/// `backups` sao pares (nome, segundos desde a epoca).
pub fn backups_to_prune(backups: &[(String, u64)], now_seconds: u64) -> Vec<String> {
    const DAY: u64 = 86_400;
    let mut sorted: Vec<&(String, u64)> = backups.iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));

    let today = now_seconds / DAY;
    let mut keep: HashSet<&str> = HashSet::new();
    let mut days = HashSet::new();
    let mut weeks = HashSet::new();
    let mut months = HashSet::new();

    for (index, (name, modified)) in sorted.iter().enumerate() {
        let day = modified / DAY;
        let age_days = today.saturating_sub(day);
        let newest_of_day = age_days < 14 && days.insert(day);
        let newest_of_week = age_days < 8 * 7 && weeks.insert(day / 7);
        let newest_of_month = age_days < 12 * 30 && months.insert(day / 30);
        if index < 10 || newest_of_day || newest_of_week || newest_of_month {
            keep.insert(name.as_str());
        }
    }

    sorted
        .iter()
        .filter(|(name, _)| !keep.contains(name.as_str()))
        .map(|(name, _)| name.clone())
        .collect()
}

/// Backup automatico: `<cofre>-<millis>.kpvault`. Copias com rotulo
/// (pre-restore, pre-argon2, ...) sao redes de seguranca e nunca sao podadas.
pub fn is_automatic_backup(file_name: &str, safe_vault_name: &str) -> bool {
    file_name
        .strip_prefix(safe_vault_name)
        .and_then(|rest| rest.strip_prefix('-'))
        .and_then(|rest| rest.strip_suffix(".kpvault"))
        .is_some_and(|millis| {
            !millis.is_empty() && millis.bytes().all(|byte| byte.is_ascii_digit())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kpassword-storage-io-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("vault.kpvault");
        fs::write(&path, "old").unwrap();
        write_atomic_private(&path, b"new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_and_private_dir_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("private").join("data");
        create_private_dir(&dir).unwrap();
        let path = dir.join("vault.kpvault");
        write_atomic_private(&path, b"x").unwrap();
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn retention_keeps_recent_and_one_per_period() {
        const DAY: u64 = 86_400;
        let now = 1_000 * DAY;
        // Quatro backups por dia nos ultimos 60 dias.
        let backups: Vec<(String, u64)> = (0..240u64)
            .map(|i| (format!("vault-{i}.kpvault"), now - i * DAY / 4))
            .collect();
        let pruned = backups_to_prune(&backups, now);
        let kept = backups.len() - pruned.len();
        // 10 recentes + 1 por dia (14 dias) + semanas e meses restantes.
        assert!((20..40).contains(&kept), "kept {kept}");
        assert!(!pruned.contains(&"vault-0.kpvault".to_string()));
        assert!(!pruned.contains(&"vault-9.kpvault".to_string()));
    }

    #[test]
    fn retention_never_prunes_small_sets() {
        let backups: Vec<(String, u64)> =
            (0..10u64).map(|i| (format!("v-{i}.kpvault"), i)).collect();
        assert!(backups_to_prune(&backups, 10_000_000).is_empty());
    }

    #[test]
    fn only_numbered_backups_are_automatic() {
        assert!(is_automatic_backup("vault-1712345678901.kpvault", "vault"));
        assert!(is_automatic_backup("work-1.kpvault", "work"));
        assert!(!is_automatic_backup(
            "vault-pre-restore-1712345678901.kpvault",
            "vault"
        ));
        assert!(!is_automatic_backup("vault-pre-argon2-1.kpvault", "vault"));
        assert!(!is_automatic_backup("other-1.kpvault", "vault"));
        assert!(!is_automatic_backup("vault-.kpvault", "vault"));
    }
}
