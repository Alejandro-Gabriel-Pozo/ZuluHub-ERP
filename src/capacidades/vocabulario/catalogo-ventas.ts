/**
 * Los textos del módulo `ventas` (prefijo `ventas.`). Nació vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 */
const USO_DE_TEXTOS_DE_COBRAR = {
  como: "FUNCION",
  archivo: "apps/web/ui/plantillas/cobrar/textos-de-cobrar.ts",
  nombre: "textosDeCobrar",
} as const;
const FUENTE_DE_COBRAR_COMO_LA_MAQUETA = { decision: "DEC-0769" } as const;

export const TEXTOS_DE_VENTAS = {
  // El genérico aprobado por el dueño el 30/10/2026 («Interfaz sobria»: mensaje genérico antes que uno por acción; `CLAUDE.md`); el mismo texto ya aprobado de `caja.error.accion_no_permitida`
  // (maqueta `medios.html`, 09/11/2026). Fuente de que ventas lo use: `servidor-del-mostrador-minimo.md` §8, «Los seis avisos sin texto usan el genérico».
  "ventas.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },

  // PANTALLA «VENTA RÁPIDA» (maqueta `venta-rapida-v4.html`). Fuente de cada texto, salvo donde se dice otra cosa: `textos-mostrador-pendientes.md` (Pedernal-docs, 11-especificaciones) y la
  // fila 171 de `decisiones-del-dueno-2026-11.md` («Acepto todos los textos», 15/11/2026); «aprobado 09/11» = la versión aprobada de la venta rápida (`venta-rapida.html`, §4 de ese documento).
  // «Venta»: título de la pantalla. Figura en la maqueta aprobada de la venta rápida (`venta-rapida.html:551`, carpeta de prototipos de Pedernal-docs 10-ux-ui) y se mantiene en `venta-rapida-v4.html`;
  // no está en la lista de 302 textos (`textos-por-aprobar.html`): confirmado por el dueño el 18/11/2026 (DEC-0479; `decisiones-del-dueno-2026-11.md` fila 307).
  "ventas.venta.titulo": { porDefecto: "Venta" },
  // «Venta rápida»: rótulo de la entrada del menú, dentro del grupo «Mostrador» (dueño, 13/11/2026, `decisiones-del-dueno-2026-11.md` línea 110: «no el título largo»).
  "ventas.venta.menu": { porDefecto: "Venta rápida" },
  // «Buscar por nombre o código»: rótulo del buscador. Aprobado 09/11 (`textos-mostrador-pendientes.md` §4, línea 69); busca por nombre, código y código de barras (respuesta del orquestador, 15/11/2026).
  "ventas.venta.buscar": { porDefecto: "Buscar por nombre o código" },
  // «Todo»: primer botón de las secciones, elegido al entrar (maqueta aprobada `venta-rapida-v4.html:597` y `:740`, dueño 12/11/2026 DDD:52; regla «manda la maqueta», DDD:294, 18/11/2026).
  "ventas.venta.todo": { porDefecto: "Todo" },
  // «Incluido»: lo que dice una opción sin recargo en la hoja del producto (maqueta aprobada `venta-rapida-v4.html:757`; ya figura aprobado en `productos.html`, ver `catalogo-catalogo.ts`; DDD:294).
  "ventas.venta.incluido": { porDefecto: "Incluido" },
  // Búsqueda sin coincidencias: los tres textos figuran en la maqueta aprobada de la venta rápida (`venta-rapida.html:548`); aceptados por el orquestador el 15/11/2026 (delegación del dueño, DDD filas 173 y 174).
  // El texto buscado se inserta como texto, nunca como código (R6 de e4 §3.9).
  "ventas.venta.sin_resultados": {
    porDefecto: "No encontré productos con «{busqueda}»",
    marcadores: ["busqueda"],
    largoMaximo: 120,
  },
  "ventas.venta.sin_resultados_ayuda": { porDefecto: "Revisá el nombre o probá con el código." },
  "ventas.venta.borrar_busqueda": { porDefecto: "Borrar la búsqueda" },
  // «Ver cuenta»: aprobado 09/11 (`textos-mostrador-pendientes.md` §4, línea 69).
  "ventas.venta.ver_cuenta": { porDefecto: "Ver cuenta" },
  // «Total»: aprobado 09/11 (ídem; `e4-venta-rapida-especificacion.md` §3.16, `ventas.confirmar_cero`).
  "ventas.venta.total": { porDefecto: "Total" },
  // M7 «Con opciones»: subtítulo del producto con medidas u opciones (fila 171, alcance e).
  "ventas.venta.con_opciones": { porDefecto: "Con opciones" },
  // «Agregar»: botón de la hoja del producto. Aprobado 09/11: `textos-por-aprobar.html` n.º 109 y `venta-rapida.html:595` (Pedernal-docs, 10-ux-ui/prototipos-gastronomia).
  "ventas.venta.agregar": { porDefecto: "Agregar" },
  // «Agregado»: aviso tras agregar. Ya aprobado en `productos.html` (alta rápida) y usado acá en un lugar nuevo (`venta-rapida-v4.html`, `PA_REG` clave `agregado`).
  "ventas.venta.agregado": { porDefecto: "Agregado" },
  // «Cantidad», «Quitar» y «Cancelar»: aprobados 09/11 (`textos-mostrador-pendientes.md` §4, línea 69: «Cantidad», «Quitar», «Cancelar»).
  "ventas.venta.cantidad": { porDefecto: "Cantidad" },
  "ventas.venta.quitar": { porDefecto: "Quitar" },
  "ventas.venta.cancelar": { porDefecto: "Cancelar" },
  // «Confirmar» del diálogo de venta a $ 0 (PR-6): aprobado (DDD:171, alcance e, M1 a M14; `venta-rapida-v4.html:918`). La clave dice «validar» porque el catálogo rechaza todo nombre que contenga «firma» (`NOMBRE_DE_SECRETO`), como `compras.recepcion.validar_recepcion`. Clave propia de ventas: la única otra, `fiscal.pantalla.config_df_que_rija`, es de otra función (SUPUESTO de PR-6, DEC-0788, a aceptar por el orquestador).
  "ventas.venta.validar": { porDefecto: "Confirmar" },
  // «Cantidad no válida»: `prototipo-caja.html`, aprobado 09/11 (`venta-rapida-v4.html`, tabla «Textos ya aprobados que se reutilizan»; `e4-venta-rapida-especificacion.md` §3.16).
  "ventas.venta.cantidad_no_valida": { porDefecto: "Cantidad no válida" },
  // «La cuenta está vacía» y «Agregá productos desde la venta.»: aprobados 09/11 (`e4-venta-rapida-especificacion.md` §3.16, `ventas.cuenta.vacia`; `textos-mostrador-pendientes.md` §3).
  "ventas.venta.cuenta_vacia": { porDefecto: "La cuenta está vacía" },
  "ventas.venta.cuenta_vacia_ayuda": { porDefecto: "Agregá productos desde la venta." },
  // P12 «Los precios incluyen IVA.»: aprobado (fila 171, alcance g); el mismo texto que `vidriera.pie.iva`.
  "ventas.venta.pie_iva": { porDefecto: "Los precios incluyen IVA." },
  // M3 «Medida»: nombre del grupo de medidas, solo para quien usa lector de pantalla (fila 171, alcance e).
  "ventas.venta.medida": { porDefecto: "Medida" },
  // M4 «Borrar»: deja la cantidad de un producto por fracciones en vacío (fila 171, alcance e).
  "ventas.cantidad.borrar": { porDefecto: "Borrar" },
  // M1 los rótulos de fracciones (fila 171, alcance e; fila 117 del 14/11/2026, punto 2): ½ ¼ ¾ y ⅛ ⅜ ⅝ ⅞. Decisión 181: en pantalla los signos; en el papel, con barra.
  "ventas.cantidad.fraccion_1_2": { porDefecto: "½" },
  "ventas.cantidad.fraccion_1_4": { porDefecto: "¼" },
  "ventas.cantidad.fraccion_3_4": { porDefecto: "¾" },
  "ventas.cantidad.fraccion_1_8": { porDefecto: "⅛" },
  "ventas.cantidad.fraccion_3_8": { porDefecto: "⅜" },
  "ventas.cantidad.fraccion_5_8": { porDefecto: "⅝" },
  "ventas.cantidad.fraccion_7_8": { porDefecto: "⅞" },

  // PANTALLA «COBRAR» (maqueta `venta-rapida-v4.html`, zona cobro y resultado). Fuentes: `V4` = `venta-rapida-v4.html` (Pedernal-docs, 10-ux-ui/prototipos-gastronomia), tabla «Textos ya aprobados que
  // se reutilizan» (líneas 411-418); `TMP` = `textos-mostrador-pendientes.md` (11-especificaciones); `DDD` = `decisiones-del-dueno-2026-11.md` (fila = n.º de línea). Nada es un texto nuevo.
  // «Cobrar» y «Cobrado»: aprobados el 09/11/2026 en la versión anterior de la venta rápida (V4:411; `salon.html:361`).
  "ventas.cobro.cobrar": { porDefecto: "Cobrar" },
  "ventas.cobro.cobrado": { porDefecto: "Cobrado" },
  // «Medio» e «Importe»: rótulos de cada fila de cobro de `salon.html:771-772` (maqueta aprobada el 09/11/2026; V4:416 la nombra como origen del cobro).
  "ventas.cobro.medio": { porDefecto: "Medio" },
  "ventas.cobro.importe": { porDefecto: "Importe" },
  // «Cuenta de cobro», «Vuelto», «Falta cobrar», «Cobro completo» y «Sobran»: aprobados el 09/11/2026 (V4:416, `prototipo-salon.html`).
  "ventas.cobro.cuenta_de_cobro": { porDefecto: "Cuenta de cobro" },
  "ventas.cobro.vuelto": { porDefecto: "Vuelto" },
  "ventas.cobro.falta_cobrar": { porDefecto: "Falta cobrar" },
  "ventas.cobro.cobro_completo": { porDefecto: "Cobro completo" },
  "ventas.cobro.sobran": { porDefecto: "Sobran" },
  // «Importe no válido»: aprobado el 09/11/2026 (`prototipo-caja.html`; V4:415).
  "ventas.cobro.importe_no_valido": { porDefecto: "Importe no válido" },
  // «Abrí la caja para cobrar»: texto del dueño, decisión 145 (V4:414).
  "ventas.cobro.abri_la_caja": { porDefecto: "Abrí la caja para cobrar" },
  // M6 «Agregar otro medio»: aprobado el 15/11/2026 (DDD:171, alcance e; TMP §1, fila M6).
  "ventas.cobro.agregar_otro_medio": { porDefecto: "Agregar otro medio" },
  // La vista «Cobro» como la maqueta (DDD:294: manda la maqueta): título «Cobro» y «Volver a la cuenta» (`venta-rapida-v4.html:854`), «Resultado» (`:877`), «No se pudo cobrar. No se cobró nada.» (aprobado
  // el 09/11/2026: `textos-por-aprobar.html` n.º 13, `:401`) y «Volver al cobro» (`:880`). Reemplazan al supuesto «Volver» de DEC-0501 (la clave `ventas.cobro.volver` se quitó). Fuente: DEC-0769.
  "ventas.cobro.titulo": {
    porDefecto: "Cobro",
    usos: [USO_DE_TEXTOS_DE_COBRAR],
    fuente: FUENTE_DE_COBRAR_COMO_LA_MAQUETA,
  },
  "ventas.cobro.volver_a_la_cuenta": {
    porDefecto: "Volver a la cuenta",
    usos: [USO_DE_TEXTOS_DE_COBRAR],
    fuente: FUENTE_DE_COBRAR_COMO_LA_MAQUETA,
  },
  "ventas.cobro.resultado": {
    porDefecto: "Resultado",
    usos: [USO_DE_TEXTOS_DE_COBRAR],
    fuente: FUENTE_DE_COBRAR_COMO_LA_MAQUETA,
  },
  "ventas.cobro.no_se_pudo": {
    porDefecto: "No se pudo cobrar. No se cobró nada.",
    usos: [USO_DE_TEXTOS_DE_COBRAR],
    fuente: FUENTE_DE_COBRAR_COMO_LA_MAQUETA,
  },
  "ventas.cobro.volver_al_cobro": {
    porDefecto: "Volver al cobro",
    usos: [USO_DE_TEXTOS_DE_COBRAR],
    fuente: FUENTE_DE_COBRAR_COMO_LA_MAQUETA,
  },
  // Datos del cobro (decisión 129; aprobados el 09/11/2026 en `datos-cobro.html:270`, reutilizados en un lugar nuevo: DDD:175, `TMP` §6.1). Los rótulos llevan «(opcional)» como en `datos-cobro.html:321`.
  "ventas.cobro.dato.cupon": { porDefecto: "Cupón" },
  "ventas.cobro.dato.ultimos4": { porDefecto: "Últimos 4 dígitos" },
  "ventas.cobro.dato.marca": { porDefecto: "Marca de la tarjeta" },
  "ventas.cobro.dato.cuotas": { porDefecto: "Cuotas" },
  "ventas.cobro.dato.dni": { porDefecto: "DNI" },
  "ventas.cobro.dato.opcional": { porDefecto: "(opcional)" },
  // Errores bajo el campo (`datos-cobro.html:270,337-342`; DDD:175). «Escribí cuotas de 1 a 36» lleva el tope como marcador `{maximo}`: vale `MAXIMO_DE_CUOTAS` (una regla, un lugar; DDD:183).
  "ventas.cobro.error.cupon_es_tarjeta": {
    porDefecto: "El cupón no puede ser un número de tarjeta",
  },
  "ventas.cobro.error.cupon_invalido": { porDefecto: "El cupón tiene caracteres no permitidos" },
  "ventas.cobro.error.ultimos4": { porDefecto: "Escribí 4 dígitos" },
  "ventas.cobro.error.cuotas": {
    porDefecto: "Escribí cuotas de 1 a {maximo}",
    marcadores: ["maximo"],
  },
  "ventas.cobro.error.dni": { porDefecto: "El DNI no es válido" },
  // Resultado: «Ticket N.º 12» (V4 `ticket.numero`; «Ticket» de `imprimir.html` y «N.º» del facturador, DDD:175), «Anular», «Motivo» (APR n.º 214 y 215 de `prototipo-salon.html` y `caja.html:403,431`,
  // TMP §1 nota), «Escribí el motivo» y «Anulado» (T5 y T4 de `textos-nuevos-pendientes.md`, aprobados: DDD fila 165, «T1 a T18 y T21 a T27»), «Nueva venta» (P10, aprobado el 15/11/2026: DDD:171, alcance f).
  "ventas.ticket.numero": { porDefecto: "Ticket N.º {numero}", marcadores: ["numero"] },
  "ventas.ticket.anular": { porDefecto: "Anular" },
  "ventas.ticket.motivo": { porDefecto: "Motivo" },
  "ventas.ticket.motivo_obligatorio": { porDefecto: "Escribí el motivo" },
  "ventas.ticket.anulado": { porDefecto: "Anulado" },
  // Ticket del cliente (PR-5): «Imprimir ticket» (DDD:171, M5; venta-rapida-v4.html:889); «Ticket del cliente» e «Imprimir» (imprimir.html, aprobada el 09/11/2026, decisión 120; venta-rapida-v4.html:901 y :903);
  // «Volver» (imprimir.html:327; venta-rapida-v4.html:901). Decisión: DEC-0772 (DDD:172 punto 4 B, DDD:175, DDD:286).
  "ventas.ticket.imprimir_ticket": { porDefecto: "Imprimir ticket" },
  "ventas.ticket.del_cliente": { porDefecto: "Ticket del cliente" },
  "ventas.ticket.imprimir": { porDefecto: "Imprimir" },
  "ventas.ticket.volver": { porDefecto: "Volver" },
  "ventas.venta.nueva": { porDefecto: "Nueva venta" },
} as const;
