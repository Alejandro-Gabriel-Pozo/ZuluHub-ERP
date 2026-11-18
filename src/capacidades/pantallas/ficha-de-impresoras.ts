import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «IMPRESORAS» (S-2; DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con la acción de permiso que cada uno envía, los estados
 * y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `ficha-de-impresoras.test.ts` contra el catálogo de textos, el de permisos y la
 * tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (módulo `comandas`).
 * «Imprimir prueba» y el botón «Imprimir» son del navegador (abren el diálogo de impresión del sistema; la hoja de prueba no registra nada): no envían una acción de permiso, por eso no figuran entre los botones con
 * acción y sí entre los textos. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

const MAQUETA_APROBADA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `imprimir.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos); aceptado sin cambios el 17/11/2026 (DEC-0715)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta imprimir.html (tabla «Textos nuevos») y 11-especificaciones/salon-s2-impresoras-plan.md §3",
} as const;
const USO_DEL_FORMULARIO = "FormularioDeImpresora.cliente.tsx";
const USO_DE_LA_LISTA = "modelo-de-impresoras.ts (lista)";
const USO_DEL_BOTON = "BotonDeImprimir.cliente.tsx";

const textoDeLaMaqueta = (...usos: readonly string[]) => ({ usos, fuente: MAQUETA_APROBADA });

export const FICHA_DE_IMPRESORAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/salon/impresoras/page.tsx",
    "apps/web/app/s/app/(operacion)/salon/impresoras/nueva/page.tsx",
    "apps/web/app/s/app/(operacion)/salon/impresoras/[id]/page.tsx",
    "apps/web/ui/plantillas/salon/PantallaDeListaDeImpresoras.tsx",
    "apps/web/ui/plantillas/salon/FormularioDeImpresora.cliente.tsx",
    "apps/web/ui/plantillas/salon/BotonDePruebaDeImpresora.cliente.tsx",
    "apps/web/ui/patrones/papel/BotonDeImprimir.cliente.tsx",
  ],
  rutas: ["/salon/impresoras", "/salon/impresoras/nueva", "/salon/impresoras/[id]"],
  titulo: "comandas.texto.imprimir_impresoras",
  acceso: "impresoras.ver",
  botones: [
    {
      id: "agregar",
      texto: "comandas.texto.imprimir_agregar_impresora",
      hace: { navega: "/salon/impresoras/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "quitar",
      texto: "comandas.texto.salida_quitar",
      hace: { envia: "impresoras.desactivar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-alta",
      texto: "salon.texto.admin_guardar",
      hace: { envia: "impresoras.crear" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-edicion",
      texto: "salon.texto.admin_guardar",
      hace: { envia: "impresoras.editar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "comandas.texto.imprimir_impresoras": textoDeLaMaqueta(
      "título de la pantalla",
      "fila del menú",
      "título de la edición",
    ),
    "comandas.texto.imprimir_agregar_impresora": textoDeLaMaqueta(
      USO_DE_LA_LISTA,
      "título del alta",
    ),
    "comandas.texto.imprimir_nombre": textoDeLaMaqueta(USO_DEL_FORMULARIO),
    "comandas.texto.imprimir_para_que_sirve": textoDeLaMaqueta(USO_DEL_FORMULARIO),
    "comandas.texto.imprimir_comanda_de_cocina": textoDeLaMaqueta(
      USO_DEL_FORMULARIO,
      USO_DE_LA_LISTA,
    ),
    "comandas.texto.imprimir_ticket_del_cliente": textoDeLaMaqueta(
      USO_DEL_FORMULARIO,
      USO_DE_LA_LISTA,
    ),
    "comandas.texto.imprimir_papel": textoDeLaMaqueta(USO_DEL_FORMULARIO),
    "comandas.texto.imprimir_imprimir_prueba": textoDeLaMaqueta(USO_DE_LA_LISTA),
    "comandas.texto.imprimir_no_hay_impresoras": textoDeLaMaqueta(USO_DE_LA_LISTA),
    "comandas.texto.salida_quitar": textoDeLaMaqueta(USO_DE_LA_LISTA),
    "salon.texto.admin_guardar": textoDeLaMaqueta(USO_DEL_FORMULARIO),
    "comandas.texto.imprimir_imprimir": textoDeLaMaqueta(USO_DEL_BOTON),
    "comandas.texto.imprimir_imprimiendo": textoDeLaMaqueta(USO_DEL_BOTON, USO_DE_LA_LISTA),
    "comandas.texto.imprimir_impresa": textoDeLaMaqueta(USO_DEL_BOTON),
    "comandas.texto.imprimir_no_se_pudo_imprimir": textoDeLaMaqueta(USO_DEL_BOTON),
    "comandas.texto.imprimir_reintentar": textoDeLaMaqueta(USO_DEL_BOTON),
    "comandas.texto.imprimir_ver_en_pantalla": textoDeLaMaqueta(USO_DEL_BOTON),
    "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina":
      textoDeLaMaqueta(USO_DEL_BOTON),
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
