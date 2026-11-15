import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del módulo ventas del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen las mismas líneas. Un dato no
 * puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). El tipo admite UN solo módulo por dato (`requiere.modulo`): por eso la cantidad de la venta es un
 * dato propio de ventas y no un propósito más de la `cantidad` de facturación.
 */

const REQUIERE_VENTAS = { modulo: "ventas", estadoDeEmpresa: ["ACTIVE"] } as const;
const HOJA = "apps/web/ui/plantillas/venta/HojaDeProducto.cliente.tsx";
// La prueba del componente de elección arma el campo suelto: es el único lugar fuera de la hoja que lo pide.
const PRUEBA_DEL_GRUPO = "apps/web/ui/componentes/GrupoDeOpciones.test.tsx";
const CONTROL_DE_CANTIDAD = "apps/web/ui/plantillas/venta/ControlDeCantidad.cliente.tsx";
const FUENTE_DE_LA_VENTA =
  "Pedernal-docs/11-especificaciones/servidor-del-mostrador-minimo.md §7 y la maqueta de venta rápida `venta-rapida-v4.html` (carpeta de prototipos de Pedernal-docs 10-ux-ui), tabla «Campos y sus datos»; decisiones 162 y 166 (cantidad: decimal exacto con paso mínimo) y fila 171 de 11-especificaciones/decisiones-del-dueno-2026-11.md";
const PROPOSITO = (para: string): Proposito => ({ para, fuente: FUENTE_DE_LA_VENTA });

export const DATOS_DE_VENTAS = {
  "cantidad-de-venta": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      PROPOSITO(
        "Cantidad de un producto en la hoja de la venta rápida al agregarlo a la cuenta: el entero o el decimal del producto (por unidad, por fracciones o por peso). La pantalla solo arma el texto; el servidor valida que sea mayor que cero, de hasta 4 decimales, de hasta 9999 y múltiplo exacto del paso.",
      ),
      PROPOSITO(
        "Cantidad de una línea ya agregada a la cuenta de la venta rápida: se corrige escribiéndola (sin botones − ni +).",
      ),
    ],
    consumidores: [CONTROL_DE_CANTIDAD],
    ponerPor: ["cuentas.agregar_linea"],
    requiere: REQUIERE_VENTAS,
  },
  "eleccion-de-opcion-de-venta": {
    // Sin primitiva: es la elección de uno o varios ids dentro de los grupos que el servidor ofrece (lista cerrada del servidor, como `medio-de-cobro` en el inventario). La ficha es el caso que arma
    // el menú de lo que se ofrece; la pantalla solo manda los ids elegidos y el servidor vuelve a validar que correspondan al producto.
    ficha: "src/modulos/catalogo/casos-de-uso/productos-para-vender.ts",
    propositos: [
      PROPOSITO(
        "Medida y opciones de un producto en la hoja de la venta rápida: una medida (si el producto la tiene) y, por grupo, una opción o varias, de las que el servidor ofrece para la sucursal.",
      ),
    ],
    consumidores: [HOJA, PRUEBA_DEL_GRUPO],
    ponerPor: ["cuentas.agregar_linea"],
    requiere: REQUIERE_VENTAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
