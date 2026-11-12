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
  // MEDIOS, tabla «(reutilizados)»: los dos avisos de error de esta pantalla («Ya existe un medio con ese nombre» y el genérico).
  "caja.error.medio_repetido": { porDefecto: "Ya existe un medio con ese nombre" },
  "caja.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
} as const;
