# Build Ren’Py Web local/CI

O script de build é somente para validação local ou em runner efêmero: não faz commit, push ou deploy e nunca grava em `public/`. A saída local fica em `build/local/<BUILD_ID>/`; no CI, em `RENPY_STAGING_DIR/<BUILD_ID>/`. O workflow reutilizável do Actions envia o runtime validado e os diagnósticos como artefatos temporários, retidos por sete dias, para encadeamento com o CI principal.

O pacote contém os 56 fundos JPEG otimizados e os 54 sprites estáticos provisórios autorizados para distribuição. O build valida o manifesto e os SHA-256 dos sprites, mantém o manifesto dos sprites e a proveniência de captura, e preserva os slots 43 e 52 como ausentes. Os PNGs brutos de captura em `masters/source` ficam fora do pacote; os sprites runtime autorizados permanecem em `masters/sprites/provisional`.

A autorização de distribuição pública foi confirmada pelo proprietário para a adaptação do livro (roteiro e assets do jogo) e para os 54 sprites derivados dos GLBs. Os 54 retratos permanecem provisórios, estáticos e identificados como arte de referência; não adicionar GLBs nem outros materiais do upstream sem autorização e proveniência próprias.

## Ambiente fixado

- Ren’Py 8.5.3 + Web support oficiais, verificados por SHA-256 em `tools/install_renpy_sdk.sh`.
- Python 3.12, Pillow 12.3.0 e Playwright 1.62.0, fixados em `requirements-renpy.txt`.
- Xvfb e Chromium headless para lint/build e smoke test.
- Os JPEGs q85 são derivados das 56 PNGs originais sem sobrescrevê-las; `optimized/manifest.json` registra hashes, tamanho e PSNR.
- O staging compacto exclui os PNGs de arte-fonte, JPEGs baseline e capturas brutas; mantém as 54 sprites runtime, seus manifestos e os derivados otimizados.

## Cache

O CI cacheia o cache do `pip` conforme `requirements-renpy-build.txt`, o Chromium do Playwright e os downloads do SDK/Web oficial do Ren’Py 8.5.3. O instalador confere os SHA-256 fixados antes de reutilizar downloads. O pacote de jogo e a saída final de build **não** são armazenados em `actions/cache`; o runtime validado viaja ao job principal como artefato.

O jogo agora depende de cache persistente para abrir rápido. `web/service-worker.js` pré-carrega no evento `install` o motor (`renpy.wasm`, `renpy.data`, `renpy.js`, `renpy-pre.js`) e os arquivos de partida (`index.html`, `game.zip`, `web-presplash.jpg`, manifesto e ícones), e serve esses pedidos em cache-first nas visitas seguintes: o segundo carregamento não baixa os ~37 MB do motor de novo. As 111 imagens progressivas entram no cache conforme são usadas, nunca no `install`, porque pré-carregar 72 MiB dobraria o primeiro download.

A invalidação é por conteúdo, não por data nem por número manual. `tools/stamp_service_worker.py` calcula um SHA-256 de todos os arquivos servidos (menos o próprio worker) e grava os 16 primeiros dígitos em `CACHE_VERSION`, de modo que o nome do cache muda exatamente quando um byte muda — sem bump manual e sem jogo antigo preso no navegador de quem volta. Navegação e `pwa_catalog.json` continuam network-first, para que um deploy apareça na hora; requisições com `Range` nunca são interceptadas (o motor faz streaming do arquivo com elas); só respostas 200 da mesma origem são gravadas; e uma cópia sem carimbo (checkout de fonte) não intercepta nada. O validador e o smoke test recusam um worker distribuído sem carimbo ou sem a lista de precache, e o SHA-256 do worker segue vinculado aos metadados do mesmo run do CI.

Exemplo local:

```bash
python3.12 -m pip install -r integrations/renpy-technosutra/requirements-renpy.txt
bash integrations/renpy-technosutra/tools/install_renpy_sdk.sh /tmp/renpy-8.5.3-sdk
python3.12 -m playwright install chromium
RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-check-001 \
  bash integrations/renpy-technosutra/build_web.sh
```

Use um `BUILD_ID` novo a cada execução. O script não publica nem implanta a build; no CI, os artefatos são usados pelo pipeline principal e retidos por sete dias.
