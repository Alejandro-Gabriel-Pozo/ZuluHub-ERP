/**
 * Los textos del módulo `salon` (prefijo `salon.`, E7 §10). Ninguno es nuevo: todos salen de los prototipos que el dueño aprobó el 09/11/2026 (D115,
 * 302 textos), con la fuente de cada grupo en su comentario (`10-ux-ui/prototipos-gastronomia/`, repositorio de documentos). Los errores sin texto
 * propio (`MESA_NO_LIBRE`, `MESA_UNIDA`, `MESA_DIVIDIDA`…) usan el mensaje genérico ya existente. Sin texto, a propósito: «Cobrar» deshabilitado con
 * platos pendientes (D86: el estado comunica el motivo) y la cuenta de reserva. A confirmar con el dueño: «Compartido» como rótulo de una línea.
 */

export const TEXTOS_DE_SALON = {
  // salon.html:312-337 (aprobado 09/11): grupo «Estados de la mesa y filtros».
  "salon.texto.estado_libre": { porDefecto: "Libre" },
  "salon.texto.estado_en_pedido": { porDefecto: "En pedido" },
  "salon.texto.estado_ocupada": { porDefecto: "Ocupada" },
  "salon.texto.estado_libres": { porDefecto: "Libres" },
  "salon.texto.estado_ocupadas": { porDefecto: "Ocupadas" },
  "salon.texto.estado_mesas": { porDefecto: "Mesas" },

  // salon.html:312-337; D59: grupo «Mesa y pedido».
  "salon.texto.mesa_tomar_pedido": { porDefecto: "Tomar pedido" },
  "salon.texto.mesa_mesa_libre": { porDefecto: "Mesa libre" },
  "salon.texto.mesa_la_mesa_no_tiene_pedido": { porDefecto: "La mesa no tiene pedido" },
  "salon.texto.mesa_liberar_mesa": { porDefecto: "Liberar mesa" },
  "salon.texto.mesa_cambiar_de_mesa": { porDefecto: "Cambiar de mesa" },
  "salon.texto.mesa_pasar_a_la_mesa": { porDefecto: "Pasar a la mesa" },
  "salon.texto.mesa_no_hay_mesas_libres": { porDefecto: "No hay mesas libres" },

  // salon.html:312-337: grupo «Dividir».
  "salon.texto.dividir_dividir_la_cuenta": { porDefecto: "Dividir la cuenta" },
  "salon.texto.dividir_por_porcentaje": { porDefecto: "Por porcentaje" },
  "salon.texto.dividir_por_items": { porDefecto: "Por ítems" },
  "salon.texto.dividir_parte": { porDefecto: "Parte" },
  "salon.texto.dividir_resto": { porDefecto: "resto" },
  "salon.texto.dividir_agregar_parte": { porDefecto: "Agregar parte" },
  "salon.texto.dividir_usar_en_el_cobro": { porDefecto: "Usar en el cobro" },
  "salon.texto.dividir_cuenta_n": { porDefecto: "Cuenta N" },
  "salon.texto.dividir_pendiente": { porDefecto: "Pendiente" },
  "salon.texto.dividir_cobrada": { porDefecto: "Cobrada" },
  "salon.texto.dividir_volver_a_las_cuentas": { porDefecto: "Volver a las cuentas" },
  "salon.texto.dividir_mesa_cobrada": { porDefecto: "Mesa cobrada" },

  // unir.html:270-274: grupo «Dividir por ítems y unir».
  "salon.texto.unir_dividir_por_items": { porDefecto: "Dividir por ítems" },
  "salon.texto.unir_cuentas": { porDefecto: "Cuentas" },
  "salon.texto.unir_agregar_cuenta": { porDefecto: "Agregar cuenta" },
  "salon.texto.unir_falta_asignar": { porDefecto: "Falta asignar" },
  "salon.texto.unir_cuenta_vacia": { porDefecto: "Cuenta vacía" },
  "salon.texto.unir_dividir_ahora": { porDefecto: "Confirmar división" },
  "salon.texto.unir_entero": { porDefecto: "Entero" },
  "salon.texto.unir_por_unidades": { porDefecto: "Por unidades" },
  "salon.texto.unir_compartido": { porDefecto: "Compartido" },
  "salon.texto.unir_repartir": { porDefecto: "Repartir" },
  "salon.texto.unir_entre_cuales": { porDefecto: "Entre cuáles" },
  "salon.texto.unir_partes_iguales": { porDefecto: "Partes iguales" },
  "salon.texto.unir_el_centavo_que_sobra_va_a_la_cuenta_1": {
    porDefecto: "El centavo que sobra va a la Cuenta 1",
  },
  "salon.texto.unir_division_hecha": { porDefecto: "División confirmada" },
  "salon.texto.unir_unir_con_otra_mesa": { porDefecto: "Unir con otra mesa" },
  "salon.texto.unir_unir_la_mesa": { porDefecto: "Unir la mesa" },
  "salon.texto.unir_en_la_mesa": { porDefecto: "en la mesa" },
  "salon.texto.unir_unida_a_la_mesa": { porDefecto: "Unida a la mesa" },
  "salon.texto.unir_de_la_mesa": { porDefecto: "De la mesa" },
  "salon.texto.unir_la_mesa_ya_tiene_un_cobro": { porDefecto: "La mesa ya tiene un cobro" },
  "salon.texto.unir_no_se_pueden_unir": { porDefecto: "No se pueden unir" },
  "salon.texto.unir_mesa_libre": { porDefecto: "Mesa libre" },
  "salon.texto.unir_unir_ahora": { porDefecto: "Confirmar unión" },
  "salon.texto.unir_cuanto_queda": { porDefecto: "Cuánto queda" },
  "salon.texto.unir_esto_no_se_deshace_para_separar_se_divide_la_cuent": {
    porDefecto: "Esto no se deshace: para separar, se divide la cuenta",
  },

  // mesas.html:287-289: grupo «Mesas (administración)».
  "salon.texto.admin_mesas": { porDefecto: "Mesas" },
  "salon.texto.admin_agregar_mesa": { porDefecto: "Agregar mesa" },
  "salon.texto.admin_editar_mesa": { porDefecto: "Editar mesa" },
  "salon.texto.admin_numero": { porDefecto: "Número" },
  "salon.texto.admin_forma": { porDefecto: "Forma" },
  "salon.texto.admin_redonda": { porDefecto: "Redonda" },
  "salon.texto.admin_cuadrada": { porDefecto: "Cuadrada" },
  "salon.texto.admin_larga": { porDefecto: "Larga" },
  "salon.texto.admin_tamano": { porDefecto: "Tamaño" },
  "salon.texto.admin_chica": { porDefecto: "Chica" },
  "salon.texto.admin_mediana": { porDefecto: "Mediana" },
  "salon.texto.admin_grande": { porDefecto: "Grande" },
  "salon.texto.admin_posicion": { porDefecto: "Posición" },
  "salon.texto.admin_columna": { porDefecto: "Columna" },
  "salon.texto.admin_fila": { porDefecto: "Fila" },
  "salon.texto.admin_guardar": { porDefecto: "Guardar" },
  "salon.texto.admin_desactivar": { porDefecto: "Desactivar" },
  "salon.texto.admin_reactivar": { porDefecto: "Reactivar" },
  "salon.texto.admin_desactivada": { porDefecto: "Desactivada" },
  "salon.texto.admin_plano": { porDefecto: "Plano" },
  "salon.texto.admin_escribi_un_numero_del_1_al_99": {
    porDefecto: "Escribí un número del 1 al 99",
  },
  "salon.texto.admin_ya_existe_una_mesa_con_ese_numero": {
    porDefecto: "Ya existe una mesa con ese número",
  },
  "salon.texto.admin_queda_fuera_del_salon": { porDefecto: "Queda fuera del salón" },
  "salon.texto.admin_se_superpone_con_la_mesa": { porDefecto: "Se superpone con la mesa" },

  // escritorio.html:321: grupo «Escritorio».
  "salon.texto.escritorio_atajos_de_teclado": { porDefecto: "Atajos de teclado" },
  "salon.texto.escritorio_buscar": { porDefecto: "Buscar" },
  "salon.texto.escritorio_enviar": { porDefecto: "Enviar" },
  "salon.texto.escritorio_cobrar": { porDefecto: "Cobrar" },
  "salon.texto.escritorio_cerrar": { porDefecto: "Cerrar" },
} as const;
