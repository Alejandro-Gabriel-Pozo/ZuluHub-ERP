import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE «CORREGIR» Y «ANULAR» UNA COMPRA (DDD:174: toda pantalla nueva nace con ficha; Compras PR 10). Suma a la ficha de la compra (`ficha-de-compras.ts`, de solo lectura) dos acciones de escritura: «Corregir» el
 * precio de una línea (ruta propia `/compras/[id]/corregir/[linea]`) y «Anular» la compra entera (una hoja sobre la ficha). Gerente y administrador (`compras.corregir`, `recepciones.anular`); quien opera no ve los botones.
 * La comprueba `test/web/ficha-de-correccion-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-corregir-anular.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. Solo se corrige el PRECIO de una línea que ya lo tiene: sin «Peso recibido» ni «Cantidad recibida» (orden del dueño del 24/11/2026: corregir cantidad o peso real sigue rechazado por el servidor) y sin completar
 *     una línea «Sin precio» (pide «Precio por», de otro tramo): una línea sin precio no ofrece «Corregir».
 *  2. Sin la vista previa «Entra a tu stock · Costo por unidad de stock · Total de la línea» mientras se escribe: el único calculador es el servidor y no hay consulta que cotice una corrección. El resultado es la propia
 *     ficha, que muestra «Corregido por…», el «Antes» y el motivo en la línea (la maqueta tiene un paso de resultado aparte con «Ver compra»: se evita un paso y un texto).
 *  3. El precio arranca vacío (la maqueta lo precarga): el campo de importe trabaja con dos decimales y un precio guardado con más se recortaría en silencio.
 *  4. El «Corregir» junto al aviso de una compra ya consumida lleva a la primera línea que se puede corregir, no a «la primera consumida»: el servidor rechaza la anulación sin decir qué línea se consumió.
 *  5. Sin «Consumido al corregir» (fuera de la primera versión, como dice la propia maqueta).
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

export type FichaDeCorreccionDeCompras = Readonly<{
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
    "el dueño: maqueta compra-corregir-anular.html aceptada por delegación (filas 173, 174 y 187 de decisiones-del-dueno-2026-11.md) y textos aprobados el 09/11/2026 (compra.html); «Corregir» por delegación, con su fuente en la maqueta",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra-corregir-anular.html (vForm, vResultado, vHoja) y compra.html; brief PR-10-corregir-y-anular-pantalla.md de Compras (rama de planificación de la Ola 1)",
};
const USO = "apps/web/ui/plantillas/compras/";

export const FICHA_DE_CORRECCION_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/[id]/corregir/[linea]/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-correccion-de-compra.ts",
    "apps/web/servidor/correccion-de-compra.ts",
    "apps/web/servidor/ofertas-de-compras.ts",
    "apps/web/ui/plantillas/compras/correccion/FormularioDeCorregirLinea.cliente.tsx",
    "apps/web/ui/plantillas/compras/correccion/HojaDeAnularCompra.cliente.tsx",
    "apps/web/ui/plantillas/compras/correccion/resultado-de-correccion.ts",
    "apps/web/ui/plantillas/compras/ficha/PantallaDeFichaDeCompra.tsx",
    "apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra.ts",
    "src/composicion/correccion-de-compra-web.ts",
    "src/composicion/entradas-de-correccion-de-compra.ts",
  ],
  rutas: ["/compras/[id]", "/compras/[id]/corregir/[linea]"],
  acciones: ["compras.corregir", "recepciones.anular"],
  botones: [
    {
      id: "corregir-linea",
      texto: "compras.correccion.corregir",
      hace: { navega: "/compras/[id]/corregir/[linea]" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-correccion",
      texto: "compras.correccion.corregir",
      hace: { envia: "compras.corregir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "abrir-anular",
      texto: "ventas.ticket.anular",
      hace: { abre: "hoja-de-anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cancelar-anular",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/compras/[id]" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-anulacion",
      texto: "ventas.ticket.anular",
      hace: { envia: "recepciones.anular" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "compras.correccion.corregir": {
      usos: [
        `${USO}textos-de-compras.ts`,
        "botón de cada línea, título del formulario y botón de envío, y botón junto al aviso de compra ya consumida",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.correccion.antes": {
      usos: [`${USO}textos-de-compras.ts`, "«Antes: $ 1.000,00» en la línea corregida"],
      fuente: DE_LA_MAQUETA,
    },
    "cierre.corregido_por": {
      usos: [
        `${USO}textos-de-compras.ts`,
        "«Corregido por {persona} · {cuando}» en la línea corregida",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.anular": {
      usos: [
        `${USO}textos-de-compras.ts`,
        "botón al pie de la ficha, título de la hoja y botón que anula",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.cancelar": {
      usos: ["«Cancelar» de la hoja de anular"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.producto.cerrar": {
      usos: ["nombre accesible del botón de cerrar la hoja de anular"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.motivo": {
      usos: ["rótulo del motivo de corregir y de anular"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.precio_por": {
      usos: ["«Precio por Kilogramo»: rótulo del precio de una línea con «precio por»"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.emitir_precio": {
      usos: ["«Precio»: rótulo del precio de una línea sin «precio por» conocido"],
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
} as const satisfies FichaDeCorreccionDeCompras;
