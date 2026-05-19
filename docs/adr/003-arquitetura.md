Quando um especialista registrar um parecer, a teleconsultoria deve ser dada como "Concluída" e o sistema deve notificar o usuário solicitante em tempo real, atualizando a interface sem que ele precise recarregar a página.

Alternativas consideradas:
* Polling: O frontend faz requisições a cada X segundos pra verificar se há alguma atualização
* Server Sent Events: O servidor envia atualizações para o cliente quando há novidades
* WebSockets: O cliente e o servidor mantem uma conexão aberta e trocam atualizações

Optei por utilizar WebSockets. Por padrão o websockets evita o spam de requisições http e seus cabeçalhos constantes, garantindo baixa latência e melhor escalabilidade. No entanto, a conexão mantém o estado no servidor, consumindo memória RAM. O servidor backend precisará manter um gerenciador pra rastrear quais usuários estão conectados e quais salas eles pertencem.
