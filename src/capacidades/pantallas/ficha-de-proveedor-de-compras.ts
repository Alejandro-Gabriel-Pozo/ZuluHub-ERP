import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «PROVEEDOR» DE COMPRAS (DDD:174: toda pantalla nueva nace con ficha; Compras PR 4). Dos rutas: la ficha del proveedor (`/compras/proveedores/[id]`: ver, editar y pedir) y todas sus
 * facturas y notas (`/compras/proveedores/[id]/facturas`, solo lectura). Se llega desde `/clientes/[id]` con un enlace que solo se dibuja si la parte tiene el rol proveedor. La comprueba
 * `test/web/ficha-de-proveedor-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos. Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. «Qué le compramos» muestra el precio y la fecha de la última compra («Última compra: 14/11/2026 18:30»), sin el « por kg» de la maqueta: la palabra «por» sola no tiene texto aprobado.
 *  2. La hoja de agregar un comprobante no dice «Después solo se puede elegir entre los comprobantes de la ficha»: ese texto aprobado no tiene clave todavía (sí la tiene el del punto de venta).
 *  3. Las filas de «Facturas y notas» no abren la compra: la consulta del servidor no trae el id de la compra de cada factura (hallazgo aparte).
 *  4. Los pedidos pendientes no dicen quién los pidió (la maqueta tampoco): el id de persona no sale al navegador.
 *  5. Sin pedidos pendientes no se dibuja el bloque (sobrio; sin texto de «no hay pedidos»).
 *  6. Quien edita (gerente y administrador) no ve «Pedir»: agrega directamente; quien solo carga compras ve «Pedir» y no ve «Agregar», «Dejar de usar», «Aprobar» ni «Rechazar» (igual que la maqueta).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** El botón apagado o ausente es solo una ayuda: decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeProveedorDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción que exige la lectura de la pantalla. */
  acceso: ClaveAccion;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado (o el texto propio aprobado del proveedor). */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: textos aprobados el 09/11/2026 en el prototipo compra.html («Textos aprobados», ficha del proveedor, pedidos y modales; DEC-0565), reusados con su clave",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra.html (estados proveedor, facturas-prov, pv-pedir, aprobar-pedido, pv-quitar); brief PR-4-ficha-del-proveedor-de-compras.md de Compras (rama de planificación de la Ola 1)",
};
const USO = "apps/web/ui/plantillas/compras/proveedor/";

export const FICHA_DE_PROVEEDOR_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/proveedores/[id]/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/proveedores/[id]/facturas/page.tsx",
    "apps/web/app/s/app/acciones-de-ficha-de-proveedor.ts",
    "apps/web/servidor/ficha-de-proveedor.ts",
    "apps/web/servidor/acciones-de-la-ficha-del-proveedor.ts",
    "apps/web/ui/plantillas/compras/proveedor/BotonDeResolverPedido.cliente.tsx",
    "apps/web/ui/plantillas/compras/proveedor/HojaDeCambioDeFicha.cliente.tsx",
    "apps/web/ui/plantillas/compras/proveedor/HojaDeDejarDeUsar.cliente.tsx",
    "apps/web/ui/plantillas/compras/proveedor/PantallaDeFacturasDelProveedor.tsx",
    "apps/web/ui/plantillas/compras/proveedor/PantallaDeFichaDeProveedor.tsx",
    "apps/web/ui/plantillas/compras/proveedor/modelo-de-ficha-de-proveedor.ts",
    "apps/web/ui/plantillas/compras/proveedor/resultado-de-proveedor.ts",
    "apps/web/ui/plantillas/compras/proveedor/textos-de-proveedor.ts",
    "src/composicion/entradas-de-ficha-de-proveedor.ts",
    "src/composicion/ficha-de-proveedor-web.ts",
  ],
  rutas: ["/compras/proveedores/[id]", "/compras/proveedores/[id]/facturas"],
  titulo: "compras.compra.compras",
  acceso: "recepciones.ver",
  botones: [
    {
      id: "agregar-punto-de-venta",
      texto: "compras.ficha.agregar_punto_de_venta",
      hace: { envia: "proveedores.editar_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "agregar-otro-comprobante",
      texto: "compras.ficha.agregar_otro_comprobante",
      hace: { envia: "proveedores.editar_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "dejar-de-usar",
      texto: "compras.ficha.dejar_de_usar",
      hace: { envia: "proveedores.editar_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "aprobar",
      texto: "compras.ficha.aprobar",
      hace: { envia: "proveedores.editar_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "rechazar",
      texto: "compras.ficha.rechazar",
      hace: { envia: "proveedores.editar_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pedir-punto-de-venta",
      texto: "compras.ficha.pedir_punto_de_venta",
      hace: { envia: "proveedores.pedir_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pedir-otro-comprobante",
      texto: "compras.ficha.pedir_otro_comprobante",
      hace: { envia: "proveedores.pedir_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-pedido",
      texto: "compras.ficha.enviar_pedido",
      hace: { envia: "proveedores.pedir_ficha" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "ver-todas",
      texto: "compras.ficha.ver_todas",
      hace: { navega: "/compras/proveedores/[id]/facturas" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "compras.compra.compras": {
      usos: ["título de la pantalla (el nombre del proveedor lo pone el armazón)"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.datos_del_directorio": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.cuit": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.comprobantes_que_emite": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.por_ser": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.emite": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.condicion_no_define_la_letra": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.ninguno_cargado": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.puntos_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.sin_puntos_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.que_le_compramos": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.todavia_no_se_le_compro_nada": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.ultima_compra": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.facturas_y_notas": {
      usos: [`${USO}textos-de-proveedor.ts`, "enlace desde el directorio"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.todavia_no_tiene_facturas": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.ver_todas": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.orden.anulada": {
      usos: [`${USO}textos-de-proveedor.ts`, "factura anulada"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.agregar_punto_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.agregar_otro_comprobante": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.pedir_punto_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.pedir_otro_comprobante": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.dejar_de_usar": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.pedidos_pendientes": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.pedido_el": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.falta_que_lo_apruebe": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.aprobar": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.rechazar": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.enviar_pedido": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.agregar": { usos: [`${USO}textos-de-proveedor.ts`], fuente: DE_LA_MAQUETA },
    "compras.ficha.se_agrega_a_la_ficha_de": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.despues_solo_se_elige_entre_los_de_la_ficha": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.numero_del_punto_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.pedido_lo_aprueba_quien_administra": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.las_facturas_cargadas_no_cambian": {
      usos: [`${USO}textos-de-proveedor.ts`],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.tipo": {
      usos: [`${USO}textos-de-proveedor.ts`, "selector del comprobante"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.rotulo_punto_de_venta": {
      usos: [`${USO}textos-de-proveedor.ts`, "nombre del pedido"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.cancelar": {
      usos: [`${USO}textos-de-proveedor.ts`, "«Cancelar» de las hojas"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.volver": {
      usos: [`${USO}textos-de-proveedor.ts`, "«Volver»"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.producto.cerrar": {
      usos: [`${USO}textos-de-proveedor.ts`, "nombre accesible del cierre de las hojas"],
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
} as const satisfies FichaDeProveedorDeCompras;
