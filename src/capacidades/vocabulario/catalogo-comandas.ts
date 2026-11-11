/**
 * Los textos del módulo `comandas` (prefijo `comandas.`, E7 §10). Ninguno es nuevo: todos salen de los prototipos que el dueño aprobó el 09/11/2026
 * (D115) y de la decisión 181 (cantidad en papel, que no es un texto sino una regla del dominio). La fuente de cada grupo está en su comentario
 * (`10-ux-ui/prototipos-gastronomia/`, repositorio de documentos). «Copia» reemplaza a «REIMPRESIÓN» (D120). «no preparar todavía» del papel NO está
 * acá: no figura en la lista aprobada (pregunta pendiente al dueño).
 */

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
  "comandas.texto.salida_quitar": { porDefecto: "Quitar" },
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
  "comandas.texto.imprimir_imprimir": { porDefecto: "Imprimir" },
  "comandas.texto.imprimir_imprimiendo": { porDefecto: "Imprimiendo" },
  "comandas.texto.imprimir_impresa": { porDefecto: "Impresa" },
  "comandas.texto.imprimir_no_se_pudo_imprimir": { porDefecto: "No se pudo imprimir" },
  "comandas.texto.imprimir_reintentar": { porDefecto: "Reintentar" },
  "comandas.texto.imprimir_ver_en_pantalla": { porDefecto: "Ver en pantalla" },
  "comandas.texto.imprimir_reimprimir": { porDefecto: "Reimprimir" },
  "comandas.texto.imprimir_se_imprime_una_copia_con_la_hora_del_envio_origina": {
    porDefecto: "Se imprime una copia con la hora del envío original",
  },
  "comandas.texto.imprimir_impresoras": { porDefecto: "Impresoras" },
  "comandas.texto.imprimir_agregar_impresora": { porDefecto: "Agregar impresora" },
  "comandas.texto.imprimir_nombre": { porDefecto: "Nombre" },
  "comandas.texto.imprimir_para_que_sirve": { porDefecto: "Para qué sirve" },
  "comandas.texto.imprimir_comanda_de_cocina": { porDefecto: "Comanda de cocina" },
  "comandas.texto.imprimir_ticket_del_cliente": { porDefecto: "Ticket del cliente" },
  "comandas.texto.imprimir_papel": { porDefecto: "Papel" },
  "comandas.texto.imprimir_imprimir_prueba": { porDefecto: "Imprimir prueba" },
  "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina": {
    porDefecto: "No hay impresora para la comanda de cocina",
  },
  "comandas.texto.imprimir_configurar_impresoras": { porDefecto: "Configurar impresoras" },
} as const;
