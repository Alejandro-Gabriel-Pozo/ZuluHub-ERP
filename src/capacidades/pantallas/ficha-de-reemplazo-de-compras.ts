import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «REEMPLAZAR EL COMPROBANTE» (DDD:174: toda pantalla nueva nace con ficha; NOTAS-2c-2). Una pantalla con dos entradas: reemplazar una factura que llega sola (`/compras/facturas/[id]/reemplazar`, N3/N4) y
 * cambiar el comprobante de una compra (`/compras/[id]/cambiar-comprobante`, N1/N2; pantalla 11 de la maqueta de Diseño 2), más los dos enlaces que la abren (en el detalle de la factura y en la ficha de la compra). La comprueba
 * `test/web/ficha-de-reemplazo-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos. Previene: un botón o un texto que nadie aprobó, y una ruta que se mueve sin que la ficha lo note.
 *
 * SUPUESTOS (aceptados por el orquestador el 26/11/2026, costo de revertir bajo):
 *  1. Una sola pantalla con dos entradas (no dos pantallas).
 *  2. «Pago» es la única etiqueta del primer paso sin parecido aprobado (DEC-COM-015); «Conciliaciones» y «Notas de la factura» reutilizan textos aprobados. Los frenos no llevan texto propio: el servidor los vuelve a revalidar
 *     al enviar y el error sale con el mensaje genérico.
 *  3. El pago de una factura que llega sola (N3/N4) no tiene pantalla propia hoy: su paso va sin enlace.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** Sin permiso el botón no se ofrece (denegar por defecto); el servidor vuelve a decidir al actuar. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeReemplazoDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** Las acciones que exige la lectura de cada ruta. */
  accesos: Readonly<Record<string, readonly ClaveAccion[]>>;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"SIN_PERMISO" | "ERROR", ClaveDeTexto>>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DELEGADO: FuenteDeTexto = {
  decidio:
    "el dueño por delegación: el orquestador aceptó las etiquetas simples el 26/11/2026 (fila 173, DEC-COM-015); el motivo precargado y el aviso del costo del stock son del dueño (P-1 del 26/11/2026, DEC-COM-016)",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md (filas 173 y 174 y respuesta P-1 del 26/11/2026); aprobación de NOTAS-2c-2 del orquestador (26/11/2026)",
};
const USO = "apps/web/ui/plantillas/compras/reemplazo/";

export const FICHA_DE_REEMPLAZO_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/facturas/[id]/reemplazar/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/[id]/cambiar-comprobante/page.tsx",
    "apps/web/app/s/app/acciones-de-reemplazo.ts",
    "apps/web/servidor/reemplazo.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    "apps/web/ui/plantillas/compras/reemplazo/FormularioDeReemplazar.cliente.tsx",
    "apps/web/ui/plantillas/compras/reemplazo/PantallaDeReemplazo.tsx",
    "apps/web/ui/plantillas/compras/reemplazo/modelo-de-reemplazo.ts",
    "apps/web/ui/plantillas/compras/reemplazo/textos-de-reemplazo.ts",
    "src/composicion/entradas-de-reemplazo.ts",
    "src/composicion/reemplazo-web.ts",
  ],
  rutas: ["/compras/facturas/[id]/reemplazar", "/compras/[id]/cambiar-comprobante"],
  accesos: {
    "/compras/facturas/[id]/reemplazar": ["comprobantes_de_proveedor.reemplazar"],
    "/compras/[id]/cambiar-comprobante": [
      "comprobantes_de_proveedor.reemplazar",
      "comprobantes_de_proveedor.anular",
      "comprobantes_de_proveedor.registrar",
    ],
  },
  botones: [
    {
      id: "reemplazar-la-factura",
      texto: "compras.orden.reemplazar",
      hace: { envia: "comprobantes_de_proveedor.reemplazar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cambiar-el-comprobante-de-la-compra",
      texto: "compras.reemplazo.cambiar_comprobante",
      hace: { envia: "comprobantes_de_proveedor.reemplazar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enlace-a-reemplazar",
      texto: "compras.orden.reemplazar",
      hace: { navega: "/compras/facturas/[id]/reemplazar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enlace-a-cambiar-el-comprobante",
      texto: "compras.reemplazo.cambiar_comprobante",
      hace: { navega: "/compras/[id]/cambiar-comprobante" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { SIN_PERMISO: "compras.error.sin_permiso", ERROR: "compras.error.sin_permiso" },
  textos: {
    "compras.reemplazo.titulo": {
      usos: [`${USO}textos-de-reemplazo.ts`, "título de «Reemplazar el comprobante»"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.que_deshacer_antes": {
      usos: ["rótulo del primer paso: lo que el servidor dice que hay que deshacer"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.comprobante_nuevo": {
      usos: ["rótulo del segundo paso: el comprobante nuevo"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.cambiar_comprobante": {
      usos: ["botón del formulario y enlace de la ficha de la compra (N1/N2)"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.pago": {
      usos: ["rótulo del paso «el pago vigente»"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.motivo_por_defecto": {
      usos: ["motivo precargado con el número de la factura nueva (editable y obligatorio)"],
      fuente: DELEGADO,
    },
    "compras.reemplazo.costo_no_cambia": {
      usos: ["aviso cuando el importe de la nueva difiere del de la original"],
      fuente: DELEGADO,
    },
    "compras.orden.reemplazar": {
      usos: ["botón del formulario y enlace del detalle de la factura (N3/N4)"],
      fuente: DELEGADO,
    },
    "compras.conciliacion.conciliaciones": {
      usos: ["rótulo del paso «las conciliaciones vivas»"],
      fuente: DELEGADO,
    },
    "compras.notas.titulo": {
      usos: ["rótulo del paso «las notas vigentes»"],
      fuente: DELEGADO,
    },
    "ventas.ticket.motivo": { usos: ["rótulo del campo del motivo"], fuente: DELEGADO },
    "compras.error.sin_permiso": {
      usos: ["cualquier error de la pantalla (el genérico, interfaz sobria)"],
      fuente: DELEGADO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeReemplazoDeCompras;
