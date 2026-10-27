# CyberManju OS CLI no Termux

O CLI `cyb` pode ser instalado no Android/Termux usando o instalador desta pasta. O pipeline de release compila e publica somente `cyb-android-arm64.tar.gz`; dispositivos ARM64 (`aarch64`/`arm64`) são aceitos. ARM de 32 bits (`arm`, `armv7l`, `armv8l`) é recusado com diagnóstico explícito, pois não existe binário arm32 publicado. Outras arquiteturas também não são suportadas. O instalador valida o SHA-256 antes de instalar.

## Instalação

No Termux, instale os utilitários necessários e execute o script local:

```sh
pkg install curl tar coreutils
bash cli/scripts/install-termux.sh
cyb setup
```

O script usa `curl`, `tar`, `sha256sum`, `awk`, `install`, `mktemp`, `mkdir`, `chmod`, `uname`, `mv` e `rm` (fornecidos pelos pacotes Termux indicados). Para uso remoto sem perguntas, forneça a URL real do dashboard conforme as opções `cyb setup --help`; não informe credenciais em uma URL. Um perfil do CLI fica em `~/.config/cybermanju/cyb.json` com permissões restritas. Use `cyb config` para conferir o destino e `cyb update` para atualizar (a atualização também exige checksums publicados).

Para inspecionar sem rede ou alterações:

```sh
bash cli/scripts/install-termux.sh --dry-run
bash cli/scripts/install-termux_test.sh
```

`CYB_VERSION=vX.Y.Z` ou `--version vX.Y.Z` escolhe uma release; a tag precisa ter formato `vMAJOR.MINOR.PATCH`. `--prefix DIR` permite especificar explicitamente o prefixo Termux. O instalador exige um prefixo absoluto. Releases devem publicar o tarball Android arm64 e `SHA256SUMS.txt`; se o artefato/checksum não existir, estiver duplicado ou não corresponder, a instalação falha sem substituir `cyb`. O arquivo precisa conter exatamente uma entrada `cyb` regular; links e nomes duplicados/ambíguos são recusados.

Depois da validação, o instalador copia o executável para um arquivo temporário no próprio diretório de destino e só então substitui `bin/cyb` por renomeação atômica. Falhas de cópia ou renomeação preservam a instalação anterior e removem o arquivo temporário. Se `bin/cyb` for um link simbólico, o link é substituído sem alterar seu alvo; se for um diretório, a instalação é recusada.

Os downloads do binário e dos checksums aceitam somente HTTPS, inclusive nos redirecionamentos. Cada tentativa tem limite de 15 segundos para conexão e 180 segundos para transferência, com até duas repetições e janela de repetição de 600 segundos. A configuração pessoal `.curlrc` é ignorada para manter essas garantias. Uma falha de download interrompe a instalação sem alterar o `cyb` existente; confira a conexão e execute o instalador novamente.

O instalador usa o binário pré-compilado e **não precisa de Go no dispositivo**. Para compilar o CLI a partir do código, o módulo declara Go **1.27.2** (`cli/go.mod`); versões mais antigas não satisfazem o módulo. Atualize o Termux (`pkg update && pkg upgrade`) e instale/atualize o pacote `golang` (`pkg install golang` ou `pkg upgrade golang`), depois confirme com `go version`. Se os repositórios do Termux ainda não oferecerem essa versão mínima, não reduza `go.mod`: use um ambiente de build que ofereça Go 1.27.2 ou superior e instale o artefato Android publicado.

## Uso do CLI interativo

`cyb cute`, `cyb cybsh` e `cyb repl` abrem a interface interativa do CLI. **Tab** completa; **↑/↓** navegam pelo histórico; **PgUp/PgDn** percorrem a saída; **Ctrl+L** limpa a tela. **Esc** cancela a entrada/ação interativa local. `:help` mostra ajuda, `:clear` limpa a tela e `:quit` encerra a sessão. Um espaço no início da linha (leading space) evita que a entrada seja registrada no histórico local quando esse recurso é suportado; isso **não** oculta nem apaga o que for enviado ao servidor. **Ctrl+C** cancela apenas a espera local por uma resposta HTTP; não desfaz nem cancela uma operação já iniciada no servidor.

## O que o Termux suporta — e o que não suporta

Este é o **cliente CLI Go**, não a aplicação desktop Tauri. O instalador não instala Rust, não compila localmente, não instala Docker, não inicia um servidor e não modifica o perfil nem executa `cyb setup`. Execute setup separadamente. No Android, escolha um dashboard remoto acessível por HTTPS ou o modo CLI Limited/Supabase quando apropriado; a configuração Supabase limitada não equivale ao dashboard completo.

O dashboard web/REST é um serviço separado. `cyb setup` e `cyb backend select` oferecem dashboard remoto, CLI Limited e um dashboard local executado a partir da imagem OCI publicada. No Termux, essa opção instala PRoot-Distro com sua permissão e executa a imagem sem Docker Engine; os dados persistem em `~/.local/share/cybermanju-os/data`. O servidor fica vinculado a `127.0.0.1` no dispositivo. PRoot-Distro fornece um ambiente de usuário Linux, não isolamento de kernel como Docker. A execução depende da compatibilidade da imagem ARM64 e das restrições de processos em segundo plano do Android. O modo remoto requer uma URL acessível pelo dispositivo/rede. Recursos dependentes do servidor não passam a funcionar offline. A compatibilidade de clipboard depende das capacidades do terminal/Android e não é garantida por este pacote.

O script escolhe somente o artefato arm64 quando o dispositivo reporta `aarch64`/`arm64`; detecta e recusa arm32 com explicação de que a release não compila essa arquitetura. A detecção não assegura compatibilidade com todo dispositivo, versão do Android, política de armazenamento ou configuração de rede. Em caso de falha de execução, confira `uname -m`, a versão do Termux e a disponibilidade do artefato; use o modo dry-run para confirmar o plano sem baixar.
