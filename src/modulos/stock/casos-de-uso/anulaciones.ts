import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto, negarConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "../dominio/huella";
import { esAnulable, ordenarParaBloqueo, type RenglonDeLibro } from "../dominio/movimiento";
import { autorizar, exigirAlcanceDeSucursal } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import { leerClave, leerDetalle, leerId, traducirMovimiento } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeAnularMovimiento = Readonly<{
  clave: string;
  movimientoId: string;
  /** Por qué se anula: obligatorio. */
  detalle: string;
}>;
export type SalidaDeAnularMovimiento = Readonly<{ anulacionId: string; yaExistia: boolean }>;

/**
 * Anular un movimiento (E5 §3.2): guard `stock.anular`, detalle obligatorio. Solo se anulan los de origen `MANUAL` (`MOVIMIENTO_NO_ANULABLE`
 * para una anulación, un ajuste por conteo o lo que viene de otro módulo: ese lo revierte su módulo). Inserta el espejo EXACTO: mismo depósito,
 * mismos artículos y composiciones, cantidades opuestas. Una anulación nunca se bloquea por existencia negativa. Repetición
 * (`CLAVE_DE_IDEMPOTENCIA`): la misma clave devuelve la anulación anterior; otra clave sobre un movimiento ya anulado es
 * `MOVIMIENTO_YA_ANULADO` (la base lo impone con el único `anula_a`). El alcance es el de TODOS los depósitos que toca el original.
 */
export function armarAnularMovimiento(dependencias: DependenciasDeStock) {
  return async function anularMovimiento(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularMovimiento,
  ): Promise<R<SalidaDeAnularMovimiento>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAnularMovimiento>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["stock.anular"]);
        if (!permiso.ok) return permiso;
        const clave = leerClave(entrada.clave);
        if (!clave.ok) return clave;
        const detalle = leerDetalle(entrada.detalle, true);
        if (!detalle.ok) return detalle;
        const movimientoId = leerId(entrada.movimientoId);
        if (movimientoId === null) return err("MOVIMIENTO_NO_ENCONTRADO");
        const original = await tx.movimientosDeStock.obtener(contexto.empresaId, movimientoId);
        if (original === null) return err("MOVIMIENTO_NO_ENCONTRADO");
        const guardados = await tx.movimientosDeStock.renglonesDe(contexto.empresaId, original.id);
        const depositos = [...new Set(guardados.map((r) => r.depositoId))].sort();
        for (const depositoId of depositos) {
          const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
          if (deposito === null) throw new Error("el depósito de un renglón del libro no existe");
          const alcance = await exigirAlcanceDeSucursal(tx, contexto, deposito.sucursalId);
          if (!alcance.ok) return alcance;
        }

        const huella = huellaDeComando("anulacion", [original.id, detalle.valor], []);
        const repetido = await buscarRepeticion(tx, contexto, {
          clase: "ANULACION",
          clave: clave.valor,
          huella,
          origen: null,
        });
        if (!repetido.ok) return repetido;
        if (repetido.valor !== null) return ok({ anulacionId: repetido.valor.id, yaExistia: true });

        if (!esAnulable(original.clase, original.origenTipo)) return err("MOVIMIENTO_NO_ANULABLE");
        if ((await tx.movimientosDeStock.anulacionDe(contexto.empresaId, original.id)) !== null) {
          return err("MOVIMIENTO_YA_ANULADO");
        }
        const espejo: RenglonDeLibro[] = ordenarParaBloqueo(
          guardados.map((r) => {
            const cantidad = cantidadConSignoDesdeTexto(r.cantidad);
            if (!cantidad.ok) throw new RangeError("stock: el renglón guardado no es una cantidad");
            return {
              depositoId: r.depositoId,
              articuloId: r.articuloId,
              composicionId: r.composicionId,
              cantidad: negarConSigno(cantidad.valor),
            };
          }),
        );
        const registrado = await registrarMovimientoEnTx(tx, contexto, {
          clase: "ANULACION",
          motivo: "ANULACION",
          detalle: detalle.valor,
          origen: null,
          depositoId: original.depositoId,
          accion: "stock.anular",
          anulaA: original.id,
          conteoId: null,
          clave: clave.valor,
          huella,
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          renglones: espejo,
          confirmaciones: [],
        });
        if (!registrado.ok) return registrado;
        return ok({
          anulacionId: registrado.valor.movimiento.id,
          yaExistia: registrado.valor.yaExistia,
        });
      },
    );
    return traducirMovimiento(resultado);
  };
}
