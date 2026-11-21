/**
 * Los textos del módulo `caja` (prefijo `caja.`). Nace vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 *
 * MEDIOS = `Pedernal-docs/10-ux-ui/prototipos-gastronomia/medios.html` («Medios de pago, cuentas y cajas», maqueta APROBADA por el dueño el
 * 09/11/2026; mapa de pantallas B1). Su tabla «Textos nuevos» dice que esa versión no suma ninguno y reutiliza los aprobados el 09/11/2026:
 * «Medios de pago · Cuentas de cobro · Cajas · Agregar medio · … · Nombre · Tipo · Editar · Desactivar · Reactivar · Desactivado · Activo ·
 * Guardar · … · Cuenta de cobro: no lleva · opcional · Ya existe un medio con ese nombre · … · Esta acción no está permitida». Los nombres de
 * los tipos de medio son los del arreglo `TIPOS` de la misma maqueta (los cinco primeros, también en `salon.html` «Efectivo, Tarjeta de débito,
 * Tarjeta de crédito, Transferencia, QR»: `caja-y-cobros.md`, texto exacto aprobado el 09/11/2026). Ningún texto de acá está fuera de esa tabla.
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
  // DATOS DEL COBRO (T4a), `datos-cobro.html` (maqueta aprobada el 09/11/2026, ajustada el 15/11), tabla «Textos nuevos»: «Datos que se piden al cobrar» (pantallas) y «Cupón · Últimos 4 dígitos ·
  // Marca de la tarjeta · Cuotas · DNI» (datos). Aprobados por el dueño el 09/11/2026; el 15/11 se ajustó la pantalla (decisión 184, ficha `pantalla-medios-de-pago-datos-del-cobro.md` §7). DEC-0585.
  "caja.medios.datos_que_se_piden": { porDefecto: "Datos que se piden al cobrar" },
  "caja.dato.cupon": { porDefecto: "Cupón" },
  "caja.dato.ultimos4": { porDefecto: "Últimos 4 dígitos" },
  "caja.dato.marca": { porDefecto: "Marca de la tarjeta" },
  "caja.dato.cuotas": { porDefecto: "Cuotas" },
  "caja.dato.dni": { porDefecto: "DNI" },
  // MEDIOS, tabla «(reutilizados)»: los dos avisos de error de esta pantalla («Ya existe un medio con ese nombre» y el genérico).
  "caja.error.medio_repetido": { porDefecto: "Ya existe un medio con ese nombre" },
  "caja.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
  // MOSTRADOR, lista «(reutilizados)» de `caja.html` (línea 282; ya aprobados en la versión anterior de la pantalla): título de la pantalla y de la barra, el estado de la caja y «Abrir caja».
  // «Abierta» y «Cerrada» son las del estado de la sesión de caja (`caja.html`, `pillS`). «Jornada» y «Corte» arman la cabecera «Jornada {fecha} · Corte {hora}» (M14 de `textos-mostrador-pendientes.md`,
  // aprobado el 15/11/2026, DDD:171). «Cancelar» es la de todos los modales (`catalogo.accion.cancelar`).
  "caja.pantalla.titulo": { porDefecto: "Caja" },
  "caja.estado.abierta": { porDefecto: "Abierta" },
  "caja.estado.cerrada": { porDefecto: "Cerrada" },
  "caja.sesion.abrir": { porDefecto: "Abrir caja" },
  "caja.sesion.jornada": { porDefecto: "Jornada" },
  "caja.sesion.corte": { porDefecto: "Corte" },
  // SUPUESTO (DEC-0475): «Fondo inicial» no tiene fila propia en las tablas aprobadas (`servidor-del-mostrador-minimo.md` §8); se declara por delegación del dueño (DDD filas 173 y 174).
  // Revertirlo es sacar esta clave y el rótulo del campo.
  "caja.campo.fondo_inicial": { porDefecto: "Fondo inicial" },
  "caja.accion.cancelar": { porDefecto: "Cancelar" },
  // MOSTRADOR, «(reutilizados)»: cerrar caja, cancelar el cierre y contar.
  "caja.sesion.cerrar": { porDefecto: "Cerrar caja" },
  "caja.sesion.cancelar_cierre": { porDefecto: "Cancelar cierre" },
  "caja.sesion.contar": { porDefecto: "Contar" },
  // MOSTRADOR, «(reutilizados)»: Contar, columnas del arqueo («Observación» lleva «(opcional)» como en `caja.html`, `vCierre`, y como `caja.campo.nombre_opcional`), el efectivo por billetes y monedas y su total.
  "caja.arqueo.esperado": { porDefecto: "Esperado" },
  "caja.arqueo.contado": { porDefecto: "Contado" },
  "caja.arqueo.diferencia": { porDefecto: "Diferencia" },
  "caja.arqueo.observacion_opcional": { porDefecto: "Observación (opcional)" },
  "caja.arqueo.billetes": { porDefecto: "Billetes" },
  "caja.arqueo.cantidad": { porDefecto: "Cantidad" },
  "caja.arqueo.monedas": { porDefecto: "Monedas" },
  "caja.arqueo.total_contado": { porDefecto: "Total contado" },
  // MOSTRADOR, tabla «Textos nuevos» de `caja.html` (decisión 175 + e3b §8.1 filas 21 y 22, que reutilizan «Conforme», «Conforme general» y «Sin declarar» ya aprobados el 14/11/2026;
  // «Sin cuenta», decisión 151 y e3 §3.3): las claves son las que esa tabla declara.
  "caja.conforme": { porDefecto: "Conforme" },
  "caja.conforme_general": { porDefecto: "Conforme general" },
  "caja.sin_declarar": { porDefecto: "Sin declarar" },
  "caja.sin_cuenta": { porDefecto: "Sin cuenta" },
  // MOSTRADOR, M12 y T4 (aprobados el 15/11/2026, DDD:171 y DDD:165): resumen de la última sesión y «Anulado» (`caja.html:405`).
  "caja.sesion.ultima": { porDefecto: "Última sesión" },
  "caja.estado.anulado": { porDefecto: "Anulado" },
  // SUPUESTO (DEC-0476): rótulos de la clase de cada movimiento de la lista; la maqueta aprobada los muestra («Fondo inicial», `caja.html` línea 382; «Cobro», línea 383; «Anulación», línea 502) y no
  // tienen fila propia en las tablas aprobadas. Revertirlo es sacar estas tres claves y el rótulo de la clase en `modelo-de-la-caja.ts`.
  "caja.movimiento.cobro": { porDefecto: "Cobro" },
  "caja.movimiento.fondo_inicial": { porDefecto: "Fondo inicial" },
  "caja.movimiento.anulacion": { porDefecto: "Anulación" },
} as const;
