import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  modeloDeImpresion,
  type ComprobanteParaImprimir,
  type ErrorDeImpresion,
  type ModeloImpreso,
} from "../dominio/modelo-de-impresion";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import { exigir } from "../persistencia/repositorios";
import { exigirComprobanteEnAlcance } from "./comprobante-en-alcance";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeModeloDeImpresion = Readonly<{ comprobanteId: ComprobanteGuardado["id"] }>;

export type ErrorAlPedirElModeloDeImpresion =
  | MotivoDeRechazo
  | "COMPROBANTE_NO_ENCONTRADO"
  | "COMPROBANTE_NO_AUTORIZADO"
  | ErrorDeImpresion
  | ErrorDePersistencia;

/**
 * Lo que se imprime de un comprobante `AUTORIZADO`, tal como lo guardó la base: nada se recalcula, el total y el
 * desglose son los que se informaron a ARCA. Un `AUTORIZADO` siempre tiene número, fecha, CAE y vencimiento (la
 * base lo impone); si falta alguno, la base está rota y acá se lanza, no es un caso de negocio.
 */
export function paraImprimir(c: ComprobanteGuardado): ComprobanteParaImprimir {
  return {
    ambiente: c.ambiente,
    tipo: c.tipo,
    emisor: c.emisor,
    receptor: c.receptor,
    renglones: c.renglones,
    total: c.importes.total,
    desglose: c.desglose,
    asociado: c.asociado,
    numero: exigir(c.numero, "numero"),
    fechaEmision: exigir(c.fechaEmision, "fecha_emision"),
    cae: exigir(c.cae, "cae"),
    caeVence: exigir(c.caeVence, "cae_vence"),
    versionDeRepresentacion: c.versionDeRepresentacion,
  };
}

/**
 * El modelo de impresión de un comprobante `AUTORIZADO` de la empresa del contexto (H7 facturación §B.4.9 y
 * §B.7): el JSON que dibuja la vista imprimible. Pide `comprobantes.ver` al guard dentro de su transacción
 * (`read committed`, solo lectura). Determinista: el mismo comprobante y la misma marca dan el mismo modelo; la
 * versión de representación que sella el comprobante hace que reimprimir dé lo mismo aunque el formato cambie.
 * La marca solo llena su bloque: los rótulos fiscales no salen de ella. Como el Detalle (D-39), solo de una sucursal que la persona
 * puede ver; si no corresponde responde lo mismo que si no existiera (`COMPROBANTE_NO_ENCONTRADO`), antes de mirar el estado.
 */
export function armarModeloDeImpresion({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function modeloDeImpresionDe(
    contexto: ContextoOperativo,
    entrada: EntradaDeModeloDeImpresion,
  ): Promise<Resultado<ModeloImpreso, ErrorAlPedirElModeloDeImpresion>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          ModeloImpreso,
          | MotivoDeRechazo
          | "COMPROBANTE_NO_ENCONTRADO"
          | "COMPROBANTE_NO_AUTORIZADO"
          | ErrorDeImpresion
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.modeloDeImpresion.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        // D-39 extendido: ANTES de leer el comprobante, con la misma regla y la misma respuesta que el Detalle.
        const enAlcance = await exigirComprobanteEnAlcance(tx, contexto, entrada.comprobanteId);
        if (!enAlcance.ok) return enAlcance;
        const comprobante = await tx.comprobantes.obtener(empresaId, entrada.comprobanteId);
        if (comprobante === null) return err("COMPROBANTE_NO_ENCONTRADO");
        if (comprobante.estado !== "AUTORIZADO") return err("COMPROBANTE_NO_AUTORIZADO");
        const marca = await tx.marca.deLaEmpresa(empresaId);
        return modeloDeImpresion(paraImprimir(comprobante), marca);
      },
    );
  };
}
