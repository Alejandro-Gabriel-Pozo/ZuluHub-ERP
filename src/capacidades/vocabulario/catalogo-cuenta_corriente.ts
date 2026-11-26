import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la cuenta corriente de clientes (prefijo `cuenta_corriente.`, CC-5 A1: el listado y la ficha de lectura). Todos salen de la maqueta `cuenta-corriente-ficha-listado-y-cobro.html` (versión 2,
 * Pedernal-docs `11-especificaciones/briefs/maquetas/`), que el dueño aprobó el 26/11/2026 con su chat («Apruebo», con lo ya decidido aplicado: sin pies explicativos, «Excedida», «Crédito disponible», «Origen del
 * movimiento»); el orquestador los asentó en `DEC-CCL-004` (delegación del 15/11/2026, fila 173). Lo que la maqueta tiene y todavía no se usa (habilitar, suspender, reactivar, cambiar condiciones, exportar, cobrar) entra con su
 * pantalla. Se reutilizan los que ya existían (Cliente, Estado, Fecha, Importe, Vence, Anulación, Sucursal, Salón, Mostrador, los tipos de medio y «Sin resultados»): no se duplican.
 * El banner de una cuenta suspendida lleva el motivo SIN «(quién, cuándo)»: la ficha guarda el motivo y no quién ni cuándo suspendió (SUPUESTO (DEC-CCL-005)).
 */
const FUENTE: FuenteDeTexto = { decision: "DEC-CCL-004" };
const FUENTE_DEL_BANNER: FuenteDeTexto = { decision: "DEC-CCL-005" };
const MODELO = "apps/web/ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente.ts";
const TEXTOS = "apps/web/ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente.ts";
const DE_LOS_TEXTOS: UsoDeTexto = {
  como: "FUNCION",
  archivo: TEXTOS,
  nombre: "textosDeCuentaCorriente",
};
const DEL_MODELO: UsoDeTexto = {
  como: "FUNCION",
  archivo: MODELO,
  nombre: "armarLaListaDeCuentas",
};

export const TEXTOS_DE_CUENTA_CORRIENTE = {
  // Entrada del menú («Caja → Cuenta corriente», cabecera de la maqueta).
  "cuenta_corriente.menu.entrada": {
    porDefecto: "Cuenta corriente",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  // Listado.
  "cuenta_corriente.lista.titulo": {
    porDefecto: "Clientes con cuenta corriente",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.ordenar_por_saldo": {
    porDefecto: "Ordenar por saldo",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.ordenar_por_vencido": {
    porDefecto: "Ordenar por vencido",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.ordenar_por_antiguedad": {
    porDefecto: "Ordenar por antigüedad",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.saldo": { porDefecto: "Saldo", usos: [DE_LOS_TEXTOS], fuente: FUENTE },
  "cuenta_corriente.lista.vencido": {
    porDefecto: "Vencido",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.limite": { porDefecto: "Límite", usos: [DE_LOS_TEXTOS], fuente: FUENTE },
  // Crédito disponible: el texto propio del crédito (no el «Disponible» de stock), en el listado, la ficha y la hoja de elegir cliente.
  "cuenta_corriente.credito_disponible": {
    porDefecto: "Crédito disponible",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.cargo_mas_antiguo": {
    porDefecto: "Cargo más antiguo",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.lista.dias": {
    porDefecto: "{n} días",
    marcadores: ["n"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  // Estados de la cuenta de un cliente; «Excedida» es derivado (saldo por encima del límite), no un estado de la ficha.
  "cuenta_corriente.estado.habilitada": {
    porDefecto: "Habilitada",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.estado.suspendida": {
    porDefecto: "Suspendida",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.estado.excedida": {
    porDefecto: "Excedida",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  // Ficha y estado de cuenta.
  "cuenta_corriente.ficha.cuit": {
    porDefecto: "CUIT {cuit}",
    marcadores: ["cuit"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  "cuenta_corriente.ficha.limite_de_credito": {
    porDefecto: "Límite de crédito",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.ficha.plazo": { porDefecto: "Plazo", usos: [DE_LOS_TEXTOS], fuente: FUENTE },
  "cuenta_corriente.movimiento.movimiento": {
    porDefecto: "Movimiento",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.origen_del_movimiento": {
    porDefecto: "Origen del movimiento",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.venta_a_cuenta": {
    porDefecto: "Venta a cuenta",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.cobranza": {
    porDefecto: "Cobranza · {medio}",
    marcadores: ["medio"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.venta_anulada": {
    porDefecto: "Venta anulada",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.vencida": {
    porDefecto: "Vencida",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.origen_ticket": {
    porDefecto: "Ticket {n} · {canal} · {sucursal}",
    marcadores: ["n", "canal", "sucursal"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.origen_cobro": {
    porDefecto: "Cobro del ticket {n}",
    marcadores: ["n"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  "cuenta_corriente.movimiento.origen_anulacion": {
    porDefecto: "Ticket {n} (se anuló el cargo)",
    marcadores: ["n"],
    usos: [DEL_MODELO],
    fuente: FUENTE,
  },
  // Banner de la cuenta suspendida: «Cuenta suspendida:» y el detalle de la maqueta SIN «({persona}, {fecha})» (DEC-CCL-005).
  "cuenta_corriente.ficha.suspendida": {
    porDefecto: "Cuenta suspendida:",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE,
  },
  "cuenta_corriente.ficha.suspendida_detalle": {
    porDefecto:
      "no se puede vender a cuenta a este cliente. Motivo: «{motivo}». Los cobros siguen entrando.",
    largoMaximo: 120,
    marcadores: ["motivo"],
    usos: [DEL_MODELO],
    fuente: FUENTE_DEL_BANNER,
  },
} as const;
