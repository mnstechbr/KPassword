# Assinatura local Windows/Fedora

A chave antiga foi perdida. A nova chave pública está no `tauri.conf.json` da
versão 1.5.0; as instalações Windows antigas exigem atualização manual uma vez.
Não apague cofres para atualizar. Faça backup criptografado antes de instalar.

Chave privada: `~/.local/share/kpassword-signing/kpassword-v2.key`, criptografada
com senha escolhida pelo mantenedor. Diretório 0700, arquivo 0600. Faça backup
da chave fora do computador e guarde a senha separadamente. Perder qualquer um
impede novas assinaturas. Permissões locais não isolam programas da mesma conta;
a senha não é persistida por estes scripts.

Os scripts não enviam chave nem senha ao GitHub, nem fazem alterações Git.
GitHub Actions compila instaladores sem segredo de assinatura. A ferramenta
Rust local recebe a senha por stdin, assina e verifica os arquivos. A senha é
digitada em um diálogo KDialog e utilizada somente no processo de publicação.

```
python3 tools/sign-release.py generate
python3 tools/publish-release.py --run RUN_ID --sha MAIN_SHA --version 1.5.0 --publish
```

`generate` recusa sobrescrever uma chave existente. `publish-release` exige CI
completo, commit correspondente a main e versões corretas; baixa somente os
artefatos Windows/Fedora dessa execução. A publicação usa uma lista explícita de
assets: `.exe`, `.exe.sig`, `.rpm`, `.rpm.sig`, `latest.json`, `SHA256SUMS.txt`.
Sem `--publish`, prepara os arquivos e não publica. A pasta de uma preparação
existente não é sobrescrita. A assinatura Minisign do RPM é externa; não implica
assinatura GPG/RPM nem configuração de um repositório DNF.

No Fedora o botão de atualização abre GitHub Releases. Depois de baixar o RPM,
o usuário autoriza a instalação pelo DNF. Atualização automática via DNF requer
um repositório assinado separado, ainda não implementado.
