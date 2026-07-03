# API

Implemented endpoints:

```text
GET    /health
GET    /api/system/status
GET    /api/documents
POST   /api/documents
POST   /api/webpages
GET    /api/documents/:id
GET    /api/documents/:id/file
GET    /api/documents/:id/pages/:page
POST   /api/documents/:id/analyze
POST   /api/selections
POST   /api/selections/:id/jobs
GET    /api/jobs/:id
GET    /api/jobs/:id/events
GET    /api/documents/:id/analysis
GET    /api/documents/:id/selection-jobs
DELETE /api/documents/:id
```

All job events are sent as SSE messages with event name `job`.

Job types:

```text
page_analysis
document_analysis
selection_explain
selection_fact_check
```

Job statuses:

```text
queued
running
done
failed
failed_schema
cancelled
```
