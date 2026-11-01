# Orb Chatter no CyberManju OS: mapa e limites da voz

## O que o pacote original faz

O ZIP enviado é o **Remix ChatterBots**, uma aplicação React que demonstra conversa de voz em streaming com Gemini Live. A UI principal combina um seletor/editor de agentes e um painel compacto de conexão e microfone: `components/Header.tsx`, `components/AgentEdit.tsx` e `components/console/control-tray/ControlTray.tsx`. Os presets carregam nome, personalidade, cor e voz; a troca do agente encerra a sessão em andamento.

O fluxo real está em `lib/audio-recorder.ts`, `hooks/media/use-live-api.ts`, `lib/genai-live-client.ts` e `lib/audio-streamer.ts`: o navegador pede acesso ao microfone, um AudioWorklet converte a captura para PCM16 a 16 kHz e o cliente envia blocos Base64 de `audio/pcm` em tempo real. A resposta PCM16 é reproduzida a 24 kHz via Web Audio. `genaiProxy.ts` encaminha a sessão ao WebSocket `/api/live-ws`; `server.ts` usa `@google/genai` para abrir a sessão e guarda a chave em variável de ambiente no servidor. O fluxo da tela é de áudio/microfone; não foi encontrada captura de webcam ou tela no controle principal.

## O que está ligado no OS hoje

O instrutor de mandarim já conversa com `useVoiceCall` e `VoiceCallController`, e encaminha cada transcrição ao Agent escolhido através de `useStudioAgent`. No navegador, a fala usa `SpeechRecognition`/`webkitSpeechRecognition` e `speechSynthesis`; no Android Tauri, usa o bridge nativo. A chamada só começa por ação explícita, é foreground e half-duplex (não escuta enquanto a síntese fala); encerrar, ocultar a aba ou desmontar o painel encerra a captura e invalida respostas antigas. O Agent continua sujeito às permissões e ao transporte já configurados no OS.

A adaptação adiciona `src/integrations/orb-chatter/providers.ts`, que oferece nomes/contratos e identifica qual implementação existente está apta neste dispositivo. A escolha é automática entre navegador e Android, não uma nova sessão Gemini Live. A seleção de modelo, personalidade e credenciais permanece no Agent do OS. Nenhuma chave é embutida no código do voice lab.

## Funcionalidade por provedor

| Provedor | Estado nesta integração | Credenciais / limite |
|---|---|---|
| Voz do navegador + Agent do OS | **Implementado**: reconhecimento e síntese nativos do navegador, resposta textual pelo Agent escolhido. Requer suporte do browser/WebView e permissão de microfone. | Credenciais pertencem à configuração existente do Agent no OS. A disponibilidade e privacidade do reconhecimento/síntese dependem do navegador e do dispositivo. |
| Voz nativa Android + Agent do OS | **Implementado**: adaptador Android já existente no OS para captura e síntese. | Usa IPC/serviços locais do app. A disponibilidade depende de Android e das permissões/serviços instalados. |
| Gemini Live | **Backend funcional no ZIP, não conectado ao OS**. O servidor Express/WebSocket do pacote abre `ai.live.connect` e encaminha áudio. No catálogo do OS, por isso, aparece somente como **interface**, não como opção funcional. | O relay original requer `GEMINI_API_KEY`/`API_KEY` somente no servidor; não copiar a chave para o frontend. Para integração real, seria preciso uma decisão de arquitetura, relay autenticado no backend do OS, controles de abuso/custo e testes de ciclo/expiração. O servidor do ZIP não deve ser publicado sem revisão de autenticação, rate limiting e gestão de sessões. |
| ElevenLabs | **Interface-only**. Não há cliente, endpoint ou backend ElevenLabs neste pacote ou neste porte. | Uma futura integração precisa manter o segredo no backend confiável e definir retenção; nada disso está configurado aqui. |
| Remoto / Colab | **Interface-only**. O pacote não entrega notebook, deployment ou serviço Colab. | Destino e autenticação devem vir da implantação/backend confiável. A UI não recebe endpoint arbitrário nem encaminha chave indicada pelo cliente. |

A interface extensível `VoiceProviderAdapter` padroniza conexão cancelável, envio de texto/áudio, eventos de transcrição/áudio/interrupção/erro e desconexão. Seu contexto expõe apenas idioma, ID do Agent e `AbortSignal`: não aceita URL de conexão nem chave/API key do chamador. Cada destino remoto deve ser configurado e validado no host/backend confiável. O contrato é apenas uma interface: **não** instancia nem simula um backend. O catálogo usa `implementation: 'implemented'` apenas para as duas rotas de dispositivo já funcionais; os três backends externos ficam `interface-only`.

## Portabilidade da UI e comportamento

Foram reaproveitados conceitos, não a aplicação React inteira: seleção de Agent, estado visível, início explícito do microfone, mutar/parar/interromper e escolha de idioma. O instrutor já apresenta essas interações em componentes Vue e nos controles UI do OS. Não foram trazidos dependências React/Zustand, CSS da demo, avatar de keynote, efeitos de face nem presets que duplicariam os Agents. A ponte de dispositivo do OS substitui a captura PCM/AudioWorklet do original; portanto a conexão atual **não** é uma réplica de Gemini Live streaming e não recebe áudio PCM bruto pelo Agent.

O instrutor já estava conectado aos pontos de voz existentes. Para integrar o catálogo ao estado atual sem sobrepor a expansão, a única alteração nele é aditiva: a UI mostra a rota realmente selecionada e explica que destinos remotos são controlados pelo host. `src/utils/mandarinCourse.ts`, os registros de aulas, referências e progresso não foram editados. Não é necessário reordenar o trabalho do corpus. Se a prioridade mudar para uma sessão Gemini Live verdadeira (ou TTS ElevenLabs/Colab), isso deve ser uma fase separada depois de estabilizar o corpus, com relay/backend, credenciais guardadas no servidor e revisão de privacidade/custos — não basta trocar o seletor de provedor.

## Licença e proveniência

O ZIP declara **Apache License 2.0** e contém avisos de Copyright 2024 Google LLC. A cópia da licença original está em `src/integrations/orb-chatter/LICENSE`. Este porte reutiliza a arquitetura como referência e preserva o aviso; não incorpora os componentes React, o código de transporte Gemini, assets ou dependências do pacote. A licença não substitui a revisão dos termos de serviço/privacidade dos provedores externos.

## Testes

A integração foi validada com `npx vitest run tests/frontend/orb-chatter-providers.test.ts tests/frontend/mandarin-voice-provider-integration.test.ts tests/frontend/mandarin-course.test.ts tests/frontend/voice-call.test.ts tests/frontend/android-voice-call-integration.test.ts` (34 testes aprovados), `npx vue-tsc --noEmit` e `npx vite build --outDir /tmp/cybermanju-orb-chatter-dist`. A suíte Vitest completa não concluiu no tempo observado; não é reportada como aprovada.
