# Build Ren’Py Web local/CI

O build é somente para validação local ou em runner efêmero. Não faz commit, push, deploy, publicação nem upload de artefatos. A saída local fica em `build/local/<BUILD_ID>/`; no CI, em `RENPY_STAGING_DIR/<BUILD_ID>/`. O script recusa sobrescrever diretórios existentes e nunca grava em `public/`.

O pacote contém os 56 fundos JPEG otimizados e a abertura independente. Os 54 renders Technosutra — incluindo os PNGs brutos e as cópias provisórias idênticas — são removidos do staging e não podem aparecer no ZIP nem nos downloads progressivos. A opção de galeria no jogo exibe apenas um aviso de que os renders foram excluídos devido ao conflito de licença. Os arquivos-fonte no worktree não são modificados.

A autorização confirmada cobre a adaptação do PDF, não a distribuição pública dos artefatos. Mantenha a saída deste build local/efêmera e não a redistribua.

## Ambiente fixado

- Ren’Py 8.5.3 + Web support oficiais, verificados por SHA-256 em `tools/install_renpy_sdk.sh`.
- Python 3.12, Pillow 12.3.0 e Playwright 1.62.0, fixados em `requirements-renpy.txt`.
- Xvfb e Chromium headless para lint/build e smoke test.
- Os JPEGs q85 são derivados das 56 PNGs originais sem sobrescrevê-las; `optimized/manifest.json` registra hashes, tamanho e PSNR.

Exemplo local:

```bash
python3.12 -m pip install -r integrations/renpy-technosutra/requirements-renpy.txt
bash integrations/renpy-technosutra/tools/install_renpy_sdk.sh /tmp/renpy-8.5.3-sdk
python3.12 -m playwright install chromium
RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-check-001 \
  bash integrations/renpy-technosutra/build_web.sh
```

Use um `BUILD_ID` novo a cada execução. O workflow não configura upload de artefatos nem deploy.
