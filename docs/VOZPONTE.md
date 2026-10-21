# VozPonte — conversar com o CyberManju OS

O painel Assistant oferece **Start voice call**. No aplicativo Android, a chamada usa `SpeechRecognizer` e `TextToSpeech` nativos, sem depender da API de fala do WebView. No desktop/web, continua usando a API de fala do navegador quando disponível. Escolha um assistente já configurado, termine qualquer tarefa ou rascunho e inicie a chamada. A fala reconhecida segue o envio normal do chat; a resposta final é narrada, sem alterar o histórico completo.

## Controles da chamada

**Mute / Unmute** pausa ou retoma o microfone. **Interrupt & speak** interrompe a reprodução e abre o próximo turno. **End call** encerra o áudio e descarta callbacks atrasados. Uma tarefa já enviada continua no agente; use **Stop** no chat para cancelá-la.

Não há captura simultânea ao TTS. Ocultar a página, pausar/destruir a Activity Android, desmontar o painel ou trocar de assistente/conversa encerra o áudio. Não há palavra de ativação, gravação permanente, serviço de microfone em segundo plano ou retomada automática depois de falhas. O idioma acompanha o ditado existente (PT-BR/EN-US).

No Android, conceda o microfone nas configurações do app e mantenha um provedor de reconhecimento e vozes TTS instalados. O botão **Microphone settings** abre os detalhes do aplicativo; **Refresh permission status** atualiza os acessos. A disponibilidade do provedor de fala não significa que a permissão de microfone já foi concedida. O provedor Android pode processar áudio pela rede; não há promessa de funcionamento offline.

## Notificações no app Android

A seção **Android app notifications** permite escolher apps instalados ou informar seus nomes de pacote. A seleção começa vazia; pressione **Save app selection** para aplicá-la. Conceda acesso ao serviço VozPonte em **Notification access settings**. Esse acesso é separado da permissão para o CyberManju publicar suas próprias notificações.

**Refresh notifications** lê apenas as notificações dos apps selecionados. A nova ponte mantém até 100 entradas em memória; não grava seus corpos em disco e não as encaminha automaticamente ao assistente, ao histórico do chat ou à chamada de voz. A seleção de pacotes fica em preferências locais. O hub de mensagens legado e suas permissões continuam separados: esta opção não migra nem apaga o histórico daquele hub.

Quando o app de origem disponibiliza uma ação de resposta `RemoteInput`, aparece **Review reply on Android**. O diálogo nativo mostra app, destinatário exposto na notificação e texto. Somente **Confirm** tenta enviar; **Cancel** não envia. A ação precisa continuar válida e o pacote permanecer autorizado. Não há garantia de resposta a notificações que não exponham esse recurso.

## Preenchimento assistido

Ative o serviço VozPonte em **Accessibility settings** somente se quiser esse recurso. Escolha um app autorizado, informe o texto e pressione **Review fill on Android**. Após a confirmação nativa, abra/foque o campo desejado no app de destino em até 30 segundos. O serviço só tenta preencher uma vez um campo focado, editável e não protegido por senha, pertencente exatamente ao pacote escolhido.

O preenchimento **não clica em Enviar**, não faz gestos nem extrai uma árvore de conteúdo para o assistente. Campos protegidos, interfaces que não expõem edição e falta de foco podem impedir a operação. Cancelar a confirmação não arma o preenchimento. Remover o app da seleção revoga o acesso da ponte; desative os serviços nas configurações Android para revogar os acessos do sistema.

## Limites e arquitetura

A nova entrada `android_voice_command` é IPC local do Tauri/JNI. Não há rota REST nem ferramenta do agente para notificações, respostas ou acessibilidade. Os comandos aceitos e o tamanho do payload são limitados; eventos de áudio têm IDs por turno, fila limitada e descarte de callbacks antigos. O fluxo existente de permissões, YOLO, perguntas e aprovações do agente não muda.

Os fontes mantidos ficam em `native/android/`. `scripts/android-voice-services.py`, executado pelo `android-configure.sh`, instala os arquivos Kotlin, serviços do manifest, consultas aos provedores de fala e o XML de acessibilidade no projeto Android gerado. Não edite `src-tauri/gen/android` manualmente para persistir alterações.

O [VozPonte standalone](https://github.com/cybermanju/vozponte) continua disponível como aplicativo complementar. Ele se conecta ao dashboard REST autenticado; a integração nativa acima fica no CyberManju, antes de qualquer integração futura com Sys. Não há mudanças nesta etapa no OS, no cybsh/Termux ou na CLI.

## Verificação

### APK release e ponte JNI

A segunda revisão do APK ARM64 do commit `78386d6` (run `39600561434`) encontrou a classe `CybermanjuVoiceServices` no DEX, mas sem o método estático `dispatch(Activity, String, String): String` chamado por JNI. O shrinker removeu a entrada e a implementação de reconhecimento/TTS: a presença da classe e o build verde, sozinhos, não comprovavam que a chamada funcionava naquele APK. Esse binário antigo não recebe correções automaticamente; é necessário instalar um APK recompilado com as regras de preservação corrigidas.

O instalador deve vincular explicitamente as regras de preservação ao build release, independentemente do nome do arquivo ProGuard gerado pelo Tauri. `scripts/check-android-voice-apk.py` verifica o DEX do APK final antes do upload, incluindo a assinatura e a implementação da entrada JNI e as referências aos motores Android de reconhecimento e TTS. Essa barreira de empacotamento não substitui uma chamada real no aparelho.

Cada turno de escuta/resposta tem sua própria geração: resultados, erros e conclusões de fala de um turno anterior não podem interferir no seguinte. Encerrar a chamada durante a criação de uma conversa impede o envio ainda não iniciado ao agente. Falhas e timeouts liberam o áudio nativo; o reconhecimento usa o modelo de fala livre e informa separadamente silêncio, permissão, rede, microfone ocupado e provedor indisponível.

Os testes de `voice-call.test.ts` verificam o controlador de turnos. `android-voice.test.ts` cobre fala nativa com portas determinísticas, ordem do IPC, permissão negada, silêncio e callbacks atrasados. `android-voice-services.test.ts` verifica instalação idempotente e contratos de segurança dos fontes; `android-voice-settings.test.ts` verifica os controles da interface. Testes de contrato não substituem execução Android.

Antes de considerar pronto para uso diário, validar o APK e os serviços em um celular real: PT/EN, microfone negado, ausência de provedor de fala, TTS sem voz instalada, silêncio, interrupção, tela bloqueada, retomada do app, fones/Bluetooth, troca de conversa e falha de rede. Testar notificações reais, revogação de seleção/acessos, atualização/remoção durante uma confirmação, cancelar/confirmar resposta e preenchimento em campo protegido ou de outro app. A compilação isolada do Kotlin não certifica o empacotamento APK/JNI nem esses comportamentos em hardware.
