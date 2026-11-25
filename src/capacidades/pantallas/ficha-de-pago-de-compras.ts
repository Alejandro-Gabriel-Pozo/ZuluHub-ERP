import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE «DECLARAR PAGO» Y ANULAR EL PAGO DE UNA FACTURA (DDD:174: toda pantalla nueva nace con ficha; Compras PR 8). Suma a la ficha de la compra (`ficha-de-compras.ts`, `ficha-de-correccion-de-compras.ts`) el pago de la
 * factura: «Declarar pago» (ruta propia `/compras/[id]/pago`, con fecha, medio y, con efectivo, la caja de la que sale la plata y el motivo del egreso) y «Anular» el pago (una hoja sobre la ficha, con motivo). Un pago por factura,
 * por el total (el importe NO es un campo: lo copia el servidor), sin parciales: el pago a cuenta, el anticipo y las retenciones son de la cuenta de proveedores y no se anticipan acá. Gerente y administrador
 * (`comprobantes_de_proveedor.pagar` y `.anular_pago`); quien opera ve el pago sin botones. La comprueba `test/web/ficha-de-pago-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-pago.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. Las cajas que se ofrecen son SOLO las abiertas de la sucursal de la sesión (de `estadoDeLaCaja`): una caja en cierre o sin sesión no se ofrece, porque el servidor la rechazaría. La maqueta no distingue.
 *  2. «Total con IVA» de la tarjeta de la factura se dice «Total» (`fiscal.pantalla.rotulo_total`, aceptado por el orquestador, 24/11/2026): no hay texto aprobado con ese nombre exacto.
 *  3. Sin el estado «Doble toque» como pantalla: el botón queda apagado mientras corre el pedido y el servidor repite el mismo pago por la clave del intento (lo prueban la integración y el recorrido).
 *  4. Un pago en efectivo exige caja también en el servidor (DEC-0890, dueño 16/11/2026, 3A): el servidor ya no admite efectivo sin caja.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace:
    Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }> | Readonly<{ abre: string }>;
  /** El botón apagado o ausente es solo una ayuda: decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDePagoDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** Las acciones de permiso que exigen los botones. */
  acciones: readonly ClaveAccion[];
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: maqueta compra-pago.html aceptada por delegación (filas 173, 174 y 187 de decisiones-del-dueno-2026-11.md); «Declarar pago» elegido por el dueño el 16/11/2026 (2A, fila 188); el pago, sobre el pago actual: fila del 23/11/2026, pregunta 3",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra-pago.html (estados «Por pagar», «Declarar pago», «Pagada», «Anular el pago», «Pago anulado») y compra.html; brief PR-8-pago-de-una-factura.md de Compras (rama de planificación de la Ola 1)",
};
const USO = "apps/web/ui/plantillas/compras/";

export const FICHA_DE_PAGO_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/[id]/pago/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-pago-de-factura.ts",
    "apps/web/servidor/pago-de-factura.ts",
    "apps/web/servidor/ofertas-de-compras.ts",
    "apps/web/ui/plantillas/compras/pago/FormularioDeDeclararPago.cliente.tsx",
    "apps/web/ui/plantillas/compras/pago/HojaDeAnularPago.cliente.tsx",
    "apps/web/ui/plantillas/compras/pago/modelo-de-pago.ts",
    "apps/web/ui/plantillas/compras/pago/resultado-de-pago.ts",
    "apps/web/ui/plantillas/compras/ficha/PantallaDeFichaDeCompra.tsx",
    "apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra.ts",
    "src/composicion/pago-de-factura-web.ts",
    "src/composicion/entradas-de-pago-de-factura.ts",
  ],
  rutas: ["/compras/[id]", "/compras/[id]/pago"],
  acciones: ["comprobantes_de_proveedor.pagar", "comprobantes_de_proveedor.anular_pago"],
  botones: [
    {
      id: "declarar-pago",
      texto: "compras.pago.declarar",
      hace: { navega: "/compras/[id]/pago" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-pago",
      texto: "compras.pago.declarar",
      hace: { envia: "comprobantes_de_proveedor.pagar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "abrir-anular-pago",
      texto: "ventas.ticket.anular",
      hace: { abre: "hoja-de-anular-pago" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cancelar-anular-pago",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/compras/[id]" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-anulacion-de-pago",
      texto: "ventas.ticket.anular",
      hace: { envia: "comprobantes_de_proveedor.anular_pago" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "compras.pago.declarar": {
      usos: [
        `${USO}textos-de-compras.ts`,
        "botón de la ficha, título del formulario y botón de envío",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.rotulo_fecha": {
      usos: ["«Fecha» del pago (trae la de hoy) y la del pago en la ficha"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.medio": {
      usos: ["rótulo «Medio» del formulario del pago"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.medios.tipo.efectivo": { usos: ["opción «Efectivo» del medio"], fuente: DE_LA_MAQUETA },
    "caja.medios.tipo.tarjeta_debito": {
      usos: ["opción «Tarjeta de débito» del medio"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.medios.tipo.tarjeta_credito": {
      usos: ["opción «Tarjeta de crédito» del medio"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.medios.tipo.transferencia": {
      usos: ["opción «Transferencia» del medio"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.medios.tipo.qr": { usos: ["opción «QR» del medio"], fuente: DE_LA_MAQUETA },
    "caja.medios.tipo.otro": { usos: ["opción «Otro» del medio"], fuente: DE_LA_MAQUETA },
    "caja.pantalla.titulo": {
      usos: ["«Caja»: selector de la caja de la que sale el efectivo (solo con efectivo)"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.importe": {
      usos: ["«Importe»: el total de la factura que se paga (no es un campo)"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.dato.sin_elegir": {
      usos: ["opción vacía del medio y de la caja"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.estado.anulado": {
      usos: ["«Anulado»: un pago anulado en la ficha"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.anular": {
      usos: ["botón del pago, título de la hoja y botón que anula el pago"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.motivo": {
      usos: ["rótulo del motivo del egreso de caja y del motivo de anular el pago"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.cancelar": {
      usos: ["«Cancelar» de la hoja de anular el pago"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.producto.cerrar": {
      usos: ["nombre accesible del botón de cerrar la hoja de anular el pago"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.sin_permiso": {
      usos: [
        "cualquier rechazo del servidor y quien no tiene permiso (el genérico, interfaz sobria)",
      ],
      fuente: DE_LA_MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePagoDeCompras;
