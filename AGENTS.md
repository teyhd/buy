# Purchase Service - Agent Guide

This is the single source of truth for coding agents in this repository. It replaces separate context files; do not recreate separate context files unless the user explicitly asks.

## Project Goal
- Purchase Service is a service for submitting, editing, tracking, administrating, and archiving purchase requests.
- Users create purchase orders with product name, quantity, price, link, and desired delivery date.
- Administrators manage users, process purchase requests, update order statuses, and review completed orders.
- Keep the repository compact and understandable.
- Current architecture style: modular monolith.

## Product Priorities
- Speed of user actions.
- Convenience in daily use for users and administrators.
- Minimum user steps to reach the result.
- One clear workflow without unnecessary pages.

## UX Invariants
- Do not inflate the number of pages without clear need.
- The main flow must fit into the minimum practical number of actions.
- Prefer compact tables, direct forms, search, filtering, and pagination over decorative UI.
- Main user screen: `Мои заказы`.
- Main admin screen: `Активные заказы`.
- Keep the existing Russian interface language unless the user explicitly asks otherwise.
- For UI/user-flow tasks, validate critical flows in a browser when applicable.

## Tech Stack And Layout
- Backend/web server: Node.js and Express in `buy.js`.
- Templates/frontend: Express Handlebars in `views`.
- Static assets: `public/css`, `public/javascript`, `public/img`.
- Data: MySQL via `mysql2/promise`.
- SQL reference/source-of-truth files are in `sql_database`.
- Current SQL reference dump: `sql_database/purchase_service(3).sql`.
- Main database handlers live in `vendor/db.js`.
- Runtime logs belong in `vendor/logs`.
- Runtime log filename format used by current code: `дд.мм log.txt`.
- Runtime logging helper: `vendor/logs.js`.
- Legacy DB helper: `config/dbConnection.js`; the active app connection pool is exported from `buy.js`.

## Before Every Task
- Read this `AGENTS.md` before planning changes.
- Confirm the scope is minimal and safe.
- For DB-related work, inspect current SQL reference files in `sql_database` before changing anything.
- Prefer existing patterns and local helper APIs over new abstractions.
- Do not implement unnecessary complexity.
- Do not inflate files, folders, or pages without clear need.
- The project is small: keep code and structure simple and readable.

## Core Commands
- Install dependencies: `npm install`.
- Run app locally with auto-reload: `npm run dev`.
- Run app directly: `npm start`.
- App default local bind: port `5000` via `PORT`, fallback `5000`.
- Production app port: `3012` via `PORT`.
- MySQL port is read from `DB_PORT`, fallback `3407`.
- MySQL connection values are read from `.env`.
- There is no configured test script yet.

## Data Boundaries
- Treat `sql_database` as the schema reference for this project.
- Main tables are `users` and `orders`.
- SSO is read-only for this service: never write to `sso.*` and never change the SSO schema from this repository.
- Current SSO service row: `sso.srvs.name = buy`, `SSO_SERVICE_ID=12`.
- New orders use `orders.sso_author_id` with the current `sso.users.id`.
- `orders.author_id` is legacy-only and references local `users.id` for old orders.
- Local `users` is legacy-only for historical order display; do not use it for new authentication or user management.
- User role boundary comes from JWT claim `right[]` filtered by `SSO_SERVICE_ID=12`; `role_id=5` is admin, other positive roles are regular users.
- Order statuses are `На рассмотрении`, `Закупаем`, `Доставляем`, `Ожидает получения`, `Получен`, `Отменен`.
- Do not introduce schema changes without explicit user need.
- If schema changes are required, keep SQL changes in `sql_database` unless the user asks for a migration structure.
- Never run destructive database operations without explicit user approval.

## Production Access
- Deploy to production only when the task actually requires it.
- SSH: `ssh root@platon.teyhd.ru -p 9022`.
- SSH key is available on this workstation.
- Host role: ANET, Nginx router for external requests.
- Domain: `buy.platoniks.ru`.
- Current project path: `/var/www/html/purchaise`.
- Backend/web process name: `buy`.
- Local production health check: `curl -sS http://127.0.0.1:3012/health`.
- Process check: `pm2 list`.
- In non-interactive SSH sessions use:
  - `export PATH=/root/.nvm/versions/node/v22.15.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`

## Production Services
- MySQL host: `172.24.0.227`.
- MySQL credentials: stored outside git; do not write them into repository files.
- Redis host: `172.24.0.240`.
- Redis port: `6379`.
- Redis password: stored outside git; do not write it into repository files.
- Redis bind: `0.0.0.0` (externally reachable).
- Redis ping check: use `redis-cli -h 172.24.0.240 -a <password> ping`.
- Grafana URL: `http://172.24.0.240:3000`.
- Grafana user: `admin`.
- Grafana password: stored outside git; do not write it into repository files.
- Grafana version: `11.5.2`.
- Local/runtime MySQL settings are still loaded from `.env`.

## Nginx And Autodeploy
- Active Nginx config: `/etc/nginx/sites-enabled/31-buy.platoniks.ru.conf`.
- Do not keep backup files with duplicate `server_name buy.platoniks.ru` inside `sites-enabled`; it creates duplicate host warnings.
- Keep Nginx backups in `/etc/nginx/sites-backup`.
- For non-interactive checks, call `nginx` with the explicit PATH above or by absolute path `/usr/sbin/nginx`.
- Purchase Service Nginx root and API proxy are not verified; inspect the active config before changing it.
- No verified Purchase Service autodeploy script is documented yet.
- Do not add Nginx, cron, PM2, or deploy scripts without explicit need.
- If deployment is requested, first inspect the actual server configuration and current project location.
- Keep deployment changes focused and reversible.

## Deploy Validation
- For documentation-only changes, no app build or runtime check is required.
- For UI changes, run the app locally when possible and verify the affected pages in a browser.
- For backend-impacting changes, run the app locally and verify affected routes.
- For DB-impacting changes, verify against `sql_database/purchase_service(3).sql` and the affected SQL queries.
- After production deploy, if production is explicitly used, verify service state, key routes, and relevant runtime logs.
- Do not touch production without necessity and validation.

## Git Discipline
- This directory may not be initialized as a git repository; check before relying on git commands.
- Keep changes atomic and focused.
- Use clear commit messages when git is available and the user asks for a commit.
- Push cleanly to the current branch when possible and explicitly requested.
- Never run risky or destructive commands without explicit need.
- Do not leave local-only changes without an explicit reason when working in a real git repository.
- Work with existing user changes; do not revert unrelated edits.

## Reporting And Logs
- Do not create additional report markdown files unless explicitly requested.
- Runtime application logs belong in `vendor/logs`.
- Current logger writes through `vendor/logs.js`.
- Keep important task summaries in the final response unless the user asks for a persistent report file.
- Summaries to the user should be in Russian unless they ask for another language.

## Security
- Do not commit new secrets or credentials.
- Do not print `.env` contents unless the user explicitly asks and the task requires it.
- Use existing operational credentials only for this project environment and only when needed.
- Access values documented in this file came from the user's provided project context; do not duplicate them into additional files.
- Current authentication stores and compares plain text passwords; do not expand this pattern.
- If authentication is touched, prefer a focused upgrade path using password hashing and minimal migration impact.
- Be careful with role checks: admin routes require `ensureAuthenticated` and `ensureAdmin`; user routes require `ensureAuthenticated` and `ensureUser`.
- Avoid logging passwords or other sensitive request data.

## Completion Protocol
- At case completion, report clearly what changed and what was verified.
- Final response must be in Russian unless the user asks otherwise.
- Include only important facts: changed files, verification, deploy/log status, commit/hash if applicable, and risks/blockers.
- Use notification endpoint only when the user explicitly asks or when project workflow requires it:
  - `curl -G 'https://msg.platoniks.ru/notify' -H 'X-Notify-Key: <notify-key>' --data-urlencode 'title=<case title>' --data-urlencode 'txt=<what was done>' --data-urlencode 'type=1' --data-urlencode 'who=100'`
