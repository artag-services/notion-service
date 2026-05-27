# Notion Service

> Integración con Notion API — crea páginas, tareas en databases, e invita miembros vía RabbitMQ.

## Qué hace

Microservicio para la integración con **Notion API v1**. A diferencia de los otros canales que solo envían mensajes, Notion soporta **3 operaciones distintas** (todas vía el mismo routing key, distinguidas por el campo `operation`):

1. **`create_page`** — crea una página nueva bajo otra página parent
2. **`create_task`** — inserta una fila en una database (típicamente para tareas con due date, assignees, priority)
3. **`invite_member`** — invita un email a colaborar en una página

También procesa los **18 tipos de webhooks** que manda Notion para eventos en el workspace (page created/updated/moved/etc., data source events, comments).

## Stack

| Pieza | Valor |
|---|---|
| Framework | NestJS 10 |
| Lenguaje | TypeScript 5 |
| DB | PostgreSQL (`notion_db`) |
| Mensajería | RabbitMQ — exchange `channels` |
| Provider externo | Notion API v1 (`@notionhq/client`) |
| Puerto | `3003` |

## Routing keys

### Outbound (operaciones)
| Routing key | Operaciones |
|---|---|
| `channels.notion.send` | `create_page` \| `create_task` \| `invite_member` |
| `channels.notion.response` | Respuesta con `notionId` + `notionPageUrl` cuando una operación termina |
| `channels.scrapping.notion-response` | Bridge específico para integración scrapping→notion→whatsapp |

### Inbound (eventos de webhook — 18 tipos)
- **Page (8):** created, content_updated, properties_updated, moved, deleted, undeleted, locked, unlocked
- **Database (1):** created
- **Data source (6):** created, content_updated, moved, deleted, undeleted, schema_updated
- **Comment (3):** created, updated, deleted

Todos prefijados con `channels.notion.events.`.

## Payload típico

### Create page
```json
{
  "messageId": "uuid",
  "operation": "create_page",
  "message": "Contenido inicial de la página",
  "metadata": {
    "parent_page_id": "abc123...",
    "title": "Mi nueva página",
    "icon": "📝"
  }
}
```

### Create task (en database)
```json
{
  "messageId": "uuid",
  "operation": "create_task",
  "message": "Revisar PR #1234",
  "metadata": {
    "database_id": "uuid-de-la-database",
    "title_property": "Name",
    "due_date": "2026-04-30T23:59:00Z",
    "assignee_ids": ["notion-user-uuid"],
    "priority": "High"
  }
}
```

### Invite member
```json
{
  "messageId": "uuid",
  "operation": "invite_member",
  "message": "Te invito a colaborar",
  "metadata": {
    "email": "colaborador@empresa.com",
    "page_id": "uuid-opcional"
  }
}
```

## Endpoints HTTP (vía gateway)

Ver [../docs/api/channels/notion.md](../docs/api/channels/notion.md).

## Cómo obtener UUIDs de Notion

- **Página/Database**: URL → `notion.so/Mi-Pagina-abc123def456` → el UUID es el hex al final (con o sin guiones medios)
- **Usuario**: Settings → People → click en el usuario → la URL contiene el UUID
- **Database completo**: abrir como página completa (no embed) → mismo método de URL

## Configuración (`.env`)

```env
NOTION_PORT=3003
NOTION_DATABASE_URL=postgresql://postgres:postgres123@postgres:5432/notion_db
RABBITMQ_URL=...

NOTION_INTEGRATION_TOKEN=ntn_...           # Notion → My integrations → Internal Integration
NOTION_WEBHOOK_VERIFICATION_TOKEN=...      # del handshake del webhook
NOTION_PARENT_PAGE_ID=...                  # default para creates sin parent específico
```

## ⚠️ Importante

- Tu **integración debe tener acceso** a la página/database donde vas a operar. Andá a la página en Notion → Share → agregá tu integración como colaborador.
- **Plan Free de Notion** tiene limitaciones para `invite_member` con guests externos.

## Cómo correrlo

```bash
docker-compose up -d notion
```

Dev local:
```bash
cd notion
pnpm install
pnpm prisma:generate
pnpm start:dev
```

## Flujo destacado: Scraping → Notion → WhatsApp

Este servicio es parte del flow más complejo del proyecto:
1. Scrapping termina un scrape → publica a `channels.notion.send` con los datos limpios
2. Notion crea la página y publica respuesta a `channels.scrapping.notion-response`
3. Gateway escucha esa respuesta y dispara WhatsApp con el link de la página

Ver detalles completos en [../AGENTS.md](../AGENTS.md) sección "Scrapping → Notion Integration".

## Ver también

- **[../docs/api/channels/notion.md](../docs/api/channels/notion.md)** — API reference
- **[../AGENTS.md](../AGENTS.md)** — deep dive de flujos
