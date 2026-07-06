# Criptografia do KPassword

Este documento descreve o desenho criptográfico do cofre local do KPassword.

## Visão geral

O KPassword usa criptografia autenticada para proteger o cofre em repouso. A senha mestra deriva uma chave local, que é usada para criptografar e autenticar o payload do cofre.

A implementação criptográfica principal do cofre atual fica no backend Rust via Tauri, em `src-tauri/src/crypto_vault.rs`.

## cryptoVersion 1, legado

Cofres antigos usam:

- PBKDF2-SHA-256;
- salt individual;
- AES-GCM;
- IV novo por salvamento.

O suporte de leitura foi mantido para compatibilidade e restauração de backups antigos.

## cryptoVersion 2

Cofres novos usam:

- Argon2id;
- AES-256-GCM;
- nonce novo por salvamento;
- metadados autenticados via AAD;
- parâmetros do KDF gravados no arquivo do cofre.

Parâmetros iniciais do Argon2id:

- memoryKiB: 65536;
- timeCost: 3;
- parallelism: 1;
- outputLength: 32 bytes;
- salt aleatório de 32 bytes.

## AAD

O AAD autentica metadados críticos, incluindo versão criptográfica, algoritmo KDF, parâmetros principais e algoritmo de cifra. Se metadados autenticados forem alterados, a abertura do cofre falha.

## Nonce/IV

Cada salvamento gera novo nonce/IV. Reutilização de nonce com a mesma chave deve ser evitada, pois compromete modos AEAD como GCM.

## Migração

Ao abrir um cofre legado com sucesso, o KPassword cria um backup pré-migração com identificação `pre-argon2` e regrava o cofre principal como `cryptoVersion 2`.

Backups antigos continuam abríveis pelo fluxo legado, desde que o usuário tenha a senha mestra usada naquele backup.

## Zeroização best-effort

O backend Rust usa zeroização em buffers sensíveis quando possível. No frontend JavaScript, strings não têm zeroização garantida pelo runtime, então o app reduz retenção de segredos e limpa buffers mutáveis quando aplicável.

## Limites conhecidos

- A senha mestra não é recuperável.
- Malware local pode capturar dados durante o uso.
- Clipboard é uma área compartilhada do sistema.
- Windows Hello é conveniência local e não substitui a senha mestra como raiz de confiança do cofre.
