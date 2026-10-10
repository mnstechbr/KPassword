//! Local signing only. Passwords arrive through stdin, never command arguments.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign::{KeyPair, PublicKeyBox, SecretKeyBox, SignatureBox};
use std::{fs, io::{self, BufReader, Read, Write}, path::Path};
use zeroize::Zeroizing;

fn decode(s: &str) -> Result<String, Box<dyn std::error::Error>> {
    Ok(String::from_utf8(STANDARD.decode(s.trim())?)?)
}
fn write_new(path: &Path, text: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}
fn password() -> io::Result<Zeroizing<String>> {
    let mut value = Zeroizing::new(String::new());
    io::stdin().take(4097).read_to_string(&mut value)?;
    if value.len() < 12 || value.len() > 4096 || value.contains(['\0', '\n', '\r']) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Senha de assinatura inválida."));
    }
    Ok(value)
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("generate") if args.len() == 3 => {
            let path = Path::new(&args[2]);
            let pub_path = format!("{}.pub", path.display());
            if path.exists() || Path::new(&pub_path).exists() { return Err("A chave já existe; nada foi sobrescrito.".into()); }
            let pass = password()?;
            let pair = KeyPair::generate_encrypted_keypair(Some(pass.to_string()))?;
            let private = Zeroizing::new(STANDARD.encode(pair.sk.to_box(None)?.to_string()));
            write_new(path, &private)?;
            write_new(Path::new(&pub_path), &STANDARD.encode(pair.pk.to_box()?.to_string()))?;
        }
        Some("sign") if args.len() == 4 => {
            let pass = password()?;
            let private = Zeroizing::new(fs::read_to_string(&args[2])?);
            let decoded = Zeroizing::new(decode(&private)?);
            let key = SecretKeyBox::from_string(&decoded)?.into_secret_key(Some(pass.to_string()))?;
            let file = BufReader::new(fs::File::open(&args[3])?);
            let signature = minisign::sign(None, &key, file, None, Some("KPassword local release signature"))?;
            write_new(Path::new(&format!("{}.sig", args[3])), &STANDARD.encode(signature.to_string()))?;
        }
        Some("verify") if args.len() == 5 => {
            let key = PublicKeyBox::from_string(&decode(&fs::read_to_string(&args[2])?)?)?.into_public_key()?;
            let signature = SignatureBox::from_string(&decode(&fs::read_to_string(&args[4])?)?)?;
            minisign::verify(&key, &signature, BufReader::new(fs::File::open(&args[3])?), true, false, false)?;
        }
        _ => return Err("Uso: generate CHAVE | sign CHAVE ARQUIVO | verify PUBLICA ARQUIVO ASSINATURA".into()),
    }
    println!("OK");
    Ok(())
}
fn main() {
    if run().is_err() {
        // Do not echo crypto errors or input values.
        eprintln!("Assinatura recusada: verifique os arquivos e a senha localmente.");
        std::process::exit(1);
    }
}
