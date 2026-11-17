import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type Importe, type ImporteJson } from "../../../primitivas/dinero/importe";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal, type EstadoConsultado } from "../../cierre/publico";
import { leerLaJornada, type ErrorAlLeerLaJornada } from "../aporte/la-jornada";
import type { EstadoDeConteo } from "../estados";
import type { MedioYCuentaConNombre } from "../persistencia/base-de-la-jornada";
import type { AjusteConEnlace } from "../persistencia/repositorio-de-la-jornada";
import { exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja, TxDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

export type EntradaDeConciliacionDeLaJornada = EntradaDeJornadaDeCaja;

export type LineaDeConciliacionVista = MedioYCuentaConNombre &
  Readonly<{
    registrado: ImporteJson;
    /** Σ de las correcciones de medio: `+importe` en el par de destino, `−importe` en el de origen. */
    correcciones: ImporteJson;
    /** `null` si `CONFORME` o `SIN_DATO`. */
    declarado: ImporteJson | null;
    estadoDeConteo: EstadoDeConteo;
    conformePor: string | null;
    conformeEn: string | null;
    /** declarado − (registrado + correcciones); `null` si `CONFORME` (muestra «conforme») o `SIN_DATO`. */
    diferencia: ImporteJson | null;
    /** La que escribió quien cerró al reconocer el control; solo en una jornada ya cerrada. */
    explicacion: string | null;
  }>;

export type CobradoContraTicketVisto = Readonly<{
  origen: Readonly<{ tipo: string; id: string }>;
  ticketId: string;
  cobrado: ImporteJson;
  totalDelTicket: ImporteJson;
  /** cobrado − total del ticket; nunca cero. */
  diferencia: ImporteJson;
  explicacion: string | null;
}>;

export type AjusteVisto = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    sesionId: string;
    importe: ImporteJson;
    motivo: string;
    /** `YYYY-MM-DD`: la jornada ya cerrada que explica. */
    corrigeJornada: string;
    /** La fecha de negocio de la sesión de hoy donde se registró. */
    fechaDeNegocio: string;
    registradoEn: string;
    registradoPor: string;
  }>;

export type ConciliacionDeLaJornada = Readonly<{
  estadoDeLaJornada: EstadoConsultado;
  /** `true`: calculada ahora con lo que hay (la jornada no está cerrada); `false`: las líneas que caja guardó al cerrarla. */
  enVivo: boolean;
  lineas: readonly LineaDeConciliacionVista[];
  cobradoContraTicket: readonly CobradoContraTicketVisto[];
  /** Informativa: los ajustes de ESTA jornada que corrigen una jornada ya cerrada. */
  ajustesQueCorrigenJornadasCerradas: readonly AjusteVisto[];
  /** Solo de una jornada cerrada: los ajustes posteriores que la citan; no alteran sus líneas guardadas. */
  ajustesPosteriores: readonly AjusteVisto[];
}>;

export type ErrorAlVerLaConciliacion =
  ErrorDeConsultaDeJornada | ErrorAlLeerLaJornada | ErrorDePersistencia;

const jsonONulo = (importe: Importe | null): ImporteJson | null =>
  importe === null ? null : importeAJson(importe);

const ajusteVisto = (a: AjusteConEnlace): AjusteVisto => ({
  ...a,
  importe: importeAJson(a.importe),
  registradoEn: a.registradoEn.toISOString(),
});

/** Cómo se llama cada medio y cuenta de la jornada (la conciliación en vivo trae solo ids). Un id que no existe es una invariante rota. */
async function nombresDeLosPares(
  tx: TxDeConsultasDeCaja,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
) {
  const medios = new Map(
    (await tx.mediosDePago.listar(contexto.empresaId, { incluirInactivos: true })).map((m) => [
      m.id,
      m,
    ]),
  );
  const cuentas = new Map(
    (
      await tx.cuentasDeCobro.listar(contexto.empresaId, {
        sucursales: [sucursal],
        incluirInactivas: true,
      })
    ).map((c) => [c.id, c]),
  );
  return (medioId: string, cuentaId: string | null): MedioYCuentaConNombre => {
    const medio = medios.get(medioId);
    const cuenta = cuentaId === null ? null : cuentas.get(cuentaId);
    if (medio === undefined || cuenta === undefined) {
      throw new Error("invariante rota: un medio o una cuenta de la conciliación que no existe");
    }
    return {
      medioDePagoId: medio.id,
      medioTipo: medio.tipo,
      medioNombre: medio.nombre,
      cuentaDeCobroId: cuenta === null ? null : cuenta.id,
      cuentaNombre: cuenta === null ? null : cuenta.nombre,
    };
  };
}

/**
 * La conciliación por medio de la jornada (e3b §4.4 y §4.5): por (medio, cuenta o «sin cuenta») lo registrado, las correcciones, lo
 * declarado y la diferencia, al centavo; más el cobrado contra el total del ticket y los ajustes que corrigen una jornada cerrada. En VIVO
 * mientras la jornada no está cerrada (la misma lectura y el mismo cálculo que usa el aporte de caja al cierre: lo que se muestra es lo que se
 * congela); las líneas GUARDADAS si está `CERRADA` (con `ajustesPosteriores`, que no las alteran). Un total de ticket que ventas no pudo informar
 * es `APORTE_NO_DISPONIBLE`: nunca se muestra «sin diferencias» sin haberlo leído. `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarConciliacionDeLaJornada({
  transacciones,
  reglas,
  tickets,
}: DependenciasDeConsultasDeCaja) {
  return async function conciliacionDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeConciliacionDeLaJornada,
  ): Promise<Resultado<ConciliacionDeLaJornada, ErrorAlVerLaConciliacion>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<ConciliacionDeLaJornada, ErrorDeConsultaDeJornada | ErrorAlLeerLaJornada>
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.conciliacionDeLaJornada.accion,
        );
        if (!permiso.ok) return permiso;
        const elegida = await jornadaParaMirar(tx, contexto, entrada);
        if (!elegida.ok) return elegida;
        const { sucursal, fecha } = elegida.valor;
        const empresa = contexto.empresaId;
        const estado = await jornadaDeSucursal.estadoDeJornada(tx, empresa, sucursal, fecha);

        if (estado === "CERRADA") {
          const lineas = await tx.fotos.lineas(empresa, sucursal, fecha);
          const origenes = await tx.fotos.origenes(empresa, sucursal, fecha);
          return ok({
            estadoDeLaJornada: estado,
            enVivo: false,
            lineas: lineas.map((l) => ({
              medioDePagoId: l.medioDePagoId,
              medioTipo: l.medioTipo,
              medioNombre: l.medioNombre,
              cuentaDeCobroId: l.cuentaDeCobroId,
              cuentaNombre: l.cuentaNombre,
              registrado: importeAJson(l.registrado),
              correcciones: importeAJson(l.correcciones),
              declarado: jsonONulo(l.declarado),
              estadoDeConteo: l.estado,
              conformePor: l.conformePor,
              conformeEn: l.conformeEn === null ? null : l.conformeEn.toISOString(),
              diferencia: jsonONulo(l.diferencia),
              explicacion: l.explicacion,
            })),
            cobradoContraTicket: origenes.map((o) => ({
              origen: { tipo: o.origenTipo, id: o.origenId },
              ticketId: o.ticketId,
              cobrado: importeAJson(o.cobrado),
              totalDelTicket: importeAJson(o.totalDelTicket),
              diferencia: importeAJson(o.diferencia),
              explicacion: o.explicacion,
            })),
            ajustesQueCorrigenJornadasCerradas: (
              await tx.laJornada.ajustesQueCorrigen(empresa, sucursal, fecha)
            ).map(ajusteVisto),
            ajustesPosteriores: (
              await tx.laJornada.ajustesPosteriores(empresa, sucursal, fecha)
            ).map(ajusteVisto),
          });
        }

        const jornada = await leerLaJornada(tx, empresa, sucursal, fecha, tickets);
        if (!jornada.ok) return err(jornada.error);
        const nombres = await nombresDeLosPares(tx, contexto, sucursal);
        return ok({
          estadoDeLaJornada: estado,
          enVivo: true,
          lineas: jornada.valor.lineas.map((l) => ({
            ...nombres(l.medioDePagoId, l.cuentaDeCobroId),
            registrado: importeAJson(l.registrado),
            correcciones: importeAJson(l.correcciones),
            declarado: jsonONulo(l.declarado),
            estadoDeConteo: l.estado,
            conformePor: l.conformePor,
            conformeEn: l.conformeEn === null ? null : l.conformeEn.toISOString(),
            diferencia: jsonONulo(l.diferencia),
            explicacion: null,
          })),
          cobradoContraTicket: jornada.valor.diferenciasDeTicket.map((d) => ({
            origen: d.origen,
            ticketId: d.ticketId,
            cobrado: importeAJson(d.cobrado),
            totalDelTicket: importeAJson(d.totalDelTicket),
            diferencia: importeAJson(d.diferencia),
            explicacion: null,
          })),
          ajustesQueCorrigenJornadasCerradas: jornada.valor.ajustes.map(ajusteVisto),
          ajustesPosteriores: [],
        });
      },
    );
  };
}
