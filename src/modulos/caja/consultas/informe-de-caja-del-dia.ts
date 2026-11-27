import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeCero,
  restar,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeMedio } from "../estados";
import { exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

export type EntradaDeInformeDeCajaDelDia = EntradaDeJornadaDeCaja;

export type CobradoDeUnMedio = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cobros: number;
  /** Lo cobrado por ese medio, ya con las correcciones de medio aplicadas. */
  importe: ImporteJson;
  /** Lo devuelto (devoluciones vigentes) que salió por ese medio, en positivo. Un medio por el que solo se devolvió figura con `cobros: 0`. */
  devuelto: ImporteJson;
  /** `importe` − `devuelto`: lo que queda de ese medio en el día. Es lo que la planilla de la caja diaria tiene que mostrar. */
  neto: ImporteJson;
}>;

export type InformeDeCajaDelDia = Readonly<{
  /** La cantidad de cobros de la jornada (la cantidad de TICKETS es de ventas). */
  cantidadDeCobros: number;
  cobrado: ImporteJson;
  /** Σ de lo devuelto en la jornada (devoluciones vigentes), en positivo. */
  devuelto: ImporteJson;
  /** `cobrado` − `devuelto`. */
  neto: ImporteJson;
  porMedio: readonly CobradoDeUnMedio[];
}>;

export type ErrorAlVerElInformeDeCaja = ErrorDeConsultaDeJornada | ErrorDePersistencia;

/**
 * El informe de caja del día (e3b §4.5): lo cobrado por medio con las correcciones de medio ya aplicadas, y la cantidad de cobros. SUPUESTO (DEC-0063):
 * «ingresos» son los COBROS (no los ingresos manuales ni el fondo inicial); costo de sumar los manuales: una consulta más en el repositorio.
 * Con la devolución con medio, además lo DEVUELTO por medio (el medio por el que salió el dinero) y el neto: sin eso la planilla muestra de más (cobros que ya se devolvieron).
 * `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarInformeDeCajaDelDia({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function informeDeCajaDelDia(
    contexto: ContextoOperativo,
    entrada: EntradaDeInformeDeCajaDelDia,
  ): Promise<Resultado<InformeDeCajaDelDia, ErrorAlVerElInformeDeCaja>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<InformeDeCajaDelDia, ErrorDeConsultaDeJornada>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.informeDeCajaDelDia.accion,
        );
        if (!permiso.ok) return permiso;
        const jornada = await jornadaParaMirar(tx, contexto, entrada);
        if (!jornada.ok) return jornada;
        const filas = await tx.laJornada.cobradoPorMedioVigente(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
        );
        const medios = new Map(
          (await tx.mediosDePago.listar(contexto.empresaId, { incluirInactivos: true })).map(
            (m) => [m.id, m],
          ),
        );
        const devueltoPorMedio = new Map<string, Importe>();
        for (const d of await tx.devolucionesDeLaJornada.devueltoPorPar(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
        )) {
          devueltoPorMedio.set(
            d.medioDePagoId,
            sumar(devueltoPorMedio.get(d.medioDePagoId) ?? importeCero(ARS), d.importe),
          );
        }
        // Los medios con cobros y, después, los que solo tuvieron devoluciones (se cobró por uno y se devolvió por otro).
        const filasDeMedio = [
          ...filas.map((f) => ({
            medioDePagoId: f.medioDePagoId,
            cobros: f.cobros,
            importe: f.importe,
          })),
          ...[...devueltoPorMedio.keys()]
            .filter((id) => !filas.some((f) => f.medioDePagoId === id))
            .sort()
            .map((id) => ({ medioDePagoId: id, cobros: 0, importe: importeCero(ARS) })),
        ];
        const porMedio = filasDeMedio.map((f) => {
          const medio = medios.get(f.medioDePagoId);
          if (medio === undefined)
            throw new Error("invariante rota: un cobro con un medio que no existe");
          const devuelto = devueltoPorMedio.get(f.medioDePagoId) ?? importeCero(ARS);
          return {
            medioDePagoId: medio.id,
            medioTipo: medio.tipo,
            medioNombre: medio.nombre,
            cobros: f.cobros,
            importe: importeAJson(f.importe),
            devuelto: importeAJson(devuelto),
            neto: importeAJson(restar(f.importe, devuelto)),
          };
        });
        const cobrado = filas.reduce((suma, f) => sumar(suma, f.importe), importeCero(ARS));
        const devuelto = [...devueltoPorMedio.values()].reduce(
          (suma, d) => sumar(suma, d),
          importeCero(ARS),
        );
        return ok({
          cantidadDeCobros: filas.reduce((n, f) => n + f.cobros, 0),
          cobrado: importeAJson(cobrado),
          devuelto: importeAJson(devuelto),
          neto: importeAJson(restar(cobrado, devuelto)),
          porMedio,
        });
      },
    );
  };
}
