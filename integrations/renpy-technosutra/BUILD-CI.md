# Build Ren’Py Web local/CI

O build é somente para validação local ou em runner efêmero. Não faz commit, push, deploy, publicação nem upload de artefatos. A saída local fica em `build/local/<BUILD_ID>/`; no CI, em `RENPY_STAGING_DIR/<BUILD_ID>/`. O script recusa sobrescrever diretórios existentes e nunca grava em `public/`.

O pacote contém os 56 fundos JPEG otimizados e os 54 sprites estáticos provisórios autorizados para distribuição. O build valida o manifesto e os SHA-256 dos sprites, mantém o manifesto dos sprites e a proveniência de captura, e preserva os slots 43 e 52 como ausentes. Os PNGs brutos de captura em `masters/source` ficam fora do pacote; os sprites runtime autorizados permanecem em `masters/sprites/provisional`.

A autorização de distribuição pública foi confirmada pelo proprietário para a adaptação do livro (roteiro e assets do jogo) e para os 54 sprites derivados dos GLBs. Este workflow continua sendo apenas de validação: não publica, implanta nem envia artefatos.

## Ambiente fixado

- Ren’Py 8.5.3 + Web support oficiais, verificados por SHA-256 em `tools/install_renpy_sdk.sh`.
- Python 3.12, Pillow 12.3.0 e Playwright 1.62.0, fixados em `requirements-renpy.txt`.
- Xvfb e Chromium headless para lint/build e smoke test.
- Os JPEGs q85 são derivados das 56 PNGs originais sem sobrescrevê-las; `optimized/manifest.json` registra hashes, tamanho e PSNR.
- O staging compacto exclui os PNGs de arte-fonte, JPEGs baseline e capturas brutas; mantém as 54 sprites runtime, seus manifestos e os derivados otimizados.

Exemplo local:

```bash
python3.12 -m pip install -r integrations/renpy-technosutra/requirements-renpy.txt
bash integrations/renpy-technosutra/tools/install_renpy_sdk.sh /tmp/renpy-8.5.3-sdk
python3.12 -m playwright install chromium
RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-check-001 \
  bash integrations/renpy-technosutra/build_web.sh
```

Use um `BUILD_ID` novo a cada execução. O workflow não configura upload de artefatos nem deploy.
