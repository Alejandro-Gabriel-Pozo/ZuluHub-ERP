# ZuluHub ERP: instrucciones para trabajar en este repositorio

Idioma: español rioplatense. El dueño define el negocio y no programa; la calidad técnica es responsabilidad
del ingeniero. Las decisiones están en el repositorio `ZuluHub-docs` (ADR 001 a 008 y casos de uso).

## Antes de entregar

- Correr `npm run gate` (tipos, lint, formato, arquitectura, código muerto, pruebas). Debe pasar completo.
- Cambios mínimos y enfocados; no inventar librerías ni APIs; avisar antes de sumar una dependencia.
- Una regla nueva de arquitectura trae su violación inyectada en `test/arquitectura/reglas.test.ts`.

## Reglas que no se negocian

- **Variables de entorno y secretos: nunca se escriben valores acá.** Las maneja el dueño en Vercel y Neon.
  El código solo declara y valida nombres.
- Dinero: nunca `number` para importes; texto decimal en la frontera (ADR-006).
- La herramienta de acceso a datos solo se importa en `src/adaptadores/postgres` y `src/modulos/*/persistencia`.
- Los dominios no importan Zod, React ni Next. Entre módulos se entra solo por `publico.ts`.
- Todo cambio de datos: transacción, idempotencia, aislamiento por empresa, auditoría en la misma transacción.
- Migraciones: SQL revisado; avisar antes de cualquier cambio destructivo.
- No hacer commit de `.env`, claves ni cadenas de conexión.

## Infraestructura

- Vercel: proyecto `zuluhub-erp` (equipo `alepozod`), región de funciones `gru1`. Ya existe `apps/web` (Next,
  npm workspaces) y el CI la compila sin secretos, pero el despliegue sigue deshabilitado
  (`git.deploymentEnabled: false` en `vercel.json`) hasta que el dueño apruebe el primer despliegue.
- Neon: proyecto `flat-flower-36030007`, rama `production`, región `aws-sa-east-1`, Postgres 18.
