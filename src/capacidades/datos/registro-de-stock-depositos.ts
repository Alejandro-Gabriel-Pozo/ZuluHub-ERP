import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la pantalla «Depósitos» de stock del registro de datos (ver `registro.ts`), en su propio archivo (uno por pantalla de stock, `pantallas-de-stock-inventario.md` §8):
 * así las cuatro pantallas de stock no tocan las mismas líneas. `registro.ts` los junta con el resto.
 */

const FORMULARIO_DE_DEPOSITO =
  "apps/web/ui/plantillas/stock/depositos/FormularioDeDeposito.cliente.tsx";
const FORMULARIO_DE_EDITAR_DEPOSITO =
  "apps/web/ui/plantillas/stock/depositos/FormularioDeEditarDeposito.cliente.tsx";
const REQUIERE_STOCK = { modulo: "stock", estadoDeEmpresa: ["ACTIVE"] } as const;
const DEPOSITO_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/pantallas-de-stock-inventario.md §3 y §8 (`crearDeposito`, permiso `depositos.crear`), la maqueta aprobada el 09/11/2026 (`stock.html`, «Agregar depósito», carpeta de prototipos de Pedernal-docs 10-ux-ui), 11-especificaciones/decisiones-del-dueno-2026-11.md (fila del 15/11/2026, «Resueltas por el orquestador… Stock», Q2: «De venta» solo para el uso Normal) y, para editar (`editarDeposito`, permiso `depositos.editar`), dia-uno-stock-diseno-2026-11-25.md §3.2 y la maqueta aprobada el 25/11/2026 (`stock-depositos-gestion.html`, fila 444 de decisiones-del-dueno-2026-11.md)",
});

export const DATOS_DE_STOCK_DEPOSITOS = {
  "nombre-de-deposito": {
    ficha: "src/primitivas/texto/nombre-de-eleccion.ts",
    propositos: [
      DEPOSITO_PROPOSITO(
        "Nombre del depósito al agregarlo a la sucursal y al editarlo; único dentro de la sucursal (pantalla «Depósitos»).",
      ),
    ],
    consumidores: [FORMULARIO_DE_DEPOSITO, FORMULARIO_DE_EDITAR_DEPOSITO],
    ponerPor: ["depositos.crear", "depositos.editar"],
    requiere: REQUIERE_STOCK,
  },
  "uso-de-deposito": {
    ficha: "src/modulos/stock/persistencia/modelo.ts",
    propositos: [
      DEPOSITO_PROPOSITO(
        "Uso del depósito (Normal, Cuarentena o Rechazo) al agregarlo; no cambia después (pantalla «Depósitos»).",
      ),
    ],
    consumidores: [FORMULARIO_DE_DEPOSITO],
    ponerPor: ["depositos.crear"],
    requiere: REQUIERE_STOCK,
  },
  "deposito-de-venta": {
    ficha: "src/modulos/stock/casos-de-uso/depositos.ts",
    propositos: [
      DEPOSITO_PROPOSITO(
        "Si el depósito es el del que sale lo que se vende: uno por sucursal y solo de uso Normal; se marca al agregarlo y se puede cambiar al editarlo (pantalla «Depósitos»).",
      ),
    ],
    consumidores: [FORMULARIO_DE_DEPOSITO, FORMULARIO_DE_EDITAR_DEPOSITO],
    ponerPor: ["depositos.crear", "depositos.editar"],
    requiere: REQUIERE_STOCK,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
