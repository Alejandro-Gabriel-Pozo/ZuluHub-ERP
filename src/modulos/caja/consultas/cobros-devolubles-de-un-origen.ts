import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeCero,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { OrigenDevoluble } from "../persistencia/esquema";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { alcanceParaMirar, exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * El origen que se devuelve hoy: la cobranza de un ticket de ventas. Una consulta no importa el dominio (ADR-005), así que la lista cerrada de `ORIGENES_DEVOLUBLES` no se lee
 * acá: el tipo `OrigenDevoluble` (el mismo de la lista) obliga a que este literal siga siendo uno de sus miembros, y si la lista cambia deja de compilar.
 */
const ORIGEN_DE_LA_COBRANZA: OrigenDevoluble = "ventas.cobranza_de_ticket";

export type EntradaDeCobrosDevolublesDeUnOrigen = Readonly<{ cobranzaId: string }>;

export type CobradoPorMedio = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Lo cobrado por ese par (medio, cuenta) VIGENTE: con las correcciones de medio ya aplicadas. */
  importe: ImporteJson;
}>;

export type CobrosDevolublesDeUnOrigen = Readonly<{
  cobradoPorMedio: readonly CobradoPorMedio[];
  yaDevuelto: ImporteJson;
  quedaPorDevolver: ImporteJson;
  /** TODOS los medios con que se cobró el cobranza (no solo el principal): la pantalla y la marca de «medio distinto» comparan contra esta lista. */
  mediosCobrados: readonly string[];
}>;

export type ErrorAlConsultarCobrosDevolubles =
  MotivoDeRechazo | ErrorDeAlcance | "COBRANZA_NO_ENCONTRADA" | ErrorDePersistencia;

/**
 * Lo que se cobró de una cobranza de ticket, por medio y cuenta, y cuánto queda por devolver (DM-2; la pantalla de devolver lo usa en DM-4). Pide `cajas.ver` al guard dentro de
 * su transacción (`read committed`, solo lectura). Una cobranza sin cobros de la empresa no existe (la de otra empresa tampoco: `COBRANZA_NO_ENCONTRADA`); una de otra sucursal
 * fuera del alcance de quien mira, `SUCURSAL_FUERA_DE_ALCANCE`. El medio de cada cobro es el VIGENTE tras las correcciones de medio. El tope es el de la base (`quedaPorDevolver`).
 */
export function armarCobrosDevolublesDeUnOrigen({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCaja) {
  return async function cobrosDevolublesDeUnOrigen(
    contexto: ContextoOperativo,
    entrada: EntradaDeCobrosDevolublesDeUnOrigen,
  ): Promise<Resultado<CobrosDevolublesDeUnOrigen, ErrorAlConsultarCobrosDevolubles>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          CobrosDevolublesDeUnOrigen,
          MotivoDeRechazo | ErrorDeAlcance | "COBRANZA_NO_ENCONTRADA"
        >
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.cobrosDevolublesDeUnOrigen.accion,
        );
        if (!permiso.ok) return permiso;
        if (!esUuidCanonico(entrada.cobranzaId)) return err("COBRANZA_NO_ENCONTRADA");
        const { empresaId } = contexto;
        const cobros = await tx.cobros.deOrigen(empresaId, {
          tipo: ORIGEN_DE_LA_COBRANZA,
          id: entrada.cobranzaId,
        });
        if (cobros.length === 0) return err("COBRANZA_NO_ENCONTRADA");
        // La sucursal sale de la sesión de cada cobro, nunca de un dato de la pantalla: todas tienen que estar en el alcance de quien mira.
        const alcance = await alcanceParaMirar(tx, contexto);
        for (const sesionId of new Set(cobros.map((c) => c.sesionId))) {
          const sesion = await tx.sesiones.obtener(empresaId, sesionId);
          if (sesion === null) throw new Error("invariante rota: un cobro sin su sesión");
          const dentro = exigirSucursal(alcance, sesion.sucursalId);
          if (!dentro.ok) return dentro;
        }

        const porPar = new Map<
          string,
          {
            medioDePagoId: string;
            cuentaDeCobroId: string | null;
            importes: (typeof cobros)[number]["importe"][];
          }
        >();
        for (const c of cobros) {
          const ultima = c.correcciones[c.correcciones.length - 1];
          const medioDePagoId = ultima?.medioDespuesId ?? c.medioDePagoId;
          const cuentaDeCobroId = ultima === undefined ? c.cuentaDeCobroId : ultima.cuentaDespuesId;
          const llave = JSON.stringify([medioDePagoId, cuentaDeCobroId]);
          const acumulado = porPar.get(llave) ?? { medioDePagoId, cuentaDeCobroId, importes: [] };
          acumulado.importes.push(c.importe);
          porPar.set(llave, acumulado);
        }
        const cobradoPorMedio = [...porPar.values()].map((p) => ({
          medioDePagoId: p.medioDePagoId,
          cuentaDeCobroId: p.cuentaDeCobroId,
          importe: importeAJson(p.importes.reduce(sumar, importeCero(ARS))),
        }));
        return ok({
          cobradoPorMedio,
          yaDevuelto: importeAJson(
            await tx.movimientosDeDinero.devueltoDeOrigen(
              empresaId,
              ORIGEN_DE_LA_COBRANZA,
              entrada.cobranzaId,
            ),
          ),
          quedaPorDevolver: importeAJson(
            await tx.movimientosDeDinero.devolvibleDeOrigen(
              empresaId,
              ORIGEN_DE_LA_COBRANZA,
              entrada.cobranzaId,
            ),
          ),
          mediosCobrados: [...new Set(cobradoPorMedio.map((p) => p.medioDePagoId))],
        });
      },
    );
  };
}
