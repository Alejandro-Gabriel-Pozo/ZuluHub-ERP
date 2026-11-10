import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { motivoDeNoVigencia } from "../dominio/acreditacion";
import {
  esOrigenDeDocumentoValido,
  type ComprobanteParaVigencia,
} from "../persistencia/lecturas-de-vigencia";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** El origen por el que se pregunta: uno de los dos con los que se factura un documento y el id (uuid) que le dio quien factura. */
export type EntradaDeComprobanteVigenteDeUnOrigen = Readonly<{
  origenTipo: string;
  origenId: string;
}>;

export type ComprobanteVigenteDeUnOrigen = Readonly<{
  comprobanteId: ComprobanteParaVigencia["id"];
  tipo: ComprobanteParaVigencia["tipo"];
  estado: ComprobanteParaVigencia["estado"];
  /** Texto decimal (ADR-006). */
  total: string;
}>;

export type ErrorAlPedirElComprobanteDeUnOrigen =
  MotivoDeRechazo | "ORIGEN_INVALIDO" | ErrorDePersistencia;

/**
 * El comprobante VIGENTE (D-F-1: `motivoDeNoVigencia` es `null`) de un origen, o `null` si no hay ninguno: nunca se facturó ese origen, o lo que
 * se facturó dejó de valer (rechazado, descartado o acreditado por completo con notas AUTORIZADAS). Es la lectura con la que quien factura un
 * documento verifica, fuera de toda transacción de escritura, si ya está facturado: la fuente de verdad es fiscal y el puntero que guarde
 * quien factura se puede reconstruir con esto. «Confirmando» (incierto), «Validando» y «Pendiente» cuentan como vigentes. Pide
 * `comprobantes.ver` al guard dentro de su transacción (`read committed`, solo lectura) y valida el origen contra la lista de permitidos.
 * Filtra por empresa: el origen de otra empresa no existe.
 */
export function armarComprobanteVigenteDeUnOrigen({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function comprobanteVigenteDeUnOrigen(
    contexto: ContextoOperativo,
    entrada: EntradaDeComprobanteVigenteDeUnOrigen,
  ): Promise<Resultado<ComprobanteVigenteDeUnOrigen | null, ErrorAlPedirElComprobanteDeUnOrigen>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<ComprobanteVigenteDeUnOrigen | null, MotivoDeRechazo | "ORIGEN_INVALIDO">
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.comprobanteVigenteDeUnOrigen.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { origenTipo, origenId } = entrada;
        if (!esOrigenDeDocumentoValido(origenTipo, origenId)) return err("ORIGEN_INVALIDO");
        const { empresaId } = contexto;
        const delOrigen = await tx.lecturas.paraVigenciaDelOrigen(empresaId, origenTipo, origenId);
        const notas = await tx.lecturas.notasQueCitanA(
          empresaId,
          delOrigen.map((c) => c.id),
        );
        const vigente = delOrigen.find(
          (c) => motivoDeNoVigencia(c, notas.get(c.id) ?? []) === null,
        );
        return ok(
          vigente === undefined
            ? null
            : {
                comprobanteId: vigente.id,
                tipo: vigente.tipo,
                estado: vigente.estado,
                total: importeATexto(vigente.total),
              },
        );
      },
    );
  };
}
