import { TEXTOS_DE_EXPORTACION_DE_CUENTA_CORRIENTE } from "./textos-de-exportacion-de-cuenta-corriente";
import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la cuenta corriente de clientes (prefijo `cuenta_corriente.`, CC-5 A1: el listado y la ficha de lectura). Todos salen de la maqueta `cuenta-corriente-ficha-listado-y-cobro.html` (versión 2,
 * Pedernal-docs `11-especificaciones/briefs/maquetas/`), que el dueño aprobó el 26/11/2026 con su chat («Apruebo», con lo ya decidido aplicado: sin pies explicativos, «Excedida», «Crédito disponible», «Origen del
 * movimiento»); el orquestador los asentó en `DEC-CCL-004` (delegación del 15/11/2026, fila 173). Lo que la maqueta tiene y todavía no se usa (habilitar, suspender, reactivar, cambiar condiciones, exportar, cobrar) entra con su
 * pantalla. Se reutilizan los que ya existían (Cliente, Estado, Fecha, Importe, Vence, Anulación, Sucursal, Salón, Mostrador, los tipos de medio y «Sin resultados»): no se duplican.
 * CC-5 A2 (habilitar, cambiar plazo o límite, suspender y reactivar): los textos de la misma maqueta, asentados en `DEC-CCL-006`; la maqueta trae un pie explicativo en el formulario de habilitar que NO se usa (interfaz sobria).
 * CC-5 B1b (la hoja «Vender a cuenta corriente» del cobro): ocho textos de las maquetas `cuenta-corriente-elegir-cliente` y `cuenta-corriente-aprobar-exceso`, asentados en `DEC-CCL-008`. NO se usa lo que la maqueta tiene de la
 * aprobación del exceso («Hace falta la aprobación de un gerente», «Pedir aprobación a un gerente») ni el límite a la vista de quien vende; la oración de permiso va completa. El resto se reutiliza (Cliente, Crédito disponible, CUIT, días, estados).
 * El banner de una cuenta suspendida lleva el motivo SIN «(quién, cuándo)»: la ficha guarda el motivo y no quién ni cuándo suspendió (decisión del dueño, DEC-CCL-005).
 */
const FUENTE: FuenteDeTexto = { decision: "DEC-CCL-004" };
const FUENTE_DEL_BANNER: FuenteDeTexto = { decision: "DEC-CCL-005" };
const FUENTE_DE_A2: FuenteDeTexto = { decision: "DEC-CCL-006" };
const FUENTE_DE_VENDER: FuenteDeTexto = { decision: "DEC-CCL-008" };
const DE_LOS_TEXTOS_DE_VENDER: UsoDeTexto = {
  como: "FUNCION",
  archivo: "apps/web/ui/plantillas/cobrar/textos-de-vender-a-cuenta.ts",
  nombre: "textosDeVenderACuenta",
};
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
  // A2: habilitar a un cliente (botón del listado y formulario), cambiar plazo o límite, suspender y reactivar (maqueta v2 «Habilitar cuenta» y «Ficha suspendida»).
  "cuenta_corriente.lista.habilitar_cliente": {
    porDefecto: "Habilitar cliente",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.titulo": {
    porDefecto: "Habilitar cuenta corriente",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.elegir_cliente": {
    porDefecto: "Elegí un cliente…",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.razon_social": {
    porDefecto: "Razón social",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.limite": {
    porDefecto: "Límite de crédito (ARS)",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.falta_cuit": {
    porDefecto: "Falta el CUIT:",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.falta_cuit_detalle": {
    porDefecto:
      "este cliente no tiene CUIT cargado. Para habilitar la cuenta corriente, el cliente necesita CUIT y razón social. Cargalo en la ficha del cliente.",
    largoMaximo: 200,
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.habilitar.habilitar": {
    porDefecto: "Habilitar",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.ficha.cambiar_condiciones": {
    porDefecto: "Cambiar plazo o límite",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.ficha.suspender": {
    porDefecto: "Suspender cuenta",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.ficha.motivo_de_suspension": {
    porDefecto: "Motivo de la suspensión (obligatorio)",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.ficha.motivo_de_reactivacion": {
    porDefecto: "Motivo de la reactivación (obligatorio)",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  "cuenta_corriente.ficha.reactivar": {
    porDefecto: "Reactivar cuenta",
    usos: [DE_LOS_TEXTOS],
    fuente: FUENTE_DE_A2,
  },
  // CC-5 B1b: la hoja «Vender a cuenta corriente» (DEC-CCL-008).
  "cuenta_corriente.vender.titulo": {
    porDefecto: "Vender a cuenta corriente",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.saldo_actual": {
    porDefecto: "Saldo actual",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.esta_venta": {
    porDefecto: "Esta venta",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.saldo_despues": {
    porDefecto: "Saldo después",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.confirmar": {
    porDefecto: "Confirmar venta a cuenta",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.elegir_otro_cliente": {
    porDefecto: "Elegir otro cliente",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.supera_el_limite": {
    porDefecto: "Esta venta supera el límite de crédito del cliente.",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  "cuenta_corriente.vender.sin_permiso_para_aprobar": {
    porDefecto:
      "No tenés permiso para aprobar este exceso. Pedile a un gerente o administrador que lo apruebe.",
    usos: [DE_LOS_TEXTOS_DE_VENDER],
    fuente: FUENTE_DE_VENDER,
  },
  // La exportación a Excel (CC-5 D): sus diez textos nuevos viven aparte.
  ...TEXTOS_DE_EXPORTACION_DE_CUENTA_CORRIENTE,
} as const;
