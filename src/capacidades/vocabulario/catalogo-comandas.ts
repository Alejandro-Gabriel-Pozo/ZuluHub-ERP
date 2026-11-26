import type { UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos del módulo `comandas` (prefijo `comandas.`, E7 §10). Ninguno es nuevo: todos salen de los prototipos que el dueño aprobó el 09/11/2026
 * (D115) y de la decisión 181 (cantidad en papel, que no es un texto sino una regla del dominio). La fuente de cada grupo está en su comentario
 * (`10-ux-ui/prototipos-gastronomia/`, repositorio de documentos). «Copia» reemplaza a «REIMPRESIÓN» (D120). Un plato en espera se marca en el papel con «Sale después» (`salida.html`, aprobado), que vive en el dominio del papel.
 */

// Dónde se usan los textos de la pantalla «Impresoras» y del botón «Imprimir» (S-2; fila 173 de `decisiones-del-dueno-2026-11.md`) y de dónde salen: la maqueta `imprimir.html`, aprobada por el dueño el 09/11/2026,
// aceptada sin cambios (DEC-0715). Los demás textos de este módulo todavía no declaran sus usos: lo hace el tramo que los construye (S-4, S-5, S-7).
const MODELO_DE_IMPRESORAS = "apps/web/ui/plantillas/salon/modelo-de-impresoras.ts";
const USO_EN_LA_LISTA: UsoDeTexto = {
  como: "FUNCION",
  archivo: MODELO_DE_IMPRESORAS,
  nombre: "armarLaListaDeImpresoras",
};
const USO_EN_EL_FORMULARIO: UsoDeTexto = {
  como: "FUNCION",
  archivo: MODELO_DE_IMPRESORAS,
  nombre: "armarElFormularioDeImpresora",
};
const USO_EN_EL_TEXTO_DEL_USO: UsoDeTexto = {
  como: "FUNCION",
  archivo: MODELO_DE_IMPRESORAS,
  nombre: "textoDelUso",
};
const USO_EN_EL_MENU: UsoDeTexto = {
  como: "FUNCION",
  archivo: "apps/web/ui/navegacion/menu.ts",
  nombre: "FILAS_DEL_MENU",
};
const RUTA_DE_PAGINAS = "apps/web/app/s/app/(operacion)/salon/impresoras";
const USO_EN_LA_PAGINA_DE_LA_LISTA: UsoDeTexto = {
  como: "FUNCION",
  archivo: `${RUTA_DE_PAGINAS}/page.tsx`,
  nombre: "PaginaDeLaListaDeImpresoras",
};
const USO_EN_LA_PAGINA_DE_LA_EDICION: UsoDeTexto = {
  como: "FUNCION",
  archivo: `${RUTA_DE_PAGINAS}/[id]/page.tsx`,
  nombre: "PaginaDeLaImpresora",
};
const USO_EN_LA_PAGINA_DEL_ALTA: UsoDeTexto = {
  como: "FUNCION",
  archivo: `${RUTA_DE_PAGINAS}/nueva/page.tsx`,
  nombre: "PaginaDeLaImpresoraNueva",
};
const USO_EN_EL_BOTON_DE_IMPRIMIR: UsoDeTexto = {
  como: "FUNCION",
  archivo: "apps/web/ui/patrones/papel/textos-de-imprimir.ts",
  nombre: "armarLosTextosDeImprimir",
};
const FUENTE_DE_IMPRIMIR = { decision: "DEC-0715" } as const;

export const TEXTOS_DE_COMANDAS = {
  // salon.html:312-337, Motor2: grupo «Envío».
  "comandas.texto.envio_enviar_a_cocina": { porDefecto: "Enviar a cocina" },
  "comandas.texto.envio_envio_n": { porDefecto: "Envío N" },
  "comandas.texto.envio_enviado_a_cocina": { porDefecto: "Enviado a cocina" },
  "comandas.texto.envio_reimprimir": { porDefecto: "Reimprimir" },
  "comandas.texto.envio_item_anulado": { porDefecto: "Ítem anulado" },

  // salon.html:312-337: grupo «Anulación».
  "comandas.texto.anulacion_anular": { porDefecto: "Anular" },
  "comandas.texto.anulacion_motivo": { porDefecto: "Motivo" },
  "comandas.texto.anulacion_cancelar": { porDefecto: "Cancelar" },
  "comandas.texto.anulacion_anulo": { porDefecto: "Anuló" },
  "comandas.texto.anulacion_quedan": { porDefecto: "Quedan" },

  // SAL-G (maqueta de notas libres aprobada por el dueño el 25/11/2026; DEC-SAL-006): el rótulo del campo de la nota de un plato, en la hoja de producto y en la ficha de la mesa (sin ayuda del largo).
  "comandas.texto.nota_nota_para_la_cocina": { porDefecto: "Nota para la cocina" },

  // salida.html:256-260: grupo «Orden de salida».
  "comandas.texto.salida_sale_ahora": { porDefecto: "Sale ahora" },
  "comandas.texto.salida_sale_despues": { porDefecto: "Sale después" },
  "comandas.texto.salida_cuando_sale": { porDefecto: "Cuándo sale" },
  "comandas.texto.salida_para_enviar": { porDefecto: "Para enviar" },
  "comandas.texto.salida_esperan_para_despues": { porDefecto: "Esperan para después" },
  "comandas.texto.salida_enviadas": { porDefecto: "Enviadas" },
  "comandas.texto.salida_pedir_que_salga": { porDefecto: "Pedir que salga" },
  "comandas.texto.salida_pedir_que_salga_todo": { porDefecto: "Pedir que salga todo" },
  "comandas.texto.salida_piden_que_salga": { porDefecto: "Piden que salga" },
  "comandas.texto.salida_salen_despues": { porDefecto: "Salen después" },
  "comandas.texto.salida_hay_platos_sin_pedir": { porDefecto: "Hay platos sin pedir" },
  // salida.html:256-260 y imprimir.html:300: el mismo «Quitar» (un texto, un lugar); por ahora lo usa la lista de impresoras (S-2), y el orden de salida (S-4) suma su uso cuando lo construya.
  "comandas.texto.salida_quitar": {
    porDefecto: "Quitar",
    usos: [USO_EN_LA_LISTA],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.salida_sin_platos": { porDefecto: "Sin platos" },

  // salon.html:312-337; imprimir.html:299 (D120): grupo «Papel».
  "comandas.texto.papel_comanda": { porDefecto: "COMANDA" },
  "comandas.texto.papel_cocina": { porDefecto: "COCINA" },
  "comandas.texto.papel_anulacion": { porDefecto: "ANULACIÓN" },
  "comandas.texto.papel_no_preparar": { porDefecto: "NO PREPARAR" },
  "comandas.texto.papel_tomo": { porDefecto: "Tomó" },
  "comandas.texto.papel_sin_precios": { porDefecto: "Sin precios" },
  "comandas.texto.papel_copia": { porDefecto: "Copia" },

  // salon.html:329 (la pantalla espera a E5): grupo «Stock».
  "comandas.texto.stock_stock_insuficiente": { porDefecto: "Stock insuficiente" },
  "comandas.texto.stock_enviar_igual": { porDefecto: "Enviar igual" },

  // imprimir.html:298-301: grupo «Imprimir».
  "comandas.texto.imprimir_imprimir": {
    porDefecto: "Imprimir",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_imprimiendo": {
    porDefecto: "Imprimiendo",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR, USO_EN_LA_LISTA],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_impresa": {
    porDefecto: "Impresa",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_no_se_pudo_imprimir": {
    porDefecto: "No se pudo imprimir",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_reintentar": {
    porDefecto: "Reintentar",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_ver_en_pantalla": {
    porDefecto: "Ver en pantalla",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_reimprimir": { porDefecto: "Reimprimir" },
  "comandas.texto.imprimir_se_imprime_una_copia_con_la_hora_del_envio_origina": {
    porDefecto: "Se imprime una copia con la hora del envío original",
  },
  "comandas.texto.imprimir_impresoras": {
    porDefecto: "Impresoras",
    usos: [
      USO_EN_EL_FORMULARIO,
      USO_EN_EL_MENU,
      USO_EN_LA_PAGINA_DE_LA_LISTA,
      USO_EN_LA_PAGINA_DE_LA_EDICION,
    ],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_agregar_impresora": {
    porDefecto: "Agregar impresora",
    usos: [USO_EN_LA_LISTA, USO_EN_EL_FORMULARIO, USO_EN_LA_PAGINA_DEL_ALTA],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_nombre": {
    porDefecto: "Nombre",
    usos: [USO_EN_EL_FORMULARIO],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_para_que_sirve": {
    porDefecto: "Para qué sirve",
    usos: [USO_EN_EL_FORMULARIO],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_comanda_de_cocina": {
    porDefecto: "Comanda de cocina",
    usos: [USO_EN_EL_TEXTO_DEL_USO],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_ticket_del_cliente": {
    porDefecto: "Ticket del cliente",
    usos: [USO_EN_EL_TEXTO_DEL_USO],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_papel": {
    porDefecto: "Papel",
    usos: [USO_EN_EL_FORMULARIO],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_imprimir_prueba": {
    porDefecto: "Imprimir prueba",
    usos: [USO_EN_LA_LISTA],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  // imprimir.html, función `vConfig` (lista vacía, marcado como texto nuevo): «No hay impresoras».
  "comandas.texto.imprimir_no_hay_impresoras": {
    porDefecto: "No hay impresoras",
    usos: [USO_EN_LA_LISTA],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina": {
    porDefecto: "No hay impresora para la comanda de cocina",
    usos: [USO_EN_EL_BOTON_DE_IMPRIMIR],
    fuente: FUENTE_DE_IMPRIMIR,
  },
  "comandas.texto.imprimir_configurar_impresoras": { porDefecto: "Configurar impresoras" },
} as const;
