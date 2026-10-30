# Archi sample workspace

A minimal, self-contained workspace for trying Archi without a real project. It has just enough to exercise all three views:

- **System**: `docker-compose.yml` declares a `notes` service (merged automatically with its `notes-worker` Celery worker, the same blue/green-style merge Archi applies to real multi-process deployments), a Postgres `db`, and `redis`.
- **Data**: `backend/apps/notes/models.py` declares `Notebook`, `Note` (with a `ForeignKey` to `Notebook` and a `ManyToManyField` to `Tag`), and `Tag` — enough to show a foreign key, a many-to-many relationship, and its join table in **Physical** mode.
- **Flows**: `backend/config/urls.py` + `backend/apps/notes/urls.py` declare two routes (`/api/notes/` and `/api/notes/<int:pk>/`); `backend/apps/notes/tasks.py` declares a Celery task triggered from `backend/apps/notes/views.py`.

To try it: open this folder in VS Code with the Archi extension installed, then run **Archi: Analyze Workspace**.
