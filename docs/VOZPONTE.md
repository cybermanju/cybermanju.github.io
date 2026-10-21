# VozPonte — conversar com o CyberManju OS

O painel Assistant oferece **Start voice call** quando o navegador disponibiliza reconhecimento e síntese de fala. Escolha um assistente já configurado, termine qualquer tarefa ou rascunho e inicie a chamada. A fala final reconhecida é enviada como uma mensagem normal ao assistente selecionado; a resposta final é reproduzida em voz alta. O histórico mantém o texto completo, incluindo código que não é narrado.

## Controles

- **Mute / Unmute** pausa ou retoma o microfone. Uma resposta em andamento ainda pode ser reproduzida.
- **Interrupt & speak** interrompe a reprodução e inicia o próximo turno. Não há captura simultânea à voz sintetizada, para evitar eco e comandos involuntários.
- **End call** encerra reconhecimento/reprodução e descarta callbacks atrasados. Uma tarefa já enviada continua no agente; use **Stop** no chat para cancelá-la.
- Ocultar a página, desmontar o painel, trocar de assistente, aba ou conversa encerra o áudio. Não há escuta permanente, palavra de ativação ou garantia de funcionamento em segundo plano.

O reconhecimento segue o idioma do ditado existente (PT-BR, EN-US ou detecção automática). Se a API não existir no navegador/WebView, a interface informa a limitação e o chat por texto permanece disponível. Permissão negada, falha de rede/voz e silêncio repetido encerram a captura em vez de repetir indefinidamente.

## Privacidade e permissões

Iniciar a chamada autoriza o envio dos turnos falados ao assistente configurado. O provedor de reconhecimento do navegador pode processar áudio na rede; a síntese depende das vozes instaladas. Use fones para não expor respostas. O modo de voz não altera YOLO, permissões de ferramentas, perguntas ou aprovações: solicitações pendentes continuam no chat para revisão manual.

A integração não cria uma ponte automática de notificações para o modelo. O [VozPonte Android](https://github.com/cybermanju/vozponte) continua responsável por receber notificações dos apps escolhidos, TTS nativo, resposta direta por `RemoteInput` e preenchimento assistido. Esses recursos dependem das permissões concedidas pelo usuário e das ações/campos realmente expostos pelo app. Respostas a outros apps exigem confirmação; não há promessa de ler/escrever qualquer interface Android.

## Conectar o Android

A implementação complementar está no repositório VozPonte. Ela usa o dashboard REST autenticado do CyberManju OS, não a página estática do GitHub Pages. Informe o endpoint do dashboard, token de sessão do dashboard (não uma chave do provedor de IA) e ID da configuração do assistente. Use HTTPS fora de loopback; não publique credenciais no repositório.

O contrato existente é `POST /api/agent/prompt` com `configId`, `prompt` e opcional `sessionId`; a resposta fornece `jobId`. Consulte `GET /api/agent/jobs/{jobId}` e o transcript da sessão para a resposta concluída. Aprovações não podem ser presumidas nem resolvidas automaticamente pela ponte.

## Verificação

`tests/frontend/voice-call.test.ts` verifica transições, proteção contra duplicatas/eco, mudo, cancelamento, callbacks antigos, interrupção e falhas com portas determinísticas. TypeScript verifica a integração Vue. Esses testes não certificam áudio audível, reconhecimento em dispositivo real, Bluetooth, permissões de WebView ou política de bateria do Android.

Antes de considerar pronto para uso diário, testar em celular e desktop reais: PT/EN, permissão negada, silêncio, troca de conversa, ocultar a página, fones, interrupção, falha de rede e uma ferramenta que solicite aprovação. No Android, testar também notificações/respostas reais dos apps escolhidos, sempre confirmando destinatário e conteúdo.
