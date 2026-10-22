# Shortcuts: contrato da interface

`ShortcutsPanel.vue` é um editor de rascunhos e uma apresentação dos resultados do core. O painel está registrado como **`shortcuts`**, separado dos aliases legados `automation`/`schedules`/`cron`, que continuam abrindo Tasks. Ele é carregado sob demanda no window manager e está disponível no launcher mobile, drawer, menu desktop e paleta de comandos.

## O que funciona sem host

Criar um rascunho, buscar ações registradas, inserir/configurar/remover nós, construir ramos verdadeiro/falso independentes, editar predicados e bindings, editar o JSON completo e validar a estrutura pelo core. A remoção de condição exige confirmação local: preserva o destino verdadeiro e elimina nós exclusivos do caminho falso; referências inválidas impedem a alteração. Os cartões são mostrados em ordem topológica, não na ordem de armazenamento.

Nenhuma edição executa uma ação. Não há localStorage, repository, backend, runner, journal, bridge ou política de autorização criados pela UI. Fechar a janela descarta o rascunho. Salvar e executar ficam desabilitados por padrão, com aviso explícito; não há scheduler ou execução em segundo plano.

A lista padrão vem de `createAutomationRegistry().list()` e contém somente `core.script`. HTTP, cybsh, IA e Android só entram na biblioteca se estiverem no array fornecido pelo host. Metadados de apresentação para IDs conhecidos não registram nem habilitam essas ações. IDs desconhecidos registrados pelo host são exibidos pelo próprio ID, sem inventar schemas.

## Props e eventos Vue

Todos os tipos do motor são importados de `@/automation` (o `index.ts` público confirmado em `7447939`).

| Prop | Tipo / padrão | Responsabilidade |
| --- | --- | --- |
| `modelValue` | `Workflow \| undefined` | Snapshot do rascunho; validado com `validateWorkflow`. Entrada inválida bloqueia salvar/executar. |
| `savedWorkflow` | `Workflow \| undefined` | Snapshot persistido confirmado do host. Ausente, inválido ou diferente do draft bloqueia executar; eco de `modelValue` não comprova save. |
| `records` | `WorkflowRecordView[]`, `[]` | Registros `{recordVersion:1,workflow,name,updatedAt}` do host; lista de atalhos salvos, sem repository na UI. |
| `selectedWorkflowId` | `string \| null`, `null` | Seleção controlada pelo host; UI solicita `update:selectedWorkflowId(id)`, não carrega nem persiste por conta própria. |
| `saveComplete` | `{requestId,record} \| null` | ACK de save bem-sucedido, correlacionado com o pedido pendente e seu conteúdo exato. |
| `saveFailed` | `string \| null` | requestId cujo save falhou; libera novo pedido mantendo rascunho/revisão-base. |
| `actions` | `ReturnType<ActionRegistry['list']>` | Apenas `{id,effect}` de ações realmente registradas; `[]` significa nenhuma ação. |
| `canSave` | `boolean`, `false` | O host possui um serviço real e está pronto para receber o pedido. |
| `canRun` | `boolean`, `false` | O host possui runtime, política e journal apropriados e está pronto para revisar o pedido. |
| `authorizationConnected` | `boolean`, `false` | Atestado explícito do host de que a política por ação, correlação com snapshot/run e timeout fail-closed estão conectados. Um listener de `authorization-decision` também é obrigatório; `canRun` sozinho nunca basta. |
| `authorizationRequest` | `AuthorizationRequest \| null`, `null` | Pedido único de autorização de ação `write`, após resolver bindings não secretos, mantendo `secretRef` literal. |
| `resultContext` | `{runId,workflowId,workflowRevision} \| null`, `null` | Correlação do resultado/pendência fornecida pelo host, obrigatória para reconhecimento explícito. |
| `pendingRun` | `PendingRun \| null`, `null` | Snapshot durável tipado (`workflowId`, `workflowRevision`, `runId`, `status`, `code`, `startedAt`, `updatedAt`), sem payloads/outputs; qualquer pendência bloqueia Run. |
| `acknowledgeFailedContext` | `{runId,workflowId,workflowRevision} \| null`, `null` | A UI só reabilita nova confirmação se a falha de storage corresponder exatamente ao ACK pendente e à pendência atual. |
| `running` | `boolean`, `false` | Execução efetivamente informada pelo host, não mero evento enviado. |
| `result` | `ShortcutRunResult \| null`, `null` | Resultado real e correlacionado pelo host ao snapshot executado; inclui a união `rejected` do serviço. |

`update:modelValue(workflow)` sincroniza somente o **rascunho**, sem afirmar persistência. `request-save(workflow, {requestId,name,expectedRevision})` solicita salvamento e não afirma sucesso. O nome é escolhido pelo usuário (nenhum nome é inventado); `expectedRevision:null` indica criação e, para update, a revisão-base carregada é preservada mesmo que chegue uma atualização remota. O primeiro argumento mantém a revisão do editor. O host constrói a revisão seguinte (`1` para criação; `expectedRevision + 1` para update) antes de chamar seu repository e devolve `saveComplete={requestId,record}`. `request-run(workflow)` é emitido uma única vez após revisão local explícita e bloqueia outros pedidos até receber estado do host; não gera runId nem chama o runner. Cada payload é um snapshot validado e separado do estado do editor. A revisão não é incrementada pela UI; pertence ao host. Save pendente bloqueia executar, novo rascunho e duplicar saves, mas permite editar: um ACK tardio não descarta edições posteriores.

O ACK só é aceito se requestId, nome e workflow completo corresponderem ao snapshot submetido, com a revisão exata esperada. Apenas um ACK próprio correspondente pode limpar `dirty`; uma mudança arbitrária em `savedWorkflow` não o limpa. Se o draft ou campos mudaram depois do pedido, o ACK fica em reconciliação explícita e as edições são preservadas. Um ACK inválido mantém o pedido bloqueado até o host fornecer ACK válido ou `saveFailed`. O host deve atualizar também `records`, `selectedWorkflowId`, `savedWorkflow` e seu draft após o save; nenhum desses dados é persistido pela UI.

Snapshots externos diferentes não substituem silenciosamente um rascunho alterado, campos não aplicados ou uma execução pendente: ficam em um aviso de conflito que bloqueia salvar/executar até escolher manter o rascunho local ou carregar a versão externa descartando as alterações. O eco do próprio v-model não apaga edições nem resolve o conflito por conta própria. Manter o rascunho não evita a validação CAS e a reconciliação de revisões pelo host.

O composition root passa `actions=registry.list()` e escuta esses eventos. Isso não é um contrato novo de repository/service: o service continua a cargo de CUTE. Não se deve ativar `canRun` apenas porque existe um listener.

## Revisão do snapshot salvo

`canRun` sozinho não habilita execução. O draft precisa estar sem `dirty`, sem campos pendentes e ser idêntico ao snapshot salvo validado. O handler repete os guardas e exige revisão local explícita. A revisão usa uma cópia separada do snapshot salvo e mostra workflow ID, revision, cada nó/`actionId` e seu input JSON completo, inclusive ações em ramos não escolhidos. O evento envia uma nova cópia validada desse mesmo snapshot uma única vez; qualquer divergência bloqueia. Uma atualização do draft invalida a revisão.

A edição (incluindo nome e seleção) fica congelada durante revisão, solicitação/execução e confirmação/resultado incerto. A revisão não concede autorização por ação. `secretRef` e bindings de saída aparecem literalmente como referências; a UI não acessa vault nem resolve valores. O host é responsável pelo runId, pelo vínculo imutável `{workflowId,revision,runId,content}`, pela comparação de nó/`actionId`/input exatos e por negar divergências antes do dispatch. O host solicita a confirmação de cada ação `write` pelo canal abaixo, com o passo exato e outputs resolvidos não secretos; outputs não são persistidos por esta UI.

## Autorização explícita de cada ação

```ts
interface AuthorizationRequest {
  requestId: string
  workflowId: string
  workflowRevision: number
  nodeId: string
  actionId: string
  input: Json
}
// Prop: authorizationRequest: AuthorizationRequest | null
// Evento: authorization-decision({requestId, decision: 'allow' | 'deny'})
```

A UI só apresenta pedidos durante uma solicitação/execução iniciada pelo snapshot revisado nesta janela. Confere workflow/revisão, nó, actionId registrado como `write`, snapshot completo do draft/modelValue/savedWorkflow e ausência de conflito. O input é uma cópia JSON limitada e validada, sem `$output` pendente nem credenciais inline reconhecidas. O JSON exibido é integral e escapado: não há truncamento, mascaramento ou resolução de vault. `secretRef` permanece referência. Pedidos inválidos nunca expõem payloads em estados/erros.

Cada pedido exige um toque explícito em **Permitir ação** ou **Negar ação**. Eventos levam apenas requestId e decisão; não repetem input, logs, outputs nem segredos. A decisão é consumida uma vez; substituir/mutar/cancelar pedido, mudar snapshot/revisão/registro/permissões, receber resultado, desmontar ou ultrapassar 60 segundos nega o pedido pendente. Handlers capturados não aprovam pedidos posteriores. Ações e seleção ficam bloqueadas durante a autorização, revisão e execução. Uma referência idêntica reapresentada não renova o prazo. IDs consumidos não podem ser reaproveitados nesta instância (limite de 4096 IDs; depois disso novos pedidos são negados).

**Responsabilidade obrigatória do host:** criar requestId único por autorização; vincular duravelmente requestId ao runId/snapshot imutável e ao nó/actionId/input JSON resolvido exato; capturar o input antes de publicar o pedido e comparar novamente antes do dispatch. O `allow` é somente intenção do usuário, nunca prova de correlação ou permissão de execução. Qualquer request desconhecido, mismatch, replay, cancelamento, listener perdido, ausência de resposta ou timeout deve negar por padrão. O prazo do host deve ser no máximo 60 segundos e não pode depender de timers/browser/UI ativos. O host valida schemas, permissões, ownership, secrets e o caminho percorrido. Como a prop solicitada não contém runId, a UI **não consegue** distinguir duas execuções da mesma revisão; a correlação requestId → runId pertence ao host e não pode ser inferida apenas por workflowId/revisão.

## Reconhecer resultados e restaurar pendências

`acknowledge-result({runId,workflowId,workflowRevision}, options?)` é emitido somente após o usuário abrir a revisão do resultado e tocar em **Confirmar reconhecimento**. O payload é a correlação exata de `resultContext`, nunca um runId inventado pela UI; mudança de resultado/contexto invalida handlers antigos. A mesma correlação só pode ser reconhecida uma vez por instância, inclusive após atualizações de campos ou replay do resultado; o host mantém essa garantia duravelmente entre reloads. Para `pendingRun` incerto (`status:'unknown'` ou `code:'interrupted'|'uncertain'`), a UI envia `options:{acceptUncertain:true}` somente após nova confirmação explícita de risco. O evento não altera `result`, `pendingRun`, execução nem outputs. Até o host reconciliar e limpar explicitamente ambos os estados, Run continua bloqueado. Se um ACK falhar no storage, o host devolve `acknowledgeFailedContext` com a mesma correlação; a UI permite confirmar novamente só para essa pendência, sem limpá-la localmente. O host consulta a pendência antes de reportar sucesso, atualiza as props relacionadas na mesma atualização Vue e nunca chama ACK durável para um `rejected/pending_run` sem correlação persistida correspondente.

`completed` pode ser dispensado sem afirmar nada além da conclusão já informada pelo core. Para `accepted`, `needs_confirmation`, `unknown` e pendência restaurada, a UI avisa que não há conclusão certa e repetir pode duplicar o efeito. Reconhecer não conclui nem repete a ação; o host só libera nova execução após reconciliação durável correspondente. Fechar/navegar/trocar seleção/montar não emite ACK nem limpa pendências. O host restaura `pendingRun` antes de habilitar `canRun` em qualquer nova janela/reload, preservando o claim durável por workflow (não só por runId). Qualquer resultado `halted` persiste como `unknown/uncertain`, pois etapas anteriores podem já ter produzido efeitos; isso exige `acceptUncertain:true`. Nenhum armazenamento, payload, segredo ou log bruto é mantido pela UI.

## Estados e segurança

Somente `completed` é apresentado como fluxo concluído. `accepted` é aceitação, não conclusão. `needs_confirmation` mostra resumo escapado e expiração, direcionando ao host, sem botão de aprovar ou retomar. `unknown` orienta reconciliação sem retry. Os três estados bloqueiam também alterações do rascunho, novo atalho e salvamento, evitando mudar a intenção pendente. **Qualquer** resultado bloqueia uma segunda execução até o host reconciliar e limpar explicitamente o estado após `acknowledge-result`; limpar a prop não substitui a autorização, a reconciliação nem o protocolo de checkpoints do core.

`rejected` permanece rejeição do serviço antes do runner, nunca é convertido em `failed`. Os sete códigos públicos têm mensagens fixas; `pending_run` é um aviso transitório e seu ACK nunca limpa a pendência durável. Códigos desconhecidos não são ecoados. `issues` preserva somente code/severity e nodeId válido, no máximo 32 itens, com mensagens de uma allowlist. Campos livres, payloads, outputs e valores extras não são exibidos. A visão estrutural `ShortcutRunResult` é compatível com `WorkflowServiceRunResult` sem depender do runtime do serviço nesta branch.

Resultados privados ficam ocultos por padrão; a revelação é explícita e reinicia quando o resultado muda. A cópia para exibição é limitada e rejeita campos estruturados de credenciais. Nenhuma chave de idempotência, jobId ou confirmationId é mostrada. Não há logging de payloads.

A validação estrutural rejeita credenciais inline em campos reconhecidos e preserva `secretRef`. **Não é um DLP geral**: o core não identifica segredos ocultos em strings/URLs/prompts. O host deve aplicar schemas específicos por ação, validar entradas e permissões, impedir interpolação de segredos e manter correlação, revisões, autorização, ownership e claims duráveis. A lista `{id,effect}` não contém validadores nem grants de permissão. Nunca representar um intent Android como tarefa externa concluída.

## Verificação

```sh
npx vitest run tests/frontend/shortcuts-*.test.ts tests/frontend/automation-*.test.ts
npx vue-tsc --noEmit
npm run build
```

Os testes de componentes usam o plugin Vue já presente nas dependências para renderizar os SFCs reais com Vue SSR. As regressões interativas compilam os mesmos templates reais para um renderer em memória (sem DOM), exercitando botões, eventos, revisão, CAS, ACKs, conflitos, seleção controlada, autorização por ação, replay, timeout, handlers antigos, reconhecimento de resultado e restauração de pendências. A fixture manual `tests/fixtures/shortcuts-preview.html?width=320&sample=1` também aceita `width=390`, `width=768`, `theme=light` e `mockHost=1`. Ela é rotulada como **fixture sem efeitos reais**; os eventos do host são apenas contados e os resultados são simulados. Não é um runtime do produto nem um entrypoint do build.

A interface usa container queries, campos com labels, navegação por teclado, foco visível, alvos mínimos de 44 px e live regions; não depende de arrastar ou de cores para representar ramos/estados. Tokens vêm de `src/ui/tokens.ts`.

Referência de interação: [lista de ações do Shortcuts — Apple](https://support.apple.com/guide/shortcuts/navigate-the-action-list-apdc33e4f4da/ios). A referência informa busca e composição por blocos, não disponibilidade de APIs do Android ou equivalência de recursos.
