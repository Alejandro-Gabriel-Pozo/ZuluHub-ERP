import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE «NUEVA COMPRA» (DDD:174: toda pantalla nueva nace con ficha; Compras PR 6b). Una ruta que ESCRIBE: cargar y recibir una compra de una vez (`/compras/nueva`). Es solo una declaración: la
 * comprueba `test/web/ficha-de-nueva-compra.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra.html`, estado `nueva`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. Sin «Pedir»: pide una orden de compra, que es de N4 (fase 5, pausada). Sin «Cambiar» en «Cómo se compra»: es un selector (la maqueta abre una hoja; el selector es el patrón de la aplicación).
 *  2. SIN PRESENTACIONES («caja de 12»): se compra en la unidad base del producto o en otra de su misma dimensión, porque hoy no hay pantalla de Catálogo para crearlas (dueño, 23/11/2026, pregunta 6 del
 *     plan de compras: aprobada la recomendación). Por eso tampoco hay «Peso recibido», «Falta pesar» ni «se confirma al pesar» (son de las cajas de peso variable, que son presentaciones).
 *  3. «Entra a tu stock» y «Costo por unidad de stock» se muestran ANTES de guardar, con la cuenta del servidor (`cotizarCompra`), no con una cuenta de la pantalla (dueño, 23/11/2026, pregunta 7).
 *  4. El remito se carga en esta misma pantalla, antes de «Comprar y recibir» (la maqueta lo pide en una segunda pantalla, «Recibir»): el brief PR-6 lo pone como un paso de la misma pantalla y evita
 *     una pantalla intermedia sin función propia en la primera versión.
 *  5. «Agregar proveedor» es un botón debajo del buscador y no la última opción del desplegable (el proveedor se elige buscando, no con un desplegable: la lista del directorio no cabe en uno).
 *  6. «Agregar producto» es un buscador (la maqueta lo dibuja como un desplegable con todos los productos); mismo texto aprobado. Sin «Agregar producto nuevo»: para un producto nuevo se usa el alta de Catálogo.
 *  7. Cada renglón lleva «Quitar» (la maqueta no lo dibuja): reusa el texto ya aprobado de ventas y catálogo; respuesta del orquestador por delegación de textos (DDD:173), 24/11/2026.
 *  8. Con más de un depósito de uso normal en la sucursal aparece un selector rotulado «Depósito» (singular de «Depósitos», aceptado por delegación el 24/11/2026; DEC-0864).
 *  Compras PR 7, la factura («Con factura», DEC-0895; orden del orquestador del 24/11/2026; el dueño las ve en el PR):
 *  9. La factura se carga en un BLOQUE de esta misma pantalla, solo si la empresa compra «Con factura» (lo dice `nivelParaComprar`), y no en una pantalla aparte desde una compra ya recibida: ese es el flujo de recepción
 *     separada (N3, fase 5 pausada). Un solo envío idempotente para la compra y la factura; sin factura no se guarda.
 * 10. Cada línea de la factura corresponde a un renglón de la compra y va en la unidad base; cantidad y precio neto se precargan del renglón y se ajustan. El «Precio neto» admite hasta 4 decimales (los de la cantidad;
 *     el dominio acepta 6): SUPUESTO (DEC-0895), revertir es una regla de campo.
 * 11. Sin «Condición frente al IVA» del proveedor nuevo (la maqueta la pide junto al CUIT): solo el CUIT, que el brief PR-7 declara; sin importes por alícuota («Neto 21 %», «IVA 21 %»: sin texto aprobado) y sin el aviso
 *     de la letra esperada en vivo («Este proveedor emite»): ese aviso lo sabe el servidor al guardar. Interfaz sobria.
 * 12. «Exento» y «No gravado» son dos opciones (textos ya aprobados) y no una sola «Exento o no gravado» de la maqueta: el dominio las distingue (alícuotas EXENTO y NO_GRAVADO) y una sola opción no sabría cuál guardar.
 * 13. «Factura A», «Factura B» y «Factura C» (el selector «Tipo») salen del arreglo `TIPOS` de la maqueta y NO figuran en sus «Textos aprobados»: quedan SIN APROBAR hasta que el dueño los acepte (DEC-0896).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** Sin permiso el botón no se ofrece (todo nace cerrado); el servidor vuelve a decidir al enviar. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeNuevaCompra = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  estados: Readonly<
    Record<"VACIA" | "SIN_PERMISO" | "RECHAZADA" | "SIN_CONEXION" | "VERIFICANDO", ClaveDeTexto>
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: textos del prototipo aprobado de compras (09/11/2026, compra.html, «Textos aprobados») y sus respuestas del 23/11/2026 a las preguntas 6 y 7 del plan de compras; los reusados de otro módulo tienen el mismo texto y ya traen su fuente en su catálogo",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra.html (estados nueva, como, remito, prov-nuevo, prov-repetido, sinconexion); 11-especificaciones/compras-siguientes-tramos-2026-11-23.md §4; brief PR-6 de Compras",
};
const SIN_APROBAR: FuenteDeTexto = {
  decidio:
    "SIN APROBAR por el dueño: rótulos del arreglo TIPOS de la maqueta compra.html, que no figuran en sus «Textos aprobados» (término fiscal; DEC-0896); el orquestador los acepta para construir y los lleva al dueño",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra.html (arreglo TIPOS del estado factura); brief PR-7-factura-en-la-compra.md de Compras",
};
const USO = "apps/web/ui/plantillas/compras/nueva/";

export const FICHA_DE_NUEVA_COMPRA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/nueva/page.tsx",
    "apps/web/app/s/app/acciones-de-comprar.ts",
    "apps/web/servidor/comprar.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    `${USO}PantallaDeNuevaCompra.cliente.tsx`,
    `${USO}TarjetaDeRenglon.cliente.tsx`,
    `${USO}HojaDeNuevoProveedor.cliente.tsx`,
    `${USO}modelo-de-nueva-compra.ts`,
    `${USO}modelo-de-factura.ts`,
    `${USO}BloqueDeFactura.cliente.tsx`,
    `${USO}textos-de-nueva-compra.ts`,
    `${USO}useEnvioDeLaCompra.cliente.tsx`,
    `${USO}useLecturaDemorada.ts`,
    "apps/web/ui/componentes/BuscadorEnLista.tsx",
    "src/composicion/comprar-web.ts",
    "src/composicion/entradas-de-comprar.ts",
  ],
  rutas: ["/compras/nueva"],
  botones: [
    {
      id: "comprar-y-recibir",
      texto: "compras.compra.comprar_y_recibir",
      hace: { envia: "recepciones.registrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "quitar-renglon",
      texto: "catalogo.accion.quitar",
      hace: { navega: "/compras/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "agregar-proveedor",
      texto: "compras.ficha.agregar_proveedor",
      hace: { envia: "partes.crear" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-proveedor",
      texto: "compras.ficha.agregar",
      hace: { envia: "partes.crear" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cancelar-proveedor",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/compras/nueva" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: {
    VACIA: "compras.compra.nueva_compra",
    SIN_PERMISO: "compras.error.sin_permiso",
    RECHAZADA: "compras.error.sin_permiso",
    SIN_CONEXION: "conexion.no_se_puede_enviar",
    VERIFICANDO: "conexion.verificando",
  },
  textos: {
    "compras.factura.comprobante": {
      usos: ["título del bloque de la factura"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.tipo": { usos: ["rótulo del tipo de factura"], fuente: DE_LA_MAQUETA },
    "compras.factura.fecha_de_la_factura": {
      usos: ["rótulo de la fecha de la factura"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.vencimiento_de_pago": {
      usos: ["rótulo del vencimiento de pago"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.cantidad_facturada": {
      usos: ["rótulo de la cantidad de cada línea de la factura"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.precio_neto": {
      usos: ["rótulo del precio neto de cada línea"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.iva": {
      usos: ["rótulo de la alícuota de cada línea de una factura A"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.neto_de_la_linea": {
      usos: ["neto de cada línea, calculado por el servidor"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.sin_iva_discriminado": {
      usos: ["línea de una factura B o C"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.percepciones": { usos: ["rótulo de las percepciones"], fuente: DE_LA_MAQUETA },
    "compras.factura.total_calculado": {
      usos: ["total que calculó el servidor"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.total_segun_la_factura": {
      usos: ["total que dice el papel"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.total_coincide": { usos: ["aviso: el total coincide"], fuente: DE_LA_MAQUETA },
    "compras.error.total_no_coincide": {
      usos: ["aviso: el total no coincide, se carga igual"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.cuit": {
      usos: ["rótulo del CUIT en la primera factura de un proveedor sin CUIT"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.alicuota.21": { usos: ["opción de alícuota 21 %"], fuente: DE_LA_MAQUETA },
    "catalogo.alicuota.10_5": { usos: ["opción de alícuota 10,5 %"], fuente: DE_LA_MAQUETA },
    "catalogo.alicuota.27": { usos: ["opción de alícuota 27 %"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.anular_alicuota_exento": {
      usos: ["opción de alícuota Exento"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.anular_alicuota_no_gravado": {
      usos: ["opción de alícuota No gravado"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.tipo_factura_a": {
      usos: ["opción «Factura A» del tipo de factura"],
      fuente: SIN_APROBAR,
    },
    "compras.factura.tipo_factura_b": {
      usos: ["opción «Factura B» del tipo de factura"],
      fuente: SIN_APROBAR,
    },
    "compras.factura.tipo_factura_c": {
      usos: ["opción «Factura C» del tipo de factura"],
      fuente: SIN_APROBAR,
    },
    "compras.compra.nueva_compra": {
      usos: ["título de la pantalla y estado sin productos"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.proveedor": {
      usos: ["etiqueta del buscador de proveedores"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.agregar_proveedor": {
      usos: ["botón y título de la hoja del alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.ya_existe_un_proveedor_con_ese_nombre": {
      usos: ["aviso del alta de proveedor: no bloquea"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.ficha.agregar": {
      usos: ["botón de la hoja del alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.cancelar": {
      usos: ["cierra la hoja del alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.producto.cerrar": {
      usos: ["cerrar la hoja del alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "clientes.lista.persona": { usos: ["opción del alta de proveedor"], fuente: DE_LA_MAQUETA },
    "clientes.lista.empresa": { usos: ["opción del alta de proveedor"], fuente: DE_LA_MAQUETA },
    "catalogo.dato.nombre": {
      usos: ["nombre de una persona en el alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "clientes.lista.razon_social": {
      usos: ["nombre de una empresa en el alta de proveedor"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.seccion.agregar_producto": {
      usos: ["etiqueta del buscador de productos («Agregar producto»)"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.como_se_compra": {
      usos: ["selector de la unidad de compra"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.cantidad": { usos: ["cantidad de un renglón"], fuente: DE_LA_MAQUETA },
    "compras.compra.precio_por": {
      usos: ["selector de la unidad del precio"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.emitir_precio": { usos: ["precio de un renglón"], fuente: DE_LA_MAQUETA },
    "compras.compra.entra_a_tu_stock": {
      usos: ["lo que entra al stock, calculado por el servidor"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.costo_por_unidad_de_stock": {
      usos: ["costo por unidad de stock, calculado por el servidor"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.precio.sin_precio": {
      usos: ["importe y costo de un renglón sin precio"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.remito_del_proveedor": {
      usos: ["título del remito"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.rotulo_punto_de_venta": {
      usos: ["punto de venta del remito"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.numero": { usos: ["número del remito"], fuente: DE_LA_MAQUETA },
    "compras.recepcion.fecha_del_remito": { usos: ["fecha del remito"], fuente: DE_LA_MAQUETA },
    "catalogo.accion.quitar": { usos: ["saca un renglón de la compra"], fuente: DE_LA_MAQUETA },
    "compras.compra.deposito": {
      usos: ["selector del depósito, solo con más de uno de uso normal"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.dato.sin_elegir": {
      usos: ["opción vacía del selector de depósito"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.comprar_y_recibir": {
      usos: ["botón que guarda la compra"],
      fuente: DE_LA_MAQUETA,
    },
    "conexion.enviando": { usos: ["botón mientras envía"], fuente: DE_LA_MAQUETA },
    "estado.reintentar": { usos: ["reintento con la misma clave"], fuente: DE_LA_MAQUETA },
    "catalogo.lista.sin_resultados": {
      usos: ["buscadores sin coincidencias"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.buscar.resultados": {
      usos: ["cantidad de resultados de un buscador"],
      fuente: DE_LA_MAQUETA,
    },
    "vidriera.buscar.un_resultado": {
      usos: ["un resultado de un buscador"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.sin_permiso": { usos: ["error genérico"], fuente: DE_LA_MAQUETA },
    "conexion.no_se_puede_enviar": {
      usos: ["motivo del botón sin conexión"],
      fuente: DE_LA_MAQUETA,
    },
    "conexion.verificando": { usos: ["resultado incierto: se verifica"], fuente: DE_LA_MAQUETA },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeNuevaCompra;
