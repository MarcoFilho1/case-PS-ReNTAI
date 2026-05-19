# case-PS-ReNTAI
Para garantir rastreabilidade das decisões de design e documentar trade-offs, este projeto utiliza Architecture Decision.
Você pode conferir os detalhes na pasta /docs/adrs:
* [Escolha do framework backend](docs/adr/001-escolha-do-framework-backend.md)
* [Escolha do sistema de autenticação](docs/adr/002-autenticacao.md)
* [Escolha do framework backend](docs/adr/003-arquitetura.md)

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