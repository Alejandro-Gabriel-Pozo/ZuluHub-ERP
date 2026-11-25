import { explicacionDesdeTexto } from "../../cierre/publico";
import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { exigirClave, huellaDeCampos, huellaDeComando } from "../../../primitivas/libro/publico";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { claseDe, type Sentido } from "./clases";
import { distribucionValida, type Reparto } from "./distribucion";
import type { ErrorDelLibro } from "./errores";

/**
 * El pedido de un asiento, armado y validado ANTES de escribir (la base repite cada regla: es la defensa final). Función pura de la entrada: la
 * misma entrada da siempre la misma huella (la hora `hechoEn` NO entra: no la manda la persona y un reintento daría otra huella).
 * Los importes entran como `Importe` (centavos enteros, moneda explícita) y salen a la frontera como texto decimal (ADR-006). Todo nace cerrado:
 * lo que no se declara acá (clase, origen, referencia, vencimiento, detalle) no pasa.
 */
export const TOPE_DEL_IMPORTE_EN_CENTAVOS = 99_999_999_999n; // 999999999,99: el CHECK `asiento_de_saldo_importe_tope_ck`
export const ORDEN_MAXIMO_DEL_ORIGEN = 1000;
const FORMA_DE_ORIGEN = /^[a-z_]+\.[a-z_]+$/;
const LARGO_MAXIMO_DEL_TIPO = 80; // fuente-unica: ajeno — el largo del tipo de origen (`modulo.hecho`) es otro dato que el nombre de cocina; la base lo copia en `asiento_de_saldo_origen_tipo_ck`

export type OrigenDeAsiento = Readonly<{ tipo: string; id: string; orden?: number }>;
export type ReferenciaDeAsiento = Readonly<{ tipo: string; id: string }>;

export type EntradaDeAsiento = Readonly<{
  parteId: string;
  sentido: Sentido;
  clase: string;
  /** Con signo: `+` aumenta lo que se debe, `-` lo reduce (el de la clase; `±` lo decide el asiento). */
  importe: Importe;
  origen: OrigenDeAsiento;
  referencia?: ReferenciaDeAsiento | null;
  venceEl?: FechaCivil | null;
  detalle?: string | null;
  clave: string;
  /** Cuándo ocurrió el hecho: lo manda el llamador (su `ahora`); no entra en la huella. */
  hechoEn: Date;
  distribucion: readonly Reparto[];
}>;

export type PedidoDeAsiento = Readonly<{
  parteId: string;
  sentido: Sentido;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: Importe;
  origenTipo: string;
  origenId: string;
  origenOrden: number;
  referenciaTipo: string | null;
  referenciaId: string | null;
  venceEl: FechaCivil | null;
  detalle: string | null;
  anulaA: string | null;
  clave: string;
  huella: string;
  hechoEn: Date;
  distribucion: readonly Reparto[];
}>;

/** Lo que se escribe del detalle (el motivo): la lista de permitidos de la explicación del cierre, que la base copia (`asiento_de_saldo_detalle_ck`). */
export function detalleDesdeTexto(
  texto: string | null | undefined,
): Resultado<string | null, "DETALLE_INVALIDO"> {
  const explicacion = explicacionDesdeTexto(texto);
  return explicacion.ok ? explicacion : err("DETALLE_INVALIDO");
}

function importeValido(importe: Importe): boolean {
  if (importe.moneda !== "ARS") return false;
  const magnitud = importe.unidades < 0n ? -importe.unidades : importe.unidades;
  return magnitud > 0n && magnitud <= TOPE_DEL_IMPORTE_EN_CENTAVOS;
}

/** La huella de un asiento: el contenido de la operación, con la distribución ordenada (otro orden de renglones es el mismo pedido). */
export function huellaDeAsiento(p: Omit<PedidoDeAsiento, "huella">): string {
  return huellaDeComando(
    "saldos.asiento",
    [
      p.parteId,
      p.sentido,
      p.clase,
      p.naturaleza,
      importeATexto(p.importe),
      p.origenTipo,
      p.origenId,
      p.origenOrden,
      p.referenciaTipo,
      p.referenciaId,
      p.venceEl,
      p.detalle,
      p.anulaA,
    ],
    p.distribucion.map((r) => [r.centroDeCosto, importeATexto(r.importe)]),
  );
}

export function armarAsiento(entrada: EntradaDeAsiento): Resultado<PedidoDeAsiento, ErrorDelLibro> {
  if (!esUuidCanonico(entrada.parteId)) return err("PARTE_NO_ENCONTRADA");
  const clave = exigirClave(entrada.clave);
  if (!clave.ok) return err("CLAVE_INVALIDA");
  const clase = claseDe(entrada.sentido, entrada.clase);
  if (clase === null) return err("CLASE_NO_ADMITIDA");
  if (entrada.importe.moneda !== "ARS") return err("MONEDA_NO_ADMITIDA");
  if (!importeValido(entrada.importe)) return err("IMPORTE_INVALIDO");
  const negativo = entrada.importe.unidades < 0n;
  if ((clase.signo === "+" && negativo) || (clase.signo === "-" && !negativo)) {
    return err("SIGNO_DEL_IMPORTE_INVALIDO");
  }

  const orden = entrada.origen.orden ?? 1;
  if (
    !FORMA_DE_ORIGEN.test(entrada.origen.tipo) ||
    entrada.origen.tipo.length > LARGO_MAXIMO_DEL_TIPO ||
    !esUuidCanonico(entrada.origen.id) ||
    !Number.isInteger(orden) ||
    orden < 1 ||
    orden > ORDEN_MAXIMO_DEL_ORIGEN
  ) {
    return err("ORIGEN_INVALIDO");
  }
  const referencia = entrada.referencia ?? null;
  if (
    referencia !== null &&
    (!FORMA_DE_ORIGEN.test(referencia.tipo) ||
      referencia.tipo.length > LARGO_MAXIMO_DEL_TIPO ||
      !esUuidCanonico(referencia.id))
  ) {
    return err("REFERENCIA_INVALIDA");
  }
  const venceEl = entrada.venceEl ?? null;
  if (venceEl !== null && !clase.admiteVencimiento) return err("VENCIMIENTO_NO_ADMITIDO");

  const detalle = detalleDesdeTexto(entrada.detalle);
  if (!detalle.ok) return err("DETALLE_INVALIDO");
  if (clase.exigeDetalle && detalle.valor === null) return err("DETALLE_OBLIGATORIO");
  if (!clase.exigeDetalle && detalle.valor !== null) return err("DETALLE_NO_ADMITIDO");

  if (!distribucionValida(entrada.importe, entrada.distribucion))
    return err("DISTRIBUCION_INVALIDA");

  const sinHuella = {
    parteId: entrada.parteId,
    sentido: entrada.sentido,
    clase: entrada.clase,
    naturaleza: "ORIGINAL" as const,
    importe: entrada.importe,
    origenTipo: entrada.origen.tipo,
    origenId: entrada.origen.id,
    origenOrden: orden,
    referenciaTipo: referencia?.tipo ?? null,
    referenciaId: referencia?.id ?? null,
    venceEl,
    detalle: detalle.valor,
    anulaA: null,
    clave: entrada.clave,
    hechoEn: entrada.hechoEn,
    distribucion: entrada.distribucion,
  };
  return ok({ ...sinHuella, huella: huellaDeAsiento(sinHuella) });
}

/** La huella de una imputación (o un deshacer): la operación entera, con sus renglones ordenados por (saldado, saldante). */
export function huellaDeImputacion(
  parteId: string,
  sentido: Sentido,
  renglones: ReadonlyArray<Readonly<{ saldanteId: string; saldadoId: string; importe: Importe }>>,
): string {
  return huellaDeComando(
    "saldos.imputacion",
    [parteId, sentido],
    renglones.map((r) => [r.saldadoId, r.saldanteId, importeATexto(r.importe)]),
  );
}

/** La huella de una anulación: el asiento anulado y el detalle. */
export function huellaDeAnulacion(asientoId: string, detalle: string): string {
  return huellaDeCampos(["saldos.anulacion", asientoId, detalle]);
}
