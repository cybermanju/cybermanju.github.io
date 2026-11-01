# Cybermanju OS — handoff para próximos Agents

Estado de referência: branch `main`, `HEAD` e `origin/main` em `8a618875`; worktree compartilhado ainda contém mudanças locais não commitadas. Não assumir que está limpo nem rodar `git add -A`. Validação mais recente: typecheck, build Vite e 63 testes focados em 11 arquivos passaram; o build reporta warnings de chunk/importações. A suíte ampla permanece inconclusiva e não substitui os testes focados.

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
- A sequência tem 29 unidades e o inventário 267 páginas físicas. O corpus contém síntese página-específica para as 232 páginas substantivas (100% de cobertura temática, não transcrição literal); as pp. 9 e 21 do Shangrila são divisórias. Há 34 páginas com OCR incerto e quatro detalhes finos de baixa confiança: Shangrila PDF p. 23 e livro do aluno pp. 49, 97 e 141. `fullCourseCoverageClaim` e `completeTextTranscription` devem continuar falsos.
- A UI agora expõe os 232 resumos num catálogo pesquisável com navegação anterior/próxima; 93 já apareciam nas lições e os outros 139 ficaram alcançáveis pelo catálogo. Um resumo selecionado leva localização e ressalvas de OCR/confiança ao Tutor.
- O texto é o modo padrão e completo, sem captura de microfone. Voz é opt-in; o OrbNavigator da Home Android é reaproveitado como avatar ligado aos estados ouvir/pensar/falar, respeitando movimento reduzido. Gemini/ElevenLabs seguem inativos sem broker; VoiceStudio/Colab não foi ligado a um serviço real.
- A regra de aprovação é 2/3; respostas/explicações não vão ao tutor antes de atingir o limiar salvo. As questões têm opções distintas e gabaritos balanceados. OCR/revisão visual continuam imperfeitos; marcar incertezas em vez de completar por inferência. Revisão humana de mandarim e acessibilidade alternativa ao canvas ainda são úteis.
- Validação mais recente: 63 testes focados em 11 arquivos, `npm run typecheck` e `npm run build` passaram. O build tem avisos de importação/chunks grandes; repetir validação após novas edições.
- Segurança pedagógica: corrigido. O prompt inicial do tutor recebe perguntas sem gabarito/explicações; as soluções só são liberadas quando a melhor nota salva atinge 2/3. Há teste para impedir vazamento antes do limiar.

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
- O painel/app chama-se **The Stem Array** e carrega localmente o runtime Ren’Py/WASM de `public/technosutra-vn/`; não usar dashboard externo. O bundle enxuto validado tem 138 arquivos e 122.647.359 bytes. `game.zip` tem 5.779.947 bytes, SHA-256 `a56d6aa05a6e224a38d307f8ad495573329cea259a83ce62d976f64186e0ce46`; `unzip -t` passou e nenhum arquivo excede 50 MB. `index.html.symbols` é referenciado pelo `pwa_catalog.json`, então não o excluir na otimização.
- Fonte Ren’Py e manifesto estão em `integrations/renpy-technosutra/`. Há 56 capítulos e 54 PNGs frontais provisórios, estáticos, 600×800 com alfa, mapeados aos modelos/capítulos existentes; os GLBs 43 e 52 não existem. O dono autorizou distribuição pública da adaptação e, separadamente, dos 54 renders; manter avisos de proveniência. Não tentar contornar bloqueios de geração de variações de boca/postura.
- O Ren’Py Web CI passou no commit `8a6188756021bf87ed7ba74df58efcc4dfb7fa99` ([execução](https://github.com/cybermanju/cybermanju.github.io/actions/runs/41333995385)). O runtime/canvas e 111 assets progressivos passaram smoke; isso não prova playthrough completo ou interação dentro do OS. Falta validar menu/diálogo/choices/quizzes/retorno no shell autenticado; não contornar onboarding/login.
- O diretório local antigo `integrations/renpy-technosutra/build/` pode conter builds inválidos/giantes, com zips de até 8,9 GB. Não adicioná-lo ao Git; publicar apenas o bundle compacto revisado em `public/technosutra-vn/` e as fontes/documentação selecionadas.
- Não usar screenshots derivados do Google Street View. A VN pode manter pontos/coordenadas e abrir Maps; usar fotos próprias/licenciadas ou arte original.
- O dono confirmou diretamente os direitos de distribuição pública para a adaptação de *The Stem Array* e seus derivados, separadamente da autorização dos PDFs de mandarim. O status foi registrado em `integrations/renpy-technosutra/chapters.json`.
- A licença upstream do Technosutra continua contraditória; usar somente os 54 renders específicos cobertos pela autorização separada do dono, sem incluir GLBs ou materiais upstream adicionais.
- Estado cross-device: o Studio grava no `localStorage` deste dispositivo e não sincroniza fontes, waypoints nem progresso. Um próximo Agent deve propor armazenamento/sincronização autenticados e sincronização de saves Ren’Py entre desktop, web e Android, com proteção de conflitos/offline, sem subir conteúdo privado por padrão.

## Segurança e publicação

- Não publicar o servidor original do Orb Chatter até a rota com SSRF/chave ser revista.
- Não mudar upstream Technosutra nem rodar rotação/remoção de certificados como ação implícita.
- Conferir `.gitignore`, tamanho individual dos arquivos e tamanho total antes de stage. O GitHub rejeita arquivos individuais gigantes; nunca usar `git add -A` neste worktree.
- Priorizar patches pequenos, testes reproduzíveis e mensagens de status distinguindo teste focado, typecheck, build e smoke test real.
