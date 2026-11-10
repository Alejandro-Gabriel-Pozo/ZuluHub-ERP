import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  MAXIMO_DE_REFERENCIAS,
  type AporteAlCierreDelDia,
  type ControlDelDia,
  type ErrorDeAporte,
  type JornadaRef,
  type Severidad,
} from "../cierre/publico";
import {
  huellaDelDetalle,
  referenciasDelDetalle,
  type FilaDelDetalle,
} from "./dominio/detalle-del-control";
import type { LecturasDeVentas } from "./persistencia/repositorio-de-lecturas";

/**
 * LO QUE VENTAS REVISA AL CIERRE DEL DÍA (E4 §3.15): implementa `AporteAlCierreDelDia` de `cierre`, que la composición registra. Solo lee y
 * reporta; el reconocimiento (quién y por qué) lo guarda `cierre`. Seis controles, por jornada `(sucursal, fecha de negocio)`:
 * `cuentas_abiertas` BLOQUEA (una cuenta abierta no se puede cerrar ni cobrar mientras se audita; la salida es anularla), `tickets_por_cobrar`
 * y `cortesias` piden reconocimiento, y `anulaciones`, `correcciones` y `pendientes_de_facturar` informan. Determinista: la misma jornada da
 * la misma huella. `congelarEnTx` no escribe (tickets, anulaciones y correcciones ya son inmutables y con quién y cuándo). Si una lectura
 * falla, `APORTE_NO_DISPONIBLE`: el día no se cierra con un dato que no se pudo leer.
 */
export type TxDeAporteDeVentas = Readonly<{
  lecturasDeVentas: Pick<
    LecturasDeVentas,
    | "cuentasAbiertas"
    | "ticketsDeLaJornada"
    | "cortesiasDeLaJornada"
    | "anulacionesDeLaJornada"
    | "correccionesDeLaJornada"
  >;
}>;

function control(
  clave: string,
  severidad: Severidad,
  tipoDeReferencia: string,
  filas: readonly FilaDelDetalle[],
): ControlDelDia {
  return {
    modulo: "ventas",
    clave: `ventas.${clave}`,
    severidad,
    cantidad: filas.length,
    huellaDelDetalle: huellaDelDetalle(filas),
    referencias: referenciasDelDetalle(tipoDeReferencia, filas, MAXIMO_DE_REFERENCIAS),
  };
}

async function leerControles(
  tx: TxDeAporteDeVentas,
  jornada: JornadaRef,
): Promise<ControlDelDia[]> {
  const l = tx.lecturasDeVentas;
  const { empresaId, sucursalId, fechaDeNegocio } = jornada;
  const [abiertas, tickets, cortesias, anulaciones, correcciones] = await Promise.all([
    l.cuentasAbiertas(empresaId, sucursalId),
    l.ticketsDeLaJornada(empresaId, sucursalId, fechaDeNegocio),
    l.cortesiasDeLaJornada(empresaId, sucursalId, fechaDeNegocio),
    l.anulacionesDeLaJornada(empresaId, sucursalId, fechaDeNegocio),
    l.correccionesDeLaJornada(empresaId, sucursalId, fechaDeNegocio),
  ]);
  return [
    control(
      "cuentas_abiertas",
      "BLOQUEA",
      "ventas.cuenta",
      abiertas.map((c) => ({ numero: null, id: c.cuentaId, datos: c.totalProvisorio })),
    ),
    control(
      "tickets_por_cobrar",
      "RECONOCIBLE",
      "ventas.ticket",
      tickets
        .filter((t) => t.estado === "EMITIDO")
        .map((t) => ({ numero: t.numero, id: t.ticketId, datos: t.totalVigente })),
    ),
    control(
      "cortesias",
      "RECONOCIBLE",
      "ventas.ticket",
      cortesias.map((c) => ({ numero: c.numero, id: c.ticketId, datos: c.tipo })),
    ),
    control(
      "anulaciones",
      "INFORMA",
      "ventas.cuenta",
      anulaciones.map((a) => ({
        numero: null,
        id: a.lineaId ?? a.cuentaId,
        datos: `${a.tipo}:${a.importe}`,
      })),
    ),
    control(
      "correcciones",
      "INFORMA",
      "ventas.ticket",
      correcciones.map((c) => ({
        numero: c.numero,
        id: c.ticketId,
        datos: `${c.tipo}:${c.diferencia}`,
      })),
    ),
    control(
      "pendientes_de_facturar",
      "INFORMA",
      "ventas.ticket",
      tickets
        .filter((t) => t.estado === "COBRADO")
        .map((t) => ({ numero: t.numero, id: t.ticketId, datos: t.totalVigente })),
    ),
  ];
}

async function protegido<T>(leer: () => Promise<T>): Promise<Resultado<T, ErrorDeAporte>> {
  try {
    return ok(await leer());
  } catch {
    return err("APORTE_NO_DISPONIBLE");
  }
}

export const aporteDeVentas: AporteAlCierreDelDia<TxDeAporteDeVentas> = {
  modulo: "ventas",
  async impedimentos(tx, jornada) {
    return protegido(async () =>
      (await leerControles(tx, jornada)).filter((c) => c.severidad === "BLOQUEA"),
    );
  },
  /**
   * ¿Hay movimiento de ventas en la jornada? (decisión 178): una cuenta abierta de la sucursal, un ticket de la jornada (por cobrar, cobrado,
   * cortesía o anulado), una anulación o una corrección. Cualquier control con filas cuenta, también el de tickets cobrados que esperan su
   * comprobante: una venta cobrada es una venta sin revisar. Sin nada de eso, desactivar la sucursal no pierde ninguna venta. Un fallo de
   * lectura es `APORTE_NO_DISPONIBLE`.
   */
  async hayMovimiento(tx, jornada) {
    return protegido(async () => (await leerControles(tx, jornada)).some((c) => c.cantidad > 0));
  },
  async controles(tx, jornada) {
    return protegido(() => leerControles(tx, jornada));
  },
  congelarEnTx() {
    return Promise.resolve(ok(null));
  },
};
