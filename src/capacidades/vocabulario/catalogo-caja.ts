/**
 * Los textos del módulo `caja` (prefijo `caja.`). Nace vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 *
 * MEDIOS = `Pedernal-docs/10-ux-ui/prototipos-gastronomia/medios.html` («Medios de pago, cuentas y cajas», maqueta APROBADA por el dueño el
 * 09/11/2026; mapa de pantallas B1). Su tabla «Textos nuevos» dice que esa versión no suma ninguno y reutiliza los aprobados el 09/11/2026:
 * «Medios de pago · Cuentas de cobro · Cajas · Agregar medio · … · Nombre · Tipo · Editar · Desactivar · Reactivar · Desactivado · Activo ·
 * Guardar · … · Cuenta de cobro: no lleva · opcional · Ya existe un medio con ese nombre · … · Esta acción no está permitida». Los nombres de
 * los tipos de medio son los del arreglo `TIPOS` de la misma maqueta (los cinco primeros, también en `salon.html` «Efectivo, Tarjeta de débito,
 * Tarjeta de crédito, Transferencia, QR»: `caja-y-cobros.md`, texto exacto aprobado el 09/11/2026). Ningún texto de MEDIOS está fuera de esa tabla.
 *
 * MOSTRADOR = `Pedernal-docs/10-ux-ui/prototipos-gastronomia/caja.html` («Caja» del mostrador; su tabla «Textos nuevos» y su lista «(reutilizados)» de la línea 282) y
 * `11-especificaciones/textos-mostrador-pendientes.md` (M8 a M14, aprobados el 15/11/2026). Fuente de la aprobación: `11-especificaciones/decisiones-del-dueno-2026-11.md`, fila del
 * 15/11/2026 «Textos: el dueño acepta todos los textos propuestos…» (DDD:171, mensaje del dueño del 15/11/2026) y decisión 175 para los de «conforme» y el aviso del día en cierre.
 */
export const TEXTOS_DE_CAJA = {
  // MEDIOS, tabla «(reutilizados)»: título de la pantalla y del botón de alta.
  "caja.medios.titulo": { porDefecto: "Medios de pago" },
  "caja.medios.agregar": { porDefecto: "Agregar medio" },
  // MEDIOS, tabla «(reutilizados)»: botones de cada tarjeta y del formulario.
  "caja.accion.editar": { porDefecto: "Editar" },
  "caja.accion.desactivar": { porDefecto: "Desactivar" },
  "caja.accion.reactivar": { porDefecto: "Reactivar" },
  "caja.accion.guardar": { porDefecto: "Guardar" },
  // MEDIOS, tabla «(reutilizados)»: el estado de cada tarjeta.
  "caja.estado.activo": { porDefecto: "Activo" },
  "caja.estado.desactivado": { porDefecto: "Desactivado" },
  // MEDIOS, tabla «(reutilizados)»: rótulos del formulario. «(opcional)» es la palabra «opcional» de la misma tabla, entre paréntesis como en `vFormM`.
  "caja.campo.nombre": { porDefecto: "Nombre" },
  "caja.campo.tipo": { porDefecto: "Tipo" },
  "caja.campo.nombre_opcional": { porDefecto: "Nombre (opcional)" },
  // MEDIOS, tabla «(reutilizados)»: «Cuenta de cobro: no lleva» y «opcional» («Cuenta de cobro: opcional» ya estaba aprobado, texto de «Textos nuevos»).
  "caja.medios.cuenta_no_lleva": { porDefecto: "Cuenta de cobro: no lleva" },
  "caja.medios.cuenta_opcional": { porDefecto: "Cuenta de cobro: opcional" },
  // MEDIOS, arreglo `TIPOS` de la maqueta (y `caja-y-cobros.md` para los cinco primeros).
  "caja.medios.tipo.efectivo": { porDefecto: "Efectivo" },
  "caja.medios.tipo.tarjeta_debito": { porDefecto: "Tarjeta de débito" },
  "caja.medios.tipo.tarjeta_credito": { porDefecto: "Tarjeta de crédito" },
  "caja.medios.tipo.transferencia": { porDefecto: "Transferencia" },
  "caja.medios.tipo.qr": { porDefecto: "QR" },
  "caja.medios.tipo.otro": { porDefecto: "Otro" },
  // MEDIOS, tabla «(reutilizados)»: los títulos de las otras dos listas y sus botones de alta.
  "caja.cuentas.titulo": { porDefecto: "Cuentas de cobro" },
  "caja.cuentas.agregar": { porDefecto: "Agregar cuenta" },
  "caja.cajas.titulo": { porDefecto: "Cajas" },
  "caja.cajas.agregar": { porDefecto: "Agregar caja" },
  // MEDIOS, tabla «(reutilizados)»: rótulos del formulario de una cuenta («(opcional)» como en `vFormC`) y de su sucursal.
  "caja.campo.identificador_opcional": { porDefecto: "Identificador (opcional)" },
  "caja.campo.sucursal": { porDefecto: "Sucursal" },
  // MEDIOS, arreglo `CTIPOS` de la maqueta («Terminal» y «Cuenta bancaria» están en la tabla «(reutilizados)»; «QR» es el de los medios, `caja.medios.tipo.qr`).
  "caja.cuentas.tipo.terminal": { porDefecto: "Terminal" },
  "caja.cuentas.tipo.cuenta_bancaria": { porDefecto: "Cuenta bancaria" },
  // MEDIOS, tabla «(reutilizados)»: los avisos de error de cuentas y cajas.
  "caja.error.cuenta_repetida": { porDefecto: "Ya existe una cuenta con ese nombre" },
  "caja.error.caja_repetida": { porDefecto: "Ya existe una caja con ese nombre" },
  "caja.error.identificador_invalido": { porDefecto: "Identificador no válido" },
  // MEDIOS, tabla «(reutilizados)»: los dos avisos de error de esta pantalla («Ya existe un medio con ese nombre» y el genérico).
  "caja.error.medio_repetido": { porDefecto: "Ya existe un medio con ese nombre" },
  "caja.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
  // MOSTRADOR, lista «(reutilizados)» de `caja.html` (línea 282; ya aprobados en la versión anterior de la pantalla y en el salón): título de la pantalla y de la barra, y el estado de la caja.
  // «Efectivo» es `caja.medios.tipo.efectivo`. «Abierta» y «Cerrada» son las del estado de la sesión de caja (`caja.html`, `pillS`).
  "caja.pantalla.titulo": { porDefecto: "Caja" },
  "caja.estado.abierta": { porDefecto: "Abierta" },
  "caja.estado.cerrada": { porDefecto: "Cerrada" },
  // MOSTRADOR, «(reutilizados)»: los botones de abrir, cerrar, cancelar el cierre y contar.
  "caja.sesion.abrir": { porDefecto: "Abrir caja" },
  "caja.sesion.cerrar": { porDefecto: "Cerrar caja" },
  "caja.sesion.cancelar_cierre": { porDefecto: "Cancelar cierre" },
  "caja.sesion.contar": { porDefecto: "Contar" },
  // MOSTRADOR, «(reutilizados)»: Contar, columnas del arqueo («Observación» lleva «(opcional)» como en `caja.html`, `vCierre`, y como `caja.campo.nombre_opcional`).
  "caja.arqueo.esperado": { porDefecto: "Esperado" },
  "caja.arqueo.contado": { porDefecto: "Contado" },
  "caja.arqueo.diferencia": { porDefecto: "Diferencia" },
  "caja.arqueo.observacion_opcional": { porDefecto: "Observación (opcional)" },
  // MOSTRADOR, «(reutilizados)»: Contar, el efectivo por billetes y monedas, y su total.
  "caja.arqueo.billetes": { porDefecto: "Billetes" },
  "caja.arqueo.cantidad": { porDefecto: "Cantidad" },
  "caja.arqueo.monedas": { porDefecto: "Monedas" },
  "caja.arqueo.total_contado": { porDefecto: "Total contado" },
  // MOSTRADOR, «(reutilizados)»: los dos avisos de la pantalla («Esta acción no está permitida» es `caja.error.accion_no_permitida`).
  "caja.error.falta_contar_efectivo": { porDefecto: "Falta contar el efectivo" },
  "caja.error.importe_invalido": { porDefecto: "Importe no válido" },
  // MOSTRADOR, tabla «Textos nuevos» de `caja.html` (decisión 175 + e3b §8.1 filas 21 y 22, que reutilizan «Conforme», «Conforme general» y «Sin declarar» ya aprobados el 14/11/2026;
  // «Sin cuenta», decisión 151 y e3 §3.3): las claves son las que esa tabla declara.
  "caja.conforme": { porDefecto: "Conforme" },
  "caja.conforme_general": { porDefecto: "Conforme general" },
  "caja.sin_declarar": { porDefecto: "Sin declarar" },
  "caja.sin_cuenta": { porDefecto: "Sin cuenta" },
  // MOSTRADOR, tabla «Textos nuevos»: abrir caja con el día en cierre o cerrado (decisión 175 + e3b §8.1 filas 29 y 30, `JORNADA_EN_AUDITORIA` y `JORNADA_CERRADA`). La tabla los llama
  // `cierre.error.en_cierre` y `cierre.error.cerrada`; acá llevan el prefijo de este módulo (lo exige `catalogo.test.ts`) y el texto no cambia.
  "caja.error.en_cierre": { porDefecto: "El día está en cierre. Cancelá el cierre para seguir" },
  "caja.error.dia_cerrado": { porDefecto: "El día ya está cerrado" },
  // MOSTRADOR, M8 a M14 de `textos-mostrador-pendientes.md` (aprobados el 15/11/2026, DDD:171): tipo de movimiento, sentido del ajuste, botón que lo guarda, resumen de la última sesión y
  // cabecera «Jornada {fecha} · Corte {hora}» (M14 las nombra juntas; dos claves porque la pantalla pone entre ambas la fecha y la hora). M15 (el fondo sugerido) está aprobado y NO se muestra: sin clave.
  "caja.movimiento.ingreso": { porDefecto: "Ingreso" },
  "caja.movimiento.egreso": { porDefecto: "Egreso" },
  "caja.movimiento.ajuste": { porDefecto: "Ajuste" },
  "caja.ajuste.sobra": { porDefecto: "Sobra" },
  // SUPUESTO (DEC-0456): «Falta» es el sentido contrario de «Sobra» (M11: «el sentido contrario es "Falta"», `caja.html`, `vMov`); no tiene fila propia en `textos-mostrador-pendientes.md`.
  "caja.ajuste.falta": { porDefecto: "Falta" },
  "caja.movimiento.registrar": { porDefecto: "Registrar" },
  // SUPUESTO (DEC-0457): rótulos de la clase de cada movimiento de la lista; la maqueta aprobada los muestra («Fondo inicial», `caja.html` línea 382; «Cobro», línea 383; «Anulación», línea 502) y no tienen
  // fila propia en las tablas aprobadas: pendiente de confirmación del dueño. Revertirlo es sacar estas tres claves y el rótulo de la clase en `modelo-de-la-caja.ts`.
  "caja.movimiento.cobro": { porDefecto: "Cobro" },
  "caja.movimiento.fondo_inicial": { porDefecto: "Fondo inicial" },
  "caja.movimiento.anulacion": { porDefecto: "Anulación" },
  "caja.sesion.ultima": { porDefecto: "Última sesión" },
  "caja.sesion.jornada": { porDefecto: "Jornada" },
  "caja.sesion.corte": { porDefecto: "Corte" },
  // MOSTRADOR, T4 y T5 de `textos-nuevos-pendientes.md` (aprobados el 15/11/2026, DDD:165): «Anulado» (`caja.html:405`) y el aviso de motivo vacío (`caja.html:422`).
  "caja.estado.anulado": { porDefecto: "Anulado" },
  "caja.error.motivo_obligatorio": { porDefecto: "Escribí el motivo" },
  // MOSTRADOR, rótulos de los formularios (`caja.html`, `vAbrir`, `vMov` y `vModal`): «Anular» (APR N.º 214) y «Motivo» (APR N.º 215) están aprobados el 09/11/2026 (`textos-nuevos-pendientes.md`,
  // fila T5); «Importe» es la palabra aprobada del prototipo v8 (D-111, 2026-11-04, `fiscal.pantalla.imprimir_rotulo_importe`); «Cancelar» es la de todos los modales (`catalogo.accion.cancelar`).
  // SUPUESTO (DEC-0456): «Fondo inicial» no tiene fila propia en las tablas aprobadas que encontré (`servidor-del-mostrador-minimo.md` §8); se declara por el pedido del orquestador de la pantalla Caja
  // (delegación de las filas 173 a 175 del 15/11/2026). Revertirlo es sacar esta clave y el rótulo del campo.
  "caja.campo.fondo_inicial": { porDefecto: "Fondo inicial" },
  "caja.campo.importe": { porDefecto: "Importe" },
  "caja.campo.motivo": { porDefecto: "Motivo" },
  "caja.accion.anular": { porDefecto: "Anular" },
  "caja.accion.cancelar": { porDefecto: "Cancelar" },
} as const;
