import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esFechaCivil } from "../dominio/disponibilidad";
import { esUuid } from "../persistencia/filas";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { leerDetalle } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

/** Una fecha civil que existe en el calendario y que la base admite (2000 a 2200). */
function fechaValida(texto: unknown): texto is string {
  if (typeof texto !== "string" || !esFechaCivil(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === texto &&
    texto >= "2000-01-01" &&
    texto <= "2200-12-31"
  );
}

export type EntradaDeCorregirLote = Readonly<{
  loteId: string;
  versionEsperada: number;
  /** Ausente: no se toca; `null`: se borra (no vale con control de vencimiento); texto `AAAA-MM-DD`: la fecha nueva. */
  fechaDeVencimiento?: string | null | undefined;
  fechaDeElaboracion?: string | null | undefined;
  /** Por qué se corrige: obligatorio (queda en la auditoría con el antes y el después). */
  detalle: string;
}>;
export type SalidaDeCorregirLote = Readonly<{ version: number }>;

/**
 * Corregir las fechas de un lote (E6 §3.2): una fecha mal cargada vende vencido o bloquea lo bueno. Guard `lotes.corregir`, alcance TODAS; con
 * detalle, auditado con el antes y el después. El «sin asignar» no tiene fechas (`LOTE_SIN_ASIGNAR`). Repetición (`SIN_CAMBIOS`): las mismas
 * fechas que ya tiene devuelve la versión vigente sin escribir ni auditar, aunque la versión esperada sea vieja. Si no, compara la versión
 * (`LOTE_DESACTUALIZADO`).
 */
export function armarCorregirLote(dependencias: DependenciasDeStock) {
  return async function corregirLote(
    contexto: ContextoOperativo,
    entrada: EntradaDeCorregirLote,
  ): Promise<R<SalidaDeCorregirLote>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCorregirLote>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["lotes.corregir"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (typeof entrada.loteId !== "string" || !esUuid(entrada.loteId)) {
          return err("LOTE_NO_ENCONTRADO");
        }
        if (
          typeof entrada.versionEsperada !== "number" ||
          !Number.isSafeInteger(entrada.versionEsperada) ||
          entrada.versionEsperada < 1
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const detalle = leerDetalle(entrada.detalle, true);
        if (!detalle.ok) return detalle;
        for (const fecha of [entrada.fechaDeVencimiento, entrada.fechaDeElaboracion]) {
          if (fecha !== undefined && fecha !== null && !fechaValida(fecha)) {
            return err("IDENTIFICADOR_INVALIDO");
          }
        }
        const lote = await tx.lotesDeStock.bloquearLote(empresaId, entrada.loteId.toLowerCase());
        if (lote === null) return err("LOTE_NO_ENCONTRADO");
        if (lote.esSinAsignar) return err("LOTE_SIN_ASIGNAR");
        const vence =
          entrada.fechaDeVencimiento === undefined
            ? lote.fechaDeVencimiento
            : entrada.fechaDeVencimiento;
        const elabora =
          entrada.fechaDeElaboracion === undefined
            ? lote.fechaDeElaboracion
            : entrada.fechaDeElaboracion;
        if (vence === lote.fechaDeVencimiento && elabora === lote.fechaDeElaboracion) {
          return ok({ version: lote.version });
        }
        if (lote.version !== entrada.versionEsperada) return err("LOTE_DESACTUALIZADO");
        const control = (await tx.lotesDeStock.controlesDe(empresaId, [lote.articuloId])).get(
          lote.articuloId,
        );
        if (vence === null && control?.modo === "LOTE_Y_VENCIMIENTO") {
          return err("VENCIMIENTO_REQUERIDO");
        }
        if (vence !== null && elabora !== null && elabora > vence) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const corregido = await tx.lotesDeStock.corregirFechas(empresaId, lote.id, {
          fechaDeElaboracion: elabora,
          fechaDeVencimiento: vence,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "LOTE_CORREGIDO",
          entidad: "lote",
          entidadId: lote.id,
          antes: {
            fechaDeVencimiento: lote.fechaDeVencimiento,
            fechaDeElaboracion: lote.fechaDeElaboracion,
          },
          despues: {
            fechaDeVencimiento: corregido.fechaDeVencimiento,
            fechaDeElaboracion: corregido.fechaDeElaboracion,
            detalle: detalle.valor,
          },
        });
        return ok({ version: corregido.version });
      },
    );
    return traducir(resultado);
  };
}
