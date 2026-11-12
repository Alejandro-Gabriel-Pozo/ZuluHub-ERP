import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../persistencia/filas";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { idDerivado } from "./id-derivado";
import { leerCantidad, leerDetalle } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

// ---- reasignar ------------------------------------------------------------------------------------------------------------------

export type EntradaDeReasignarLote = Readonly<{
  /** La clave de la pantalla (UUID, D136): la misma clave con el mismo contenido es la misma reasignación. */
  clave: string;
  depositoId: string;
  productoId: string;
  loteOrigenId: string;
  loteDestinoId: string;
  /** Texto decimal exacto, mayor que cero, en la unidad de stock. */
  cantidad: string;
  motivo: string;
}>;
export type SalidaDeReasignarLote = Readonly<{ yaExistia: boolean }>;

/**
 * Mover existencia de un lote a otro del MISMO depósito y artículo (E6 §3.2): es la salida del «sin asignar» cuando llega la información del
 * lote. No toca el libro ni el saldo del artículo, solo cómo se reparte entre lotes. Guard `lotes.reasignar`; el depósito tiene que estar en el
 * alcance de sucursales de quien pide. La cantidad no pasa del saldo del lote de origen salvo el «sin asignar» (que puede quedar negativo); el
 * saldo se bloquea `FOR UPDATE`. Repetición (`CLAVE_DE_IDEMPOTENCIA`): la misma clave con el mismo contenido devuelve `yaExistia` sin escribir ni
 * auditar; con otro contenido, `CLAVE_REUTILIZADA`.
 */
export function armarReasignarLote(dependencias: DependenciasDeStock) {
  return async function reasignarLote(
    contexto: ContextoOperativo,
    entrada: EntradaDeReasignarLote,
  ): Promise<R<SalidaDeReasignarLote>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeReasignarLote>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["lotes.reasignar"]);
        if (!permiso.ok) return permiso;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (typeof entrada.clave !== "string" || !esUuid(entrada.clave)) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        for (const id of [
          entrada.depositoId,
          entrada.productoId,
          entrada.loteOrigenId,
          entrada.loteDestinoId,
        ]) {
          if (typeof id !== "string" || !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
        }
        const cantidad = leerCantidad(entrada.cantidad);
        if (!cantidad.ok) return cantidad;
        const motivo = leerDetalle(entrada.motivo, true);
        if (!motivo.ok) return err("MOTIVO_REQUERIDO");
        const deposito = await tx.depositos.obtener(empresaId, entrada.depositoId.toLowerCase());
        if (deposito === null) return err("DEPOSITO_NO_ENCONTRADO");
        const enAlcance = await exigirAlcanceDeSucursal(tx, contexto, deposito.sucursalId);
        if (!enAlcance.ok) return enAlcance;
        const articulo = await tx.articulosDeStock.bloquearPorProducto(
          empresaId,
          entrada.productoId.toLowerCase(),
        );
        if (articulo === null || !articulo.activo) return err("ARTICULO_NO_CONTROLADO");

        const origenId = entrada.loteOrigenId.toLowerCase();
        const destinoId = entrada.loteDestinoId.toLowerCase();
        const texto = cantidadATexto(cantidad.valor);
        const previa = await tx.lotesDeStock.reasignacionPorClave(empresaId, entrada.clave);
        if (previa !== null) {
          const igual =
            previa.depositoId === deposito.id &&
            previa.articuloId === articulo.id &&
            previa.loteOrigenId === origenId &&
            previa.loteDestinoId === destinoId &&
            previa.cantidad === texto &&
            previa.motivo === motivo.valor;
          return igual ? ok({ yaExistia: true }) : err("CLAVE_REUTILIZADA");
        }
        if (!deposito.activo) return err("DEPOSITO_INACTIVO");
        const control = (await tx.lotesDeStock.controlesDe(empresaId, [articulo.id])).get(
          articulo.id,
        );
        if (control === undefined) return err("ARTICULO_NO_CONTROLADO");
        if (origenId === destinoId) return err("IDENTIFICADOR_INVALIDO");
        const origen = await tx.lotesDeStock.obtener(empresaId, origenId);
        const destino = await tx.lotesDeStock.obtener(empresaId, destinoId);
        if (
          origen === null ||
          destino === null ||
          origen.articuloId !== articulo.id ||
          destino.articuloId !== articulo.id
        ) {
          return err("LOTE_NO_ENCONTRADO");
        }
        const saldo = await tx.lotesDeStock.bloquearSaldoDeLote(empresaId, deposito.id, origen.id);
        if (!origen.esSinAsignar && saldo < cantidad.valor.unidades) {
          return err("SALDO_DE_LOTE_INSUFICIENTE");
        }
        await tx.lotesDeStock.registrarReasignacion(empresaId, {
          id: idDerivado(`reasignacion|${entrada.clave}`),
          depositoId: deposito.id,
          articuloId: articulo.id,
          loteOrigenId: origen.id,
          loteDestinoId: destino.id,
          cantidad: texto,
          motivo: motivo.valor ?? "",
          clave: entrada.clave,
          por: persona,
          en: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "LOTE_REASIGNADO",
          entidad: "reasignacion_de_lote",
          entidadId: idDerivado(`reasignacion|${entrada.clave}`),
          antes: null,
          despues: {
            depositoId: deposito.id,
            articuloId: articulo.id,
            loteOrigenId: origen.id,
            loteDestinoId: destino.id,
            cantidad: texto,
            motivo: motivo.valor,
          },
        });
        return ok({ yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}
