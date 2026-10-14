# ZuluHub ERP

Código de ZuluHub. Las decisiones, el diseño y las reglas viven en el repositorio
[ZuluHub-docs](https://github.com/Alejandro-Gabriel-Pozo/ZuluHub-docs): empezar por sus ADR (`08-adr/`)
y por los casos de uso (`09-casos-de-uso/`).

## Estado

Hito **H0**: esqueleto, CI y reglas de arquitectura activas. Todavía no hay aplicación ni base de datos conectada.

## Comandos

| Comando                   | Qué hace                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run gate`            | Todo lo que corre el CI, en una sola pasada                                                 |
| `npm run typecheck`       | TypeScript estricto                                                                         |
| `npm run lint`            | ESLint (con reglas de promesas)                                                             |
| `npm run format:check`    | Prettier (`npm run format` corrige)                                                         |
| `npm run arquitectura`    | Reglas de dependencias entre carpetas (ADR-001)                                             |
| `npm run analizar:muerto` | Código y dependencias sin uso (knip)                                                        |
| `npm test`                | Pruebas, incluidas las que rompen cada regla de arquitectura a propósito                    |
| `npm run migrar -- --ver` | Migra la base real (`--ver`, `--aplicar`, `--preparar-roles`); ver el script                |
| `npm run instalar-clave`  | Instala en la base la clave de firma del contexto (`ZULUHUB_CLAVE_CONTEXTO`)                |
| `npm run build:web`       | Compila `apps/web` sin variables de entorno; el despliegue: `apps/web/PRIMER-DESPLIEGUE.md` |

## Estructura

Ver ADR-001. Hoy solo existe `src/primitivas/`. Las carpetas se crean cuando hay contenido real.

## Variables de entorno

No se declaran valores en este repositorio. Se cargan en Vercel (y en Neon para la base). El código
declara y valida **nombres**, nunca valores.
