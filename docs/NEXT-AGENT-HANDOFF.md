# Cybermanju OS — handoff para próximos Agents

Estado de referência: branch `main`, checkout baseado em `d5dd0c4`; alterações desta rodada ainda não commitadas. Não assumir que o worktree compartilhado esteja limpo nem rodar `git add -A`. Na última validação local, `npm run typecheck`, `npm run build` e 39 testes direcionados em sete arquivos passaram. `shell-shortcuts.test.ts` ainda não roda sem o pacote local `cybermanju-os-wasm`.

## Prioridade imediata

1. Revisar `git status` e separar mudanças por frente antes de editar; o shell, Mandarin, Technosutra e Ren’Py compartilharam arquivos.
2. Rodar `npm run typecheck` e os testes direcionados da própria frente depois de cada edição. A suíte ampla já travou em `home-screen-create.test.ts`; os resultados parciais não são aprovação.
3. Não marcar nenhum app como pronto sem smoke test no ambiente em que será usado. Não fazer push de builds gerados gigantescos.

## OS principal

- Melhorias em `src/composables/useKeyboardShortcuts.ts`, `useShortcuts.ts`, `useSwipe.ts`, `useTouchConfig.ts`, `src/components/FileManager.vue`, `src/components/ui/UiModal.vue`, `src/components/LandingPage.vue` e `AppDrawer.vue`.
- Testes relacionados: `tests/frontend/shell-shortcuts.test.ts`, `tests/frontend/touch-config-session.test.ts`.
- Delete/Escape e leitura de gestos foram corrigidos; o typecheck passou na última execução local. `shell-shortcuts.test.ts` ainda falha antes das assertions se `cybermanju-os-wasm` não estiver construído (`crates/os-wasm/pkg`/alias Vite). Pendências de QA: primeiro carregamento, menu/teclado, breakpoint móvel e acessibilidade/contraste visual.

## Instrutor de mandarim

- Entrada do app: `src/components/MandarinInstructor.vue`; dados e regras: `src/utils/mandarinCourse.ts`; corpus: `src/data/mandarinLessons.json` e `src/data/mandarinCorpus.json`; auditoria: `docs/mandarin-course-audit.md`.
- Os PDFs originais são as duas fontes enviadas pelo dono. Ele confirmou autorização de reprodução dessas duas cópias, não de outras obras. Citar páginas/fontes e não transportar essa permissão para o material do STEM Array.
- A sequência atual tem 29 unidades. O inventário contempla 267 páginas físicas. Última métrica rastreável: 198/234 páginas substantivas com síntese específica; as outras 36 não contam como convertidas (21 só por faixa e 15 com OCR incerto). Uma rodada posterior editou conteúdo, mas a cobertura final e a revisão da tabela climática ainda não foram validadas. Não anunciar “100%” até comparar cada página substantiva com conteúdo estruturado e confiança verificável.
- Foi solicitado 2/3 de acerto para concluir a lição, três opções distintas e gabaritos distribuídos. Na última auditoria havia inconsistência com UI, distratores e tipo `sourceRefs`; revalidar contra o estado atual.
- OCR/revisão visual são imperfeitos; marcar cada página duvidosa em vez de completar por inferência. Revisão humana de mandarim e acessibilidade do canvas ainda são úteis.
- Testes: `tests/frontend/mandarin-course.test.ts`, `tests/frontend/mandarin-voice-provider-integration.test.ts`. Executar também `npm run typecheck` e `npm run build`.

## Voz / Orb Chatter

- Fluxo do app: `src/composables/useVoiceCall.ts`; catálogo: `src/integrations/orb-chatter/providers.ts`; testes em `tests/frontend/orb-chatter-providers.test.ts` e `mandarin-voice-provider-integration.test.ts`; decisão técnica em `docs/ORB-CHATTER-VOICE-PORT.md`.
- O runtime atual do Agent com voz do browser/Android funciona por turnos. Gemini Live, ElevenLabs e Voice Studio/Colab são adaptadores planejados, não backends conectados.
- O ZIP de referência está em `/home/ubuntu/upload/fdeb3b3e181a621589ca22b5_remix-chatterbots.zip` nesta máquina; licença Apache-2.0, preservar avisos. Seu relay original é Gemini-only. Não copiar/publicar a rota `/api/video-download` sem correção e revisão: aceita URL arbitrária e pode encaminhar uma chave. Nunca enviar chave permanente ao browser.

## Integração Technosutra

- Painel remoto: `src/components/TechnosutraPanel.vue`; catálogo de rotas: `src/data/technosutra.ts`; testes: `tests/frontend/technosutra-integration.test.ts`.
- O upstream é carregado por iframe no domínio oficial; conteúdo pesado não deve ser copiado por padrão. O teste local de rotas/iframe passou. O repositório público upstream tem chaves/certificados de desenvolvimento expostos, certificados vencidos e divergência de licença; não editar nem rotacionar nada no upstream sem autorização expressa.
- O dono pediu priorizar somente correções de alto impacto e pular ajustes CSP/Caddy/Tauri neste ciclo. Essas mudanças locais ficam fora do push atual. Câmera/XR na aba AR pode não funcionar em todo host até o CSP/Permissions-Policy ser tratado.

## Ren’Py / Technosutra VN

- Ponte Studio: `src/components/TechnosutraStudio.vue` e `src/integrations/renpy-technosutra/model.ts`; janela e tipo em `src/composables/useWindowManager.ts` / `src/types/index.ts`.
- Fonte Ren’Py e manifesto estão em `integrations/renpy-technosutra/`. Há 56 capítulos e 54 PNGs frontais provisórios `model_NN.png`, 600×800 com alfa, mapeados aos modelos/capítulos existentes; os GLBs 43 e 52 não existem. O dono aprovou usar os renders brutos como provisórios; não tentar contornar bloqueios de geração das variações de boca/postura.
- Em 13h47 havia divergências no `script.rpy`, páginas-fonte, IDs/manifesto e lint; Ren’Py estava reconciliando e refazendo build/smoke test. Verificar de novo em vez de assumir concluído.
- `public/technosutra-vn/` inclui assets gerados e um `game.zip` de cerca de 719 MB; `integrations/renpy-technosutra/build/` tem mais de 13 GB, com zips de até 8,9 GB. A checagem final confirmou que o `build/output/game.zip` atual é inválido e o public `game.zip` está ausente; o ZIP provisório antigo, de 2,85 GB, é íntegro mas não smoke-testado no painel. Não adicionar esses artefatos ao GitHub. Guardar somente fonte/documentação pequena e um placeholder honesto enquanto a build compacta/licenciada e executável não estiver pronta.
- Neste push, manter `game/script.rpy`, `chapters.json`, imagens e builds derivados fora do remoto até confirmar direito de distribuição pública. Eles ainda existem no worktree compartilhado para a próxima frente; não presumir que acompanham um clone limpo.
- Não usar screenshots derivados do Google Street View. A VN pode manter pontos/coordenadas e abrir Maps; usar fotos próprias/licenciadas ou arte original.
- A autorização relatada pelo dono para adaptar *The Stem Array* é separada da autorização dos PDFs de mandarim. Não publicar/distribuir sem verificar o alcance de distribuição. O Ren’Py oficial exige build e teste real do runtime web; uma pasta WASM ou lint isolados não provam que o jogo abre.

## Segurança e publicação

- Não publicar o servidor original do Orb Chatter até a rota com SSRF/chave ser revista.
- Não mudar upstream Technosutra nem rodar rotação/remoção de certificados como ação implícita.
- Conferir `.gitignore`, tamanho individual dos arquivos e tamanho total antes de stage. O GitHub rejeita arquivos individuais gigantes; nunca usar `git add -A` neste worktree.
- Priorizar patches pequenos, testes reproduzíveis e mensagens de status distinguindo teste focado, typecheck, build e smoke test real.
