"use strict";

/**
 * Selecao FAIL-CLOSED do par (instalador, assinatura) produzido pelo Tauri.
 *
 * Motivacao (auditoria da Fase 4, achado HIGH-2):
 *
 *   Os empacotadores anteriores faziam, quando a assinatura exata nao existia:
 *
 *       sig = arquivos.filter(f => f.endsWith(".sig"))
 *                     .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
 *
 *   Isto e falha ABERTA: adotava-se "o .sig mais recente da pasta", que pode
 *   pertencer a outro build. O resultado seria um latest.json com assinatura de
 *   um binario diferente -- o updater rejeitaria a instalacao em todo cliente e
 *   a release ficaria quebrada.
 *
 * Regras desta implementacao:
 *
 * - a assinatura DEVE se chamar exatamente `<instalador>.sig`;
 * - nunca se escolhe assinatura por data de modificacao;
 * - nunca se escolhe "a mais recente";
 * - ambiguidade (mais de um instalador) e ERRO, nao heuristica;
 * - a busca e apenas no diretorio informado, sem recursao -- um `.sig` em
 *   subpasta nunca pode ser adotado por engano.
 *
 * As funcoes abaixo sao puras: recebem uma lista de nomes e nao tocam no disco,
 * para permitir teste deterministico.
 */

/** Verdadeiro para o instalador NSIS gerado pelo Tauri. */
function isInstallerName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".exe") && lower.includes("setup");
}

/** Verdadeiro para qualquer arquivo de assinatura. */
function isSignatureName(name) {
  return name.toLowerCase().endsWith(".sig");
}

/**
 * Escolhe o par (instalador, assinatura) a partir dos NOMES presentes no
 * diretorio de bundle. Lanca em qualquer situacao ambigua ou incompleta.
 *
 * @param {string[]} names nomes de arquivo (sem caminho) do diretorio de bundle
 * @param {string} [dirLabel] caminho mostrado nas mensagens de erro
 * @returns {{ installer: string, signature: string }}
 */
function selectSignedInstaller(names, dirLabel = "(diretorio de bundle)") {
  const installers = names.filter(isInstallerName).sort();
  const signatures = names.filter(isSignatureName).sort();

  if (installers.length === 0) {
    throw new Error(
      `Nenhum instalador *setup*.exe encontrado em ${dirLabel}. ` +
        "Verifique se o build do Tauri foi concluido.",
    );
  }

  if (installers.length > 1) {
    // Falha fechada: escolher "o mais recente" foi exatamente o defeito HIGH-2.
    throw new Error(
      `Mais de um instalador encontrado em ${dirLabel}: ${installers.join(", ")}. ` +
        "Limpe o diretorio de bundle e refaca o build; a selecao nunca e feita por data.",
    );
  }

  const installer = installers[0];
  const expectedSignature = `${installer}.sig`;

  if (!names.includes(expectedSignature)) {
    const encontradas = signatures.length > 0 ? signatures.join(", ") : "nenhuma";
    throw new Error(
      `Assinatura esperada nao encontrada em ${dirLabel}: ${expectedSignature}. ` +
        `Assinaturas presentes: ${encontradas}. ` +
        "A assinatura NUNCA e escolhida por data ou aproximacao. " +
        "Verifique bundle.createUpdaterArtifacts=true e se a chave de assinatura foi configurada no ambiente.",
    );
  }

  return { installer, signature: expectedSignature };
}

/**
 * Verifica se um caminho de limpeza e seguro antes de remocao recursiva.
 *
 * Exige que o alvo esteja DENTRO da raiz do projeto e termine no sufixo
 * esperado. Qualquer coisa fora disso e recusada -- nada e apagado fora do
 * diretorio de build controlado.
 *
 * @param {string} projectRoot raiz do repositorio, absoluta e normalizada
 * @param {string} target caminho a remover, absoluto e normalizado
 * @param {string} expectedSuffix ex.: "src-tauri/target/release/bundle"
 */
function assertSafeCleanupPath(projectRoot, target, expectedSuffix) {
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = norm(projectRoot);
  const tgt = norm(target);
  const suffix = norm(expectedSuffix);

  if (root.length === 0 || tgt.length === 0) {
    throw new Error("Caminho de limpeza invalido: raiz ou alvo vazio.");
  }
  if (!tgt.startsWith(`${root}/`)) {
    throw new Error(`Recusado: alvo de limpeza fora da raiz do projeto.\n  raiz: ${root}\n  alvo: ${tgt}`);
  }
  if (!tgt.toLowerCase().endsWith(suffix.toLowerCase())) {
    throw new Error(`Recusado: alvo de limpeza nao termina em "${suffix}".\n  alvo: ${tgt}`);
  }
  // Profundidade minima evita algo como <root>/x
  if (tgt.slice(root.length + 1).split("/").length < 3) {
    throw new Error(`Recusado: alvo de limpeza raso demais.\n  alvo: ${tgt}`);
  }
  return true;
}

/** Lista canonica de assets que uma release deve conter. */
function releaseAssetNames(version) {
  const setupName = `KPassword-Setup-v${version}.exe`;
  return [setupName, `${setupName}.sig`, "latest.json", "SHA256SUMS.txt"];
}

module.exports = {
  isInstallerName,
  isSignatureName,
  selectSignedInstaller,
  assertSafeCleanupPath,
  releaseAssetNames,
};
