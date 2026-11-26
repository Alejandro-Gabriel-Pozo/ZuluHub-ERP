import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  formatearFecha,
  formatearImporte,
  formatearNumeroDeDocumento,
} from "../../patrones/formato-fiscal";
import {
  direccionDelListadoDeCuentas,
  rutaDeLaFichaDeCuenta,
  type OrdenDelListado,
} from "./rutas-de-cuenta-corriente";
import type { TextosDeCuentaCorriente } from "./textos-de-cuenta-corriente";

/**
 * El modelo de vista de la cuenta corriente de clientes (CC-5, A1; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`): cada fila del listado, la ficha con su estado de cuenta y lo que se muestra de cada
 * movimiento. Puro: sin React ni servidor. Lo que llega es lo que entrega el servidor (`cuenta-corriente-web.ts`): importes como texto decimal exacto, fechas `AAAA-MM-DD`. El modelo NO calcula nada de dinero
 * (ni saldo, ni vencido, ni crédito): muestra lo que devolvió el servidor. Todo dato ausente es «—», nunca cero ni un texto inventado.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;
type EstadoVisible = "HABILITADA" | "SUSPENDIDA" | "EXCEDIDA";
type Tono = "exito" | "aviso" | "peligro";

export type ListaDeCuentasParaLaPantalla = Readonly<{
  orden: OrdenDelListado;
  alDia: string;
  clientes: readonly Readonly<{
    parteId: string;
    nombre: string | null;
    cuit: string | null;
    estado: EstadoVisible;
    saldo: Importe;
    vencido: Importe;
    limite: Importe;
    disponible: Importe;
    cargoMasAntiguo: Readonly<{ fecha: string; dias: number }> | null;
  }>[];
}>;

export type FichaDeCuentaParaLaPantalla = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
  estado: EstadoVisible;
  motivoDeSuspension: string | null;
  plazoDias: number;
  limite: Importe;
  saldo: Importe;
  disponible: Importe;
  movimientos: readonly Readonly<{
    fecha: string;
    tipo: "VENTA_A_CUENTA" | "VENTA_ANULADA" | "COBRANZA" | "COBRANZA_ANULADA" | "OTRO";
    vence: string | null;
    vencida: boolean;
    importe: Importe;
    ticket: Readonly<{
      numero: number;
      canal: "SALON" | "MOSTRADOR";
      sucursal: string | null;
    }> | null;
    medioDePago: string | null;
  }>[];
}>;

const SIN_DATO = "—";

const importe = (i: Importe): string => formatearImporte(i.monto);
const dias = (n: number): string => texto({}, "cuenta_corriente.lista.dias", { n: String(n) });

function estadoArmado(
  estado: EstadoVisible,
  t: TextosDeCuentaCorriente,
): Readonly<{ texto: string; tono: Tono }> {
  if (estado === "SUSPENDIDA") return { texto: t.suspendida, tono: "peligro" };
  if (estado === "EXCEDIDA") return { texto: t.excedida, tono: "aviso" };
  return { texto: t.habilitada, tono: "exito" };
}

export type ListaArmada = Readonly<{
  titulo: string;
  ordenes: readonly Readonly<{
    orden: OrdenDelListado;
    texto: string;
    href: string;
    activo: boolean;
  }>[];
  columnas: Readonly<{
    cliente: string;
    estado: string;
    saldo: string;
    vencido: string;
    limite: string;
    creditoDisponible: string;
    cargoMasAntiguo: string;
  }>;
  filas: readonly Readonly<{
    id: string;
    href: string;
    /** El nombre accesible del enlace: el cliente y su CUIT, completos. */
    nombreAccesible: string;
    cliente: string;
    cuit: string;
    estado: Readonly<{ texto: string; tono: Tono }>;
    saldo: string;
    vencido: string;
    limite: string;
    creditoDisponible: string;
    cargoMasAntiguo: string;
  }>[];
  /** El texto de la lista vacía; `null` si hay clientes. */
  vacio: string | null;
}>;

export function armarLaListaDeCuentas(
  lista: ListaDeCuentasParaLaPantalla,
  t: TextosDeCuentaCorriente,
): ListaArmada {
  const ordenes: readonly Readonly<{ orden: OrdenDelListado; texto: string }>[] = [
    { orden: "SALDO", texto: t.ordenarPorSaldo },
    { orden: "VENCIDO", texto: t.ordenarPorVencido },
    { orden: "ANTIGUEDAD", texto: t.ordenarPorAntiguedad },
  ];
  return {
    titulo: t.titulo,
    ordenes: ordenes.map((o) => ({
      ...o,
      href: direccionDelListadoDeCuentas(o.orden),
      activo: o.orden === lista.orden,
    })),
    columnas: {
      cliente: t.cliente,
      estado: t.estado,
      saldo: t.saldo,
      vencido: t.vencido,
      limite: t.limite,
      creditoDisponible: t.creditoDisponible,
      cargoMasAntiguo: t.cargoMasAntiguo,
    },
    filas: lista.clientes.map((c) => {
      const cliente = c.nombre ?? t.cliente;
      const cuit = c.cuit ?? SIN_DATO;
      return {
        id: c.parteId,
        href: rutaDeLaFichaDeCuenta(c.parteId),
        nombreAccesible: `${cliente} · ${cuit}`,
        cliente,
        cuit,
        estado: estadoArmado(c.estado, t),
        saldo: importe(c.saldo),
        vencido: importe(c.vencido),
        limite: importe(c.limite),
        creditoDisponible: importe(c.disponible),
        cargoMasAntiguo:
          c.cargoMasAntiguo === null
            ? SIN_DATO
            : `${formatearFecha(c.cargoMasAntiguo.fecha)} · ${dias(c.cargoMasAntiguo.dias)}`,
      };
    }),
    vacio: lista.clientes.length === 0 ? t.sinResultados : null,
  };
}

type TipoDeMovimiento = FichaDeCuentaParaLaPantalla["movimientos"][number]["tipo"];

const CLAVE_DEL_MEDIO: Readonly<Record<string, Parameters<typeof texto>[1]>> = {
  EFECTIVO: "caja.medios.tipo.efectivo",
  TARJETA_DEBITO: "caja.medios.tipo.tarjeta_debito",
  TARJETA_CREDITO: "caja.medios.tipo.tarjeta_credito",
  TRANSFERENCIA: "caja.medios.tipo.transferencia",
  QR: "caja.medios.tipo.qr",
  OTRO: "caja.medios.tipo.otro",
};

/** El texto del medio de una cobranza; uno que no se pudo determinar (varios medios o ninguno) es «—». */
const medio = (tipo: string | null): string =>
  tipo !== null && Object.hasOwn(CLAVE_DEL_MEDIO, tipo)
    ? texto({}, CLAVE_DEL_MEDIO[tipo] as Parameters<typeof texto>[1])
    : SIN_DATO;

export type FichaArmada = Readonly<{
  /** El título de la pantalla: el nombre del cliente. */
  titulo: string;
  cuit: string;
  estado: Readonly<{ texto: string; tono: Tono }>;
  /** El banner de una cuenta suspendida; `null` si no lo está. */
  suspendida: Readonly<{ titulo: string; detalle: string }> | null;
  condiciones: Readonly<{
    limiteDeCredito: Readonly<{ rotulo: string; valor: string }>;
    plazo: Readonly<{ rotulo: string; valor: string }>;
    saldo: Readonly<{ rotulo: string; valor: string }>;
    creditoDisponible: Readonly<{ rotulo: string; valor: string }>;
  }>;
  columnas: Readonly<{
    fecha: string;
    movimiento: string;
    origenDelMovimiento: string;
    vence: string;
    importe: string;
  }>;
  movimientos: readonly Readonly<{
    clave: string;
    fecha: string;
    movimiento: string;
    origen: string;
    vence: string;
    vencida: string | null;
    importe: string;
  }>[];
}>;

export function armarLaFichaDeLaCuenta(
  ficha: FichaDeCuentaParaLaPantalla,
  t: TextosDeCuentaCorriente,
): FichaArmada {
  const nombreDelMovimiento = (tipo: TipoDeMovimiento, tipoDeMedio: string | null): string => {
    if (tipo === "VENTA_A_CUENTA") return t.ventaACuenta;
    if (tipo === "VENTA_ANULADA") return t.ventaAnulada;
    if (tipo === "COBRANZA") {
      return texto({}, "cuenta_corriente.movimiento.cobranza", { medio: medio(tipoDeMedio) });
    }
    if (tipo === "COBRANZA_ANULADA") return t.anulacion;
    return SIN_DATO;
  };
  const origenDelMovimiento = (
    tipo: TipoDeMovimiento,
    ticket: FichaDeCuentaParaLaPantalla["movimientos"][number]["ticket"],
  ): string => {
    if (ticket === null) return SIN_DATO;
    const n = String(ticket.numero);
    if (tipo === "VENTA_A_CUENTA") {
      return texto({}, "cuenta_corriente.movimiento.origen_ticket", {
        n,
        canal: ticket.canal === "SALON" ? t.salon : t.mostrador,
        sucursal: ticket.sucursal ?? SIN_DATO,
      });
    }
    if (tipo === "VENTA_ANULADA")
      return texto({}, "cuenta_corriente.movimiento.origen_anulacion", { n });
    if (tipo === "COBRANZA" || tipo === "COBRANZA_ANULADA") {
      return texto({}, "cuenta_corriente.movimiento.origen_cobro", { n });
    }
    return SIN_DATO;
  };
  return {
    titulo: ficha.nombre ?? t.cliente,
    cuit: texto({}, "cuenta_corriente.ficha.cuit", { cuit: ficha.cuit ?? SIN_DATO }),
    estado: estadoArmado(ficha.estado, t),
    suspendida:
      ficha.estado === "SUSPENDIDA" && ficha.motivoDeSuspension !== null
        ? {
            titulo: t.cuentaSuspendida,
            detalle: texto({}, "cuenta_corriente.ficha.suspendida_detalle", {
              motivo: ficha.motivoDeSuspension,
            }),
          }
        : null,
    condiciones: {
      limiteDeCredito: { rotulo: t.limiteDeCredito, valor: importe(ficha.limite) },
      plazo: { rotulo: t.plazo, valor: dias(ficha.plazoDias) },
      saldo: { rotulo: t.saldo, valor: importe(ficha.saldo) },
      creditoDisponible: { rotulo: t.creditoDisponible, valor: importe(ficha.disponible) },
    },
    columnas: {
      fecha: t.fecha,
      movimiento: t.movimiento,
      origenDelMovimiento: t.origenDelMovimiento,
      vence: t.vence,
      importe: t.importe,
    },
    movimientos: ficha.movimientos.map((m, i) => ({
      clave: `${i}-${m.fecha}`,
      fecha: formatearFecha(m.fecha),
      movimiento: nombreDelMovimiento(m.tipo, m.medioDePago),
      origen: origenDelMovimiento(m.tipo, m.ticket),
      vence: m.vence === null ? SIN_DATO : formatearFecha(m.vence),
      vencida: m.vencida ? t.vencida : null,
      importe: importe(m.importe),
    })),
  };
}

/** Un cliente que se puede elegir para habilitar. */
export type ClienteParaHabilitarDeLaPantalla = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
}>;

/**
 * Las opciones del selector de «Habilitar cuenta corriente»: «Nombre · CUIT». Un cliente sin nombre se ve con el rótulo «Cliente» (nunca un nombre inventado) y uno sin CUIT, con «—»; ese se puede elegir para ver el aviso,
 * pero no se habilita (`tieneCuit`). El orden es el del servidor.
 */
export function clientesParaElegir(
  clientes: readonly ClienteParaHabilitarDeLaPantalla[],
  t: TextosDeCuentaCorriente,
): readonly Readonly<{ parteId: string; etiqueta: string; nombre: string; tieneCuit: boolean }>[] {
  return clientes.map((c) => {
    const nombre = c.nombre ?? t.cliente;
    const cuit = c.cuit === null ? SIN_DATO : formatearNumeroDeDocumento("CUIT", c.cuit);
    return {
      parteId: c.parteId,
      etiqueta: `${nombre} · ${cuit}`,
      nombre,
      tieneCuit: c.cuit !== null,
    };
  });
}
