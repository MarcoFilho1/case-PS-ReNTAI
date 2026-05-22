# case-PS-ReNTAI

Plataforma de teleconsultorias médicas que conecta profissionais de saúde a especialistas remotos, cobrindo o ciclo completo: solicitação, validação inteligente de documentos via IA, emissão de pareceres e acompanhamento em tempo real.

## 1. Arquitetura da Solução e Stack
O sistema foi arquitetado para ser moderno, assíncrono e tipado de ponta a ponta. 

* **Backend:** FastAPI + Python. Escolhido pelo suporte nativo a operações assíncronas que é essencial para chamadas de IA, WebSockets e geração automática de documentação OpenAPI.
* **Banco de Dados:** PostgreSQL.
* **Frontend:** React + Vite + TypeScript.
* **Infraestrutura:** Containerização com Docker.

---
Para garantir rastreabilidade das decisões de design e documentar trade-offs, este projeto utiliza Architecture Decision.
Você pode conferir os detalhes na pasta /docs/adrs:
* [Escolha do framework backend](docs/adr/001-escolha-do-framework-backend.md)
* [Escolha do sistema de autenticação](docs/adr/002-autenticacao.md)
* [Escolha da arquitetura](docs/adr/003-arquitetura.md)

---

Diagrama ER do banco de dados:

```mermaid
erDiagram
    USER {
        uuid id PK
        string name
        string email
        string password_hash
        enum role
        timestamp created_at
    }

    TELECONSULTATION {
        uuid id PK
        string patient_name
        date patient_dob
        enum specialty
        text diagnostic_hypothesis
        text clinical_history
        string document_path
        enum status
        float ai_confidence_score
        text ai_rejection_reason
        uuid requester_id FK
        uuid specialist_id FK
        timestamp created_at
    }

    OPINION {
        uuid id PK
        uuid teleconsultation_id FK
        uuid specialist_id FK
        text content
        timestamp created_at
    }

    STATUS_HISTORY {
        uuid id PK
        uuid teleconsultation_id FK
        enum old_status
        enum new_status
        uuid changed_by FK
        timestamp created_at
    }

    USER ||--o{ TELECONSULTATION : "solicita"
    USER ||--o{ TELECONSULTATION : "atende"
    TELECONSULTATION ||--o{ OPINION : "possui"
    USER ||--o{ OPINION : "registra"
    TELECONSULTATION ||--o{ STATUS_HISTORY : "gera_historico"
    USER ||--o{ STATUS_HISTORY : "altera_status"
```

## 2. Instruções de Execução
O projeto utiliza Docker para garantir que o ambiente seja replicável sem necessidade de instalar dependências locais.
1. Certifique-se de ter o Docker e o Docker Compose instalados.
2. Clone o repositório e navegue até a raiz.
3. Crie um arquivo `.env` na raiz baseado no `.env.example`.
4. Execute o comando: `docker compose up --build`
5. Acesse a aplicação:
   - **Frontend:** http://localhost:3000
   - **Backend/Swagger:** http://localhost:8000/docs

## 3. Configuração do Serviço e Substituição do Modelo
A validação de documentos utiliza uma abordagem híbrida (OCR + pypdf) combinada com a API do OpenRouter (LLM) por padrão. 

* **Para configurar a LLM:** Edite as variáveis no arquivo `.env` localizado na raiz do projeto:
  ```env
  OPENROUTER_API_KEY=sua_chave_aqui
  OPENROUTER_MODEL="z-ai/glm-4.5-air:free"
  OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
  ```

* **Fallback Automático:** Caso as chaves do serviço de IA não estejam configuradas, o backend rejeitará o processamento inicial de forma segura, informando a falta de credenciais e impedindo validações indevidas.

---

### Substituição do Modelo e Provedor (OpenAI / Gemini)
A lógica de validação e geração de resumos clínicos por IA está isolada em [ai_service.py](backend/ai_service.py) na função `validate_document`. Se desejar substituir o OpenRouter para utilizar a API nativa da **OpenAI** ou do **Google Gemini**, siga as orientações abaixo:

#### 1. Migrando para a API da OpenAI (e.g. gpt-4o)
1. **Configurar as variáveis no `.env`:**
   ```env
   OPENAI_API_KEY=sua_chave_openai_aqui
   OPENAI_MODEL=seu_modelo_gemini
   ```
2. **Atualizar a função no `backend/ai_service.py`:**
   Instale o SDK oficial (`pip install openai`) e reescreva a chamada dentro de `validate_document`:
   ```python

   client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

   response = await client.chat.completions.create(
       model=os.getenv("OPENAI_MODEL"),
       messages=[
           {"role": "system", "content": system_prompt},
           {"role": "user", "content": user_prompt}
       ],
       temperature=0.1,
       response_format={ "type": "json_object" } 
   )
   content_str = response.choices[0].message.content
   ```

#### 2. Migrando para a API do Google Gemini (e.g. gemini-1.5-flash)
1. **Configurar as variáveis no `.env`:**
   ```env
   GEMINI_API_KEY=sua_chave_gemini_aqui
   GEMINI_MODEL=seu_modelo_gemini
   ```
2. **Atualizar a função no `backend/ai_service.py`:**
   Instale o SDK oficial do Google (`pip install google-generativeai`) e implemente o fluxo assíncrono:
   ```python

   genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

   model = genai.GenerativeModel(
       model_name=os.getenv("GEMINI_MODEL"),
       generation_config={"response_mime_type": "application/json"}
   )
   response = await model.generate_content_async(
       f"SYSTEM: {system_prompt}\n\nUSER: {user_prompt}"
   )
   content_str = response.text
   ```

*(Dica: Se preferir manter as chamadas por requisição direta HTTP sem instalar SDKs adicionais, basta apenas redirecionar o `OPENROUTER_URL` e o objeto de cabeçalhos/payload em [ai_service.py](backend/ai_service.py) para o provedor desejado).*


### Validação por Área (Especialidade Médica)
A validação realizada pela IA analisa minuciosamente se o documento submetido corresponde à especialidade da teleconsultoria solicitada:
* **Regra de Pertinência:** O documento anexado deve ser compatível com a área da teleconsulta. Por exemplo, se a teleconsulta for de **Cardiologia** e o documento submetido for de **Odontologia**, a IA identificará a divergência técnica e recusará o caso (alterando o status para `CANCELADA` com a justificativa de rejeição).
* **Arquivos de Amostra para Testes:** Todos os arquivos disponibilizados na pasta [sample_documents](sample_documents) para testar os fluxos foram gerados por inteligência artificial para simular dados médicos reais de forma segura. Eles estão localizados na raiz do repositório:
  * [laudo_cardiologia.pdf](sample_documents/laudo_cardiologia.pdf) - Laudo de amostra para teste da especialidade de Cardiologia.
  * [laudo_cirurgia_robotica.pdf](sample_documents/laudo_cirurgia_robotica.pdf) - Laudo de amostra para teste de Cirurgia Robótica.
  * [laudo_doencas_raras.pdf](sample_documents/laudo_doencas_raras.pdf) - Laudo de amostra para teste de Doenças Raras.
  * [laudo_odontologia.pdf](sample_documents/laudo_odontologia.pdf) - Laudo de amostra para teste de Odontologia.
  * [resumo_parecer.pdf](sample_documents/resumo_parecer.pdf) - **Exemplar de Exportação de PDF:** Documento de amostra que demonstra exatamente como o parecer final é formatado e exportado pelo sistema.
  
  Você pode utilizar esses laudos de amostra para testar fluxos bem-sucedidos (enviando o documento correspondente à especialidade) ou simular a rejeição automática cruzando áreas distintas (ex: enviar o laudo de odontologia para cardiologia).

## 4. Como testar o fluxo completo
1. Acesse o Frontend em `http://localhost:3000`.
2. Registre um usuário com o papel `SOLICITANTE` e faça login.
3. No Dashboard, clique em "Nova Teleconsultoria", preencha o formulário clínico, anexe um arquivo e clique em "Confirmar e Analisar com IA".
4. O frontend exibirá a tela de carregamento "Análise de IA ReNTAI" com um botão "Retornar ao menu". O backend registrará a consulta como `PENDENTE` e executará a validação da IA em segundo plano (*background task*).
5. Se você aguardar na tela de carregamento, o frontend atualizará e fechará o modal automaticamente assim que o processamento terminar. Caso clique em "Retornar ao menu", você poderá ver o status da teleconsultoria atualizando de `PENDENTE` para `EM_ANDAMENTO` ou `CANCELADA` no painel principal.
6. Se o documento for validado com sucesso pela IA (score >= 0.85), o caso passará para `EM_ANDAMENTO`. Se for recusado (score < 0.85), passará para `CANCELADA` e você poderá clicar no caso para ler o motivo detalhado da rejeição emitido pela IA.
7. Registre ou faça login com um usuário de papel `ESPECIALISTA`. Acesse os detalhes da teleconsultoria em status `EM_ANDAMENTO` e envie um parecer para alterá-la automaticamente para `CONCLUIDA`.
8. **Sininho de Notificações:** Durante a sessão, as notificações (como aprovação/rejeição de IA ou parecer de especialista) se acumulam no sininho da barra superior em tempo real. Abrir o sininho zera a contagem e as notificações persistem localmente por usuário, expirando automaticamente após 7 dias.

## 5. Recursos que o projeto dispõe
O sistema foi aprimorado com funcionalidades focadas na facilidade de uso médico:
* **Edição, Cancelamento e Ciclo de Vida da Teleconsultoria:**
  * **Edição e Cancelamento:** O médico solicitante pode editar ou cancelar sua solicitação enquanto ela estiver com o status `AGUARDANDO_PARECER` ou `EM_ANDAMENTO`. Isso possibilita corrigir informações clínicas e reenviar/alterar documentos caso necessário. Se ele alterar o documento, este passará por uma nova validação.
  * **Conclusão Automática:** A teleconsulta muda automaticamente para o status `CONCLUIDA` no exato instante em que o médico especialista registra seu parecer técnico final pelo sistema.
  * **Disponibilidade do Resumo e Exportação:** A opção de exportação em PDF só fica disponível ao solicitante após a teleconsulta passar para o status `CONCLUIDA`. Durante as fases de processamento ou análise (`PENDENTE`, `EM_ANDAMENTO`), essas funcionalidades ficam bloqueadas para garantir a integridade dos dados clínicos.

* **Visualização Web Inline de Documentos:** Permite visualizar arquivos em formato PDF e imagens clínicas diretamente no modal de detalhes da teleconsulta sem downloads automáticos obrigatórios.

* **Sininho de Notificações Inteligente:** Painel acumulador de eventos recebidos em tempo real via WebSocket. Zera a contagem de não lidas ao abrir, fornece navegação imediata ao caso ao clicar e remove automaticamente registros com mais de 7 dias (limpeza baseada em idade de evento, persistida no `localStorage` sob chaves exclusivas de cada usuário logado).

* **Exportação de Resumo em PDF:** Permite que o médico solicitante faça o download de um relatório formatado em PDF após a conclusão da teleconsultoria. O arquivo gerado organiza metadados, histórico clínico, diagnóstico preliminar, resumo gerado pela IA e a conduta final do especialista em blocos estruturados e visualmente limpos.
  * **Arquivo de Demonstração:** Você pode visualizar um exemplar real de como o PDF é exportado pelo sistema através do link: [resumo_parecer.pdf](sample_documents/resumo_parecer.pdf).

## 6. Limitações Conhecidas e Versão de Produção
* **Armazenamento de Arquivos:** No MVP, os arquivos são salvos localmente (`/app/uploads`). Em produção, migraríamos para AWS S3 ou GCS.
* **Migrações:** O SQLAlchemy usa `create_all` para facilitar testes. Em produção, usaria **Alembic**.
* **Fila de Processamento:** O processamento de IA e OCR roda de forma assíncrona usando as `BackgroundTasks` nativas do FastAPI. Em um cenário de produção, substituiria essa fila em memória local por uma fila de mensageria utilizando Celery com Redis ou RabbitMQ.
* **Validação de Cadastro de Médicos:** Em um ambiente de produção, o processo de criação de contas de médicos solicitantes e especialistas exigiria o envio de documentos profissionais (como CRM válido, comprovante de especialização e identificação) passando por uma etapa manual ou automatizada de validação regulatória antes da liberação do acesso. No escopo atual de testes e demonstração do MVP, essa validação regulatória foi abstraída para permitir o cadastro e simulação imediata de fluxos.
* **Distribuição de consultas para especialistas:** No escopo do MVP, a associação entre a teleconsulta e o médico especialista é simplificada. Em um cenário de produção, seria implementado um algoritmo de balanceamento de carga de trabalho  para atribuir automaticamente o caso a um médico especialista qualificado e ativo na fila correspondente assim que o status mudasse para `EM_ANDAMENTO`.



## 7. Ferramentas de IA utilizadas

Neste projeto, adotei assistentes de inteligência artificial estritamente como ferramentas para aumento de produtividade e otimização de tempo. Todas as decisões de arquitetura, regras de negócio e validações de segurança foram concebidas por mim, utilizando as IAs sob orientação e constante revisão de código, em duas frentes:

### Estratégia de Uso
Para maximizar a eficiência das ferramentas e evitar cenários de alucinação de código ou lógicas incoerentes utilizei  **Dividir para Conquistar**:
* **Redução de Alucinações:** Fragmentei ao máximo o problema maior em tarefas e problemas menores e isolados. Isso reduziu drasticamente o espaço de busca e evitou alucinações de lógica ou sintaxe da IA.
* **Supervisão e Autonomia:** Após a arquitetura geral do sistema e o escopo inicial estarem consolidados, testados e validados por mim, o agente de IA foi responsável por escrever grande parte do código funcional sob minha supervisão contínua.

As ferramentas foram utilizadas nas seguintes frentes:

### 1. Gemini 3.1 Pro (Browser)
* **Atuação:** Utilizado na fase de setup para gerar a base de tipagem dos schemas Pydantic e o mapeamento objeto-relacional (ORM), partindo da modelagem de banco de dados que projetei previamente. Também o direcionei para a montagem dos arquivos de configuração inicial do Docker.
* **Orientação:** Conduzi as interações através de prompts incrementais e contextuais. Em vez de pedir soluções abertas, forneci os logs e a estrutura desejada, exigindo aderência aos padrões de tipagem que defini.
* **Avaliação:** A ferramenta foi excelente para reduzir o trabalho braçal de infraestrutura. Porém exigiu minha supervisão ativa e refatoração manual para corrigir alucinações em versões de dependências, além de ajustar lógicas redundantes que a IA tentava refazer códigos que já haviam na arquitetura existente.

### 2. Antigravity - Agente Integrado na IDE (Gemini 3.5 Flash)
Operei este agente autônomo como um assistente de execução focado na IDE. A partir das especificações de requisitos e fluxos de usuário que desenhei, deleguei e supervisionei a codificação das seguintes entregas:
* **Refinamento do Frontend e Padronização Visual:** A IA foi utilizada ativamente para refinar as telas do frontend e padronizar toda a interface visual do sistema, além de criar scripts de testes automatizados e verificar sistematicamente se havia diferenças visuais ou estruturais indesejadas entre componentes e telas.
* **Segregação de Perfis Médicos:**
  * **Banco de dados e API:** Instruí o agente a implementar as travas de segurança nas rotas e a injeção do campo `specialty`, revisando posteriormente as regras de autorização para garantir que os especialistas tivessem acesso estrito apenas aos seus casos (`EM_ANDAMENTO`/`CONCLUIDA`).
  * **Interface do Usuário (UI):** Orientei a construção dos componentes condicionais da UI (ocultação de botões). Para otimizar a experiência médica, recusei abordagens via popups e direcionei o agente a criar um formulário inline para o registro de pareceres na tela de detalhes, mantendo o contexto clínico visível.
* **Notificações em Tempo Real (WebSockets):**
  * Projetei a arquitetura da comunicação em tempo real e utilizei o agente para acelerar a codificação do pipeline WebSocket.
  * Solicitei a criação do sistema visual de Toasts, validando pessoalmente os gatilhos para garantir que o dashboard reagisse instantaneamente a aprovações e novos pareceres sem a necessidade de polling.
* **Filtros Temporais Avançados:** Especifiquei os critérios de negócio para os filtros temporais avançados, delegando ao agente a implementação do filtro dinâmico de 7 dias nas métricas e nos cartões de status do dashboard, bem como a lógica de ordenação e as validações de fuso horário.
* **Depuração e Garantia de Qualidade:**
  * Utilizei o contexto profundo da ferramenta para rastrear e solucionar problemas de concorrência que diagnostiquei em Refs do React e no fechamento de conexões WebSocket.
  * Direcionei o agente na resolução de bugs de importação e exportação de módulos e componentes, validando pessoalmente o código.
  * Defini os cenários críticos e exigi que o agente escrevesse e executasse scripts de testes automatizados. Revisei o código final para garantir a qualidade do código.