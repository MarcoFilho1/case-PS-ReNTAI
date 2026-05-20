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
* [Escolha da arquitetura](docs/adr/003-arquitetura.md)/

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