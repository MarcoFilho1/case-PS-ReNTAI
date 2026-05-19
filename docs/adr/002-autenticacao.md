O edital exige que usuários tenham perfis de Solicitante e Especialista e que o acesso a determinadas rotas e botões seja protegido baseado nos perfis.

Alternativas consideradas:
* Sessão baseada em estados com cookies e redis onde o servidor guarda o estado da sessão
* JWT onde o cliente guarda o token assinado e criptografado


Optei por utilizar o JWT pelo seu desempenho. Como o token contém as informações do usuário como ID e perfil no payload, a API pode validar a autenticação e autorização sem precisar fazer uma query no banco a cada requisição.
Por ser stateless, não é possível revogar um token antes que ele expire por padrão. Pra contornar isso em um ambiente de produção 
usaria uma estratégia de token de acesso de curta duração junto com um refresh de token. Mas para o escopo desse projeto vou utilizar apenas o access token com expiração padrão.