import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de «Qué consume» cada opción de un grupo (A13, tramo Consumo), en su propio archivo para que `registro-de-productos.ts` no pase el tope de líneas por archivo: solo
 * cambia la ubicación respecto de los demás datos del catálogo. `registro.ts` los junta con el resto.
 */

const REQUIERE_CATALOGO = { modulo: "catalogo", estadoDeEmpresa: ["ACTIVE"] } as const;
const FORMULARIO_DE_CONSUMO =
  "apps/web/ui/plantillas/catalogo/FormularioDeConsumoDeUnGrupo.cliente.tsx";
const CONSUMO_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/pantallas-de-catalogo-restante-inventario.md §2.4 (`guardarConsumoDeGrupo`, permiso `opciones.editar`), conceptos/escala-con-la-medida-y-consumo-por-opcion.md y la maqueta aprobada el 12/11/2026 (`productos.html`, función `vConsumo`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});
export const DATOS_DE_CONSUMO_DE_OPCION = {
  "insumo-de-consumo-de-opcion": {
    // Una referencia a un producto activo de la empresa que se puede consumir (materia prima, insumo, reventa o elaborado): la fuente de la lista es `productosParaConsumo`.
    ficha: "src/modulos/catalogo/consultas/consultas.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Insumo que consume una opción cuando se elige: uno de los productos de la empresa que se consumen (materia prima, insumo, reventa o elaborado), sin repetir dentro de la opción.",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "cantidad-de-consumo-de-opcion": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Cuánto consume una opción de un insumo, en la unidad base del insumo: mayor que cero y hasta cuatro decimales.",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "escala-con-la-medida-de-consumo": {
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Si la cantidad que consume una opción se multiplica por el factor de la medida elegida (solo si el producto tiene una variante que es la medida).",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
