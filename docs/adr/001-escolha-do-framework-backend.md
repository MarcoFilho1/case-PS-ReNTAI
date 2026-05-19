O edital exige a construção de uma API RESTful do zero para gerenciar teleconsultorias, contemplando upload de documentos, integração com um serviço de IA para validação inteligente e envio de notificações em tempo real para o front-end sem recarregamento da página. 

Alternativas Consideradas:

* Django: Possui ORM próprio, painel admin e autenticação nativa
* FastAPI: É focado em alta performance, assíncrono por natureza e documentação automática

Embora o FastAPI exige uma configuração inicial de ORM e de um sistema de migrations optei por utilizar o framework FastAPI. Ele é baseado em type hints e oferece recursos como validação automática de dados, geração automática de documentação e suporte nativo a assincronismo. Além disso, possui uma integração muito boa com IA, facilitando a implementação de recursos como validação inteligente de documentos e envio de notificações em tempo real.