# Notas de Segurança

## Modelo de segurança

O KPassword é local/offline. O cofre fica salvo no computador do usuário e é protegido pela senha mestra.

## Senha mestra

A senha mestra não possui recuperação.

Se a senha mestra for perdida, o cofre e os backups criptografados não poderão ser descriptografados.

## PIN/biometria do computador

O desbloqueio com PIN/biometria é opcional e serve como conveniência local.

A senha mestra continua sendo o fallback principal.

## Backups

Backups são criptografados e continuam exigindo a senha mestra usada quando foram criados.

## Exportação CSV

A exportação CSV aberta gera dados em texto puro. Deve exigir confirmação da senha mestra e deve ser usada com cuidado.

## Clipboard

Campos copiados para a área de transferência devem ser limpos após o tempo configurado.

O app não controla o histórico do Windows (`Win + V`).

## Updater

A chave privada do updater nunca deve ser adicionada ao projeto ou ao GitHub.

Arquivos permitidos em release:

- `.exe`
- `.exe.sig`
- `latest.json`

Arquivos proibidos:

- `*.key`
- `*.key.pub`
- qualquer chave privada local

## Recomendações de QA de segurança

- Testar senha errada.
- Testar troca de senha mestra.
- Testar backup com senha errada.
- Testar PIN/biometria cancelado.
- Testar bloqueio por inatividade.
- Testar clipboard após copiar senha.
