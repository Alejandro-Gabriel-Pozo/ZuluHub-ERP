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

// La pantalla «Cobrar» (hoja de cobro y resultado). Cada archivo declara qué dato pide; el dato de cada campo y su primitiva (una regla, un lugar) están abajo.
const FILA_DE_COBRO = "apps/web/ui/plantillas/cobrar/FilaDeCobro.cliente.tsx";
const DATOS_DEL_MEDIO = "apps/web/ui/plantillas/cobrar/DatosDelMedio.cliente.tsx";
const ANULAR_EL_TICKET = "apps/web/ui/plantillas/cobrar/AnularElTicket.cliente.tsx";
const FUENTE_DEL_COBRO =
  "Pedernal-docs/11-especificaciones/conceptos/pantalla-cobrar.md y servidor-del-mostrador-minimo.md §7; la maqueta de venta rápida `venta-rapida-v4.html` (zona cobro, carpeta de prototipos de Pedernal-docs 10-ux-ui); decisión 129 (datos opcionales del cobro) y filas 171, 172 y 175 de 11-especificaciones/decisiones-del-dueno-2026-11.md";
const PROPOSITO_DEL_COBRO = (para: string): Proposito => ({ para, fuente: FUENTE_DEL_COBRO });

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
  "importe-de-cobro": {
    ficha: "src/primitivas/dinero/importe.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Importe de cada medio de pago de una venta en la hoja de cobro, en pesos y con coma. La pantalla solo lo escribe; el servidor exige que los importes sumen el total al centavo.",
      ),
    ],
    consumidores: [FILA_DE_COBRO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "cupon-del-cobro": {
    ficha: "src/primitivas/texto/cupon-de-pago.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Cupón u operación, opcional, que se anota al cobrar con tarjeta de débito o de crédito. Nunca el número de la tarjeta.",
      ),
    ],
    consumidores: [DATOS_DEL_MEDIO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "ultimos-cuatro-del-cobro": {
    ficha: "src/primitivas/texto/ultimos-cuatro-digitos.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Últimos 4 dígitos de la tarjeta, opcionales, para reconocer el pago de débito o de crédito.",
      ),
    ],
    consumidores: [DATOS_DEL_MEDIO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "marca-de-tarjeta-del-cobro": {
    ficha: "src/modulos/caja/cobrar/opciones-de-cobro.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Marca de la tarjeta, opcional, elegida de las marcas activas que el servidor ofrece (la lista la administra la plataforma).",
      ),
    ],
    consumidores: [DATOS_DEL_MEDIO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "cuotas-del-cobro": {
    ficha: "src/primitivas/cantidad/cuotas.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Cantidad de cuotas, opcional, de un cobro con tarjeta de crédito. Solo se anota: no calcula intereses ni cambia el importe.",
      ),
    ],
    consumidores: [DATOS_DEL_MEDIO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "dni-del-cobro": {
    // No sirve `documento-de-identidad`: es el del receptor de la factura (propósito y consumidor de facturación). Este es un dato del cobro por transferencia.
    ficha: "src/primitivas/identificacion-fiscal/documento.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "DNI, opcional, de quien paga con transferencia. Dato personal: va solo al cobro, nunca a la auditoría ni a un registro.",
      ),
    ],
    consumidores: [DATOS_DEL_MEDIO],
    ponerPor: ["tickets.cobrar"],
    requiere: REQUIERE_VENTAS,
  },
  "motivo-de-anulacion": {
    // SUPUESTO (DEC-0342, mismo criterio que `nombre-de-medio-de-pago`): la ficha es el dominio de ventas, que ya tiene el largo y la regla del motivo; no se movió a `primitivas/`.
    ficha: "src/modulos/ventas/dominio/motivo.ts",
    propositos: [
      PROPOSITO_DEL_COBRO(
        "Motivo con el que se anula, desde el resultado de cobrar, un ticket recién cobrado (se anula entero; decisión 172).",
      ),
    ],
    consumidores: [ANULAR_EL_TICKET],
    ponerPor: ["tickets.corregir"],
    requiere: REQUIERE_VENTAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
