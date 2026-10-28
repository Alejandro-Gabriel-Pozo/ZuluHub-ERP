# Batería de evasión (red team) del guardián

Catálogo de intentos de evadir al guardián (contratos-arquitectonicos.md §11 y §11.1). **Una ruta de evasión nueva
es una entrada nueva de `evasiones.json`: no hay código nuevo por caso.**

## Archivos

| Archivo                                        | Qué es                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `arquitectura/contratos/evasiones.json`        | El catálogo ejecutable: una lista de casos. Datos puros.                                                                   |
| `arquitectura/contratos/evasiones-github.json` | Los casos que dependen de la configuración de GitHub: documentados (`tipo: "externo"`), sin corredor; los vigila G4.       |
| `arquitectura/contratos/evasiones.cjs`         | Valida el catálogo (forma, estados, plazos) y evalúa cada caso contra lo que pasó al correrlo.                             |
| `test/arquitectura/guardian-evasion.test.ts`   | El corredor: arma un repositorio git sintético por caso y corre lo que corre la CI (job `pruebas`, requerido por el Gate). |

## Cómo sumar un caso

1. Agregá una entrada al final de `evasiones.json` con el siguiente id libre (`EV-103`, …).
2. Elegí su `estado` (ver abajo). Un caso que ya se detecta entra `exigido`; uno que hoy pasa sin detección entra
   `brecha-abierta` o `riesgo-aceptado`, nunca como «aprobado».
3. Corré `npx vitest run --project node test/arquitectura/guardian-evasion.test.ts`. Si el estado no coincide con lo que
   pasó, la prueba lo dice con `archivo:línea` del catálogo y qué hacer.

```json
{
  "id": "EV-103",
  "via": "filtros",
  "titulo": "Carpeta nueva en la raíz, sin regla de clasificación",
  "construccion": [
    { "op": "escribir", "ruta": "carpeta-nueva/codigo.ts", "contenido": "export const x = 1;\n" }
  ],
  "controlEsperado": "clasificacion.cjs: toda ruta versionada calza una clase (ruta-sin-clase).",
  "esperado": {
    "tipo": "bloquea",
    "codigo": "ruta-sin-clase",
    "archivo": "carpeta-nueva/codigo.ts",
    "linea": 1
  },
  "estado": "exigido"
}
```

## Campos de un caso

- `id` (`EV-000`, único), `via` (una de: `workflow-ci`, `filtros`, `exclusiones`, `renombrar-mover`,
  `formato-no-soportado`, `declaraciones-excepciones`, `modificar-guardian`, `ruta-alternativa`,
  `no-se-pudo-interpretar`), `titulo`, `controlEsperado` (qué debería detectarlo o impedir la integración).
- `construccion`: lista **declarativa** de operaciones sobre el repositorio sintético, en orden:
  `escribir` (`ruta` o `rutaBase64`, `contenido` o `contenidoBase64`, `modo` octal en texto, `repetir`), `anexar`,
  `reemplazar` (`ruta`, `de`, `a`: `de` tiene que aparecer exactamente una vez), `borrar`, `renombrar` (`de`, `a`),
  `symlink` (`ruta`, `destino`), `json-poner` y `json-agregar` (`ruta`, `camino`, `valor`), `commit` (un commit en ese
  punto) y `checkout` (lo que sigue se deja en el disco **sin versionar**, como un paso previo del runner).
  En los textos valen `{{hoy}}`, `{{hoy+N}}`, `{{hoy-N}}`, `{{huella-archivo:ruta}}` y `{{huella-texto:línea}}`.
- Opcionales: `plantilla` (`sano` por omisión, `con-contrato`, `con-contrato-y-pruebas`: un contrato sintético
  `color-de-prueba`), `construccionBase` (operaciones sobre la base, para casos que comparan contra un estado
  anterior), `reloj` (días que se adelanta el reloj de las herramientas) y `sinGit` (corre sin `.git`).
- `esperado`: `{ "tipo": "bloquea", "codigo", "archivo", "linea"? }` (el cambio se bloquea con esa falla) o
  `{ "tipo": "exige-excepcion" }` (el cambio no se integra en silencio: algún chequeo sale distinto de 0, con o sin
  falla localizada).
- `estado` y los campos de su estado.

## Estados

| Estado            | Qué exige la CI                                                                                                                                                                                                                                                      | Campos propios                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exigido`         | El cambio **se bloquea** como dice `esperado`. Si pasa, falla.                                                                                                                                                                                                       | ninguno (un campo de brecha o de riesgo es una falla)                                                                                                   |
| `brecha-abierta`  | Hoy **pasa** sin detección y tiene que seguir pasando. Se reporta en cada corrida del guardián (aviso con id, severidad y días que faltan; aviso especial a 14 días o menos). Falla si venció o si el caso deja de pasar («la brecha se cerró: pasalo a `exigido`»). | `responsable`, `severidad` (`baja`/`media`/`alta`/`critica`), `justificacion`, `mitigacion`, `creada`, `vence` (como mucho 60 días después de `creada`) |
| `riesgo-aceptado` | Lo aceptó el dueño (§11.1): evasiones que exigen editar la maquinaria o límites declarados de los detectores de texto. Mismo contrato: tiene que seguir pasando; si deja de pasar, se pasa a `exigido`. Avisa desde 30 días antes; falla si pasó la fecha.           | `aprobadoPor`, `motivo`, `creada`, `revisar` (como mucho 180 días después de `creada`)                                                                  |

## Cómo se ejecuta cada caso

Se copia una plantilla (repositorio git sintético y sano, con `arquitectura/**`, `ci.yml` y las configuraciones reales),
se aplican las operaciones y se hace un commit. Después se corren, **en orden, los pasos `run:` del job `guardian`
del `ci.yml` del cambio**: el guardián del cambio y la vigilancia de la versión anterior (`no-debilitar.cjs` de la base
contra el árbol del cambio). Un paso con `if: false` se saltea, un `shell`, un `env` o `$GITHUB_ENV` cambian cómo corre,
y un paso que falta no corre. **No es GitHub Actions**: no evalúa expresiones ni ejecuta `uses:` (salvo sacar la base
en `./base`); lo que depende del motor de GitHub (disparadores, checks requeridos) está en `evasiones-github.json` o
queda documentado en el `motivo` del riesgo aceptado.

## Protección del catálogo

La vigilancia de la versión anterior (`no-debilitar.cjs`, chequeo (i)) compara el catálogo del cambio con el de la base
y **falla** si: se borra un caso sin una entrada en `retiros.json` con su id, cambia lo que un caso espera, se afloja un
estado (`exigido` → `brecha-abierta` → `riesgo-aceptado`) o se mueve más tarde su fecha límite, o se pierde una vía
entera. Un riesgo aceptado o una brecha **nuevos** no bloquean, pero salen como aviso (`nuevo riesgo aceptado: EV-…`).
No compara la `construccion` de cada caso: un cambio ahí se ve en el diff, no en una falla.

## Límites

- Lo que depende de GitHub (protección de `main`, `[skip ci]`, bypass de administradores) no se puede probar desde el
  repositorio: está en `evasiones-github.json` y lo vigila G4.
- Las evasiones que editan la maquinaria (`.github/**`, `arquitectura/**`, `package.json`, configuraciones de pruebas y
  de mutación) pasan hoy sin detección y están como `riesgo-aceptado` por decisión del dueño (§11.1): proceso y
  visibilidad, no una traba técnica.
