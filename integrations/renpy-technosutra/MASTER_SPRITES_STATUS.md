# Status dos renders provisórios dos mestres — Technosutra / Ren’Py

## Integração atual

O menu inicial inclui uma galeria de pré-visualização e os capítulos exibem os retratos estáticos previstos pelo manifesto de captura. Há **54 PNGs frontais transparentes**, todos com 600 × 800 pixels. As cópias em `game/images/masters/sprites/provisional/` são byte a byte idênticas às fontes em `game/images/masters/source/`; os 54 hashes SHA-256 do manifesto foram verificados. A galeria identifica cada render com o selo **PROVISÓRIO**.

Os IDs/caminhos seguem somente as entradas reais do `capture_manifest.json` e de `game/images/masters/sprites/manifest.json`. Não foram inventados nomes de modelos ou caminhos; não foram geradas variações de boca, expressão ou postura. Os retratos são estáticos, sem lip-sync.

## Build de validação

O lint oficial do Ren’Py 8.5.3 passou. O build Web de validação está em `build/provisional-output/`; o `game.zip` foi validado e contém os 54 PNGs provisórios e os scripts compilados. Esse build separado não substituiu `build/output/` nem `public/technosutra-vn/`, e não foi publicado.

## Inventário reconciliado

Os arquivos existentes são `model_01.png`–`model_42.png`, `model_44.png`–`model_51.png` e `model_53.png`–`model_56.png`: 54 renders para 54 GLBs. Os slots 43 e 52 não têm GLB nem PNG neste conjunto.

O arquivo `model_14.png` é um render válido do slot/capítulo 14, **Sudarśana**, não uma capa: o manifesto de captura o mapeia a `models/modelo14.glb`, registra 600 × 800, alfa e `renderError: null`; a cópia `master_ch14_provisional.png` tem o mesmo SHA-256 e é byte a byte idêntica. O arquivo `model_56.png` é igualmente o retrato do slot/capítulo 56, não uma capa. Por isso ambos os renders estão incluídos na integração.

## Limites técnicos e distribuição

A galeria mostra a identificação do arquivo/slot e o estado provisório. Os modelos não fornecem animações ou morph targets adequados à sincronização de boca; não foram tentadas variações de boca ou postura.

O manifesto upstream registra uma divergência de licença: o README declara MIT, enquanto o arquivo LICENSE contém marcadores de conflito e texto GPLv3. O dono autorizou separadamente a redistribuição pública destes 54 renders derivados, além da adaptação de *The Stem Array*. Essa autorização específica não resolve a licença upstream nem cobre os GLBs ou outros materiais; mantenha apenas os 54 PNGs listados nos manifestos e os avisos de proveniência.
