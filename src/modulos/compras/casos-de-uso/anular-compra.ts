import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  compararConSigno,
  negarConSigno,
  sumarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { registrarMovimientoEnTx } from "../../stock/publico";
import { huellaDeComando } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import {
  claveDeLaAnulacionDeLaConciliacion,
  claveDeLaAnulacionDeLaEntrada,
  motivoDeAnulacionDesdeTexto,
  origenDeLaEntradaDeStock,
} from "../dominio/registrar-compra";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeAnularCompra = Readonly<{ recepcionId: string; motivo: string }>;
export type SalidaDeAnularCompra = Readonly<{ anulada: true }>;

/**
 * Anular una compra (E9 §3.5): una anulación ESPEJO de su entrada de stock (mismo depósito y renglones con la cantidad opuesta, y el mismo costo congelado), del espejo de la conciliación atajo, de su factura (queda `ANULADO`: libera el número) y de su pago vigente, y la
 * recepción queda `ANULADA` con quién, cuándo y por qué; nada se borra. Guard `recepciones.anular` (gerente y administrador) y, si hubo entrada, también
 * `stock.anular`. Si lo que entró ya se consumió (la existencia actual del depósito es menor que lo que entró) no se anula: `COMPRA_CONSUMIDA`, se corrige
 * (D143). Todo o nada: si el espejo falla, la compra sigue como estaba. Repetición (`RECHAZA_LA_REPETICION`): anular una compra ya anulada es
 * `RECEPCION_YA_ANULADA` y no escribe nada; el estado de la recepción bajo bloqueo es lo que decide, así que dos anulaciones a la vez dejan un solo espejo.
 */
export function armarAnularCompra(dependencias: DependenciasDeCompras) {
  return async function anularCompra(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularCompra,
  ): Promise<R<SalidaDeAnularCompra>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    if (!esUuid(entrada.recepcionId)) return err("RECEPCION_NO_ENCONTRADA");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeAnularCompra>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "recepciones.anular",
          ]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepciones.bloquear(empresaId, entrada.recepcionId);
          if (recepcion === null) return err("RECEPCION_NO_ENCONTRADA");
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");

          const lineas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const entradas = lineas.filter((l) => l.movimientoId !== null && l.depositoId !== null);
          const movimientos = [...new Set(entradas.map((l) => l.movimientoId as string))];
          if (movimientos.length > 0) {
            const stock = await autorizar(tx, contexto, dependencias.reglas, ["stock.anular"]);
            if (!stock.ok) return stock;
          }
          for (const movimientoId of movimientos) {
            const delMovimiento = entradas.filter((l) => l.movimientoId === movimientoId);
            const depositoId = delMovimiento[0]?.depositoId as string;
            const original = await tx.movimientosDeStock.obtener(empresaId, movimientoId);
            if (original === null) throw new Error("la entrada de stock de la compra no existe");
            // Si stock ya la anuló por su lado, no hay nada que revertir.
            if ((await tx.movimientosDeStock.anulacionDe(empresaId, movimientoId)) !== null)
              continue;

            // ¿Sigue estando lo que entró? Existencia actual por producto contra lo que entró en esta compra.
            const entro = new Map<string, CantidadConSigno>();
            for (const l of delMovimiento) {
              const cantidad = cantidadConSignoDesdeTexto(l.cantidadEnStock);
              if (!cantidad.ok)
                throw new RangeError("compras: la cantidad guardada no es una cantidad");
              const previa = entro.get(l.productoId);
              const suma =
                previa === undefined ? ok(cantidad.valor) : sumarConSigno(previa, cantidad.valor);
              if (!suma.ok) throw new RangeError("compras: la suma de cantidades se pasó de rango");
              entro.set(l.productoId, suma.valor);
            }
            const existencias = await dependencias.stock.existenciaParaMostrar.existencias(
              tx,
              contexto,
              [...entro.keys()],
              depositoId,
            );
            for (const [productoId, cantidad] of entro) {
              const hay = existencias.find((e) => e.productoId === productoId);
              const existencia = cantidadConSignoDesdeTexto(hay?.existencia ?? "0");
              if (!existencia.ok) throw new RangeError("stock: la existencia no es una cantidad");
              if (compararConSigno(existencia.valor, cantidad) < 0) return err("COMPRA_CONSUMIDA");
            }

            const guardados = await tx.movimientosDeStock.renglonesDe(empresaId, movimientoId);
            const espejo = guardados.map((r) => {
              const cantidad = cantidadConSignoDesdeTexto(r.cantidad);
              if (!cantidad.ok)
                throw new RangeError("stock: el renglón guardado no es una cantidad");
              return {
                depositoId: r.depositoId,
                articuloId: r.articuloId,
                composicionId: r.composicionId,
                cantidad: negarConSigno(cantidad.valor),
              };
            });
            const registrado = await registrarMovimientoEnTx(tx, contexto, {
              clase: "ANULACION",
              motivo: "ANULACION",
              detalle: motivo.valor,
              origen: { tipo: "RECEPCION", id: origenDeLaEntradaDeStock(recepcion.id, depositoId) },
              depositoId,
              accion: "stock.anular",
              anulaA: movimientoId,
              conteoId: null,
              clave: claveDeLaAnulacionDeLaEntrada(recepcion.id, depositoId),
              huella: huellaDeComando("anular_compra", [recepcion.id, movimientoId], []),
              hechoEn: contexto.ahora,
              fechaDeNegocio: null,
              renglones: espejo,
              confirmaciones: [],
            });
            if (!registrado.ok) return registrado;
          }

          // La factura de la compra y su conciliación atajo: espejo de la conciliación (cantidades opuestas, una sola vez) y comprobante ANULADO.
          const comprobante = await tx.comprobantesDeProveedor.delaRecepcion(
            empresaId,
            recepcion.id,
          );
          if (comprobante !== null) {
            const bloqueado = await tx.comprobantesDeProveedor.bloquear(empresaId, comprobante.id);
            if (bloqueado !== null && bloqueado.estado === "REGISTRADO") {
              const conciliaciones = await tx.conciliacionesDeCompra.conciliacionesDe(
                empresaId,
                bloqueado.id,
              );
              const yaEspejadas = new Set(conciliaciones.map((c) => c.anulaA));
              for (const conciliacion of conciliaciones) {
                if (conciliacion.acto !== "CONCILIACION" || yaEspejadas.has(conciliacion.id))
                  continue;
                const espejo = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
                  acto: "ANULACION",
                  anulaA: conciliacion.id,
                  comprobanteId: bloqueado.id,
                  esAtajo: true,
                  nivel: bloqueado.nivel,
                  clave: claveDeLaAnulacionDeLaConciliacion(conciliacion.id),
                  registradoPor: persona,
                });
                if (espejo === undefined) {
                  throw new Error("el espejo de la conciliación chocó con una restricción única");
                }
                const asignaciones = await tx.conciliacionesDeCompra.asignacionesDe(
                  empresaId,
                  conciliacion.id,
                );
                await tx.conciliacionesDeCompra.insertarAsignaciones(
                  empresaId,
                  { id: espejo, acto: "ANULACION", comprobanteId: bloqueado.id },
                  asignaciones.map((a) => {
                    const cantidad = cantidadConSignoDesdeTexto(a.cantidad);
                    if (!cantidad.ok)
                      throw new RangeError("compras: la asignación guardada no es una cantidad");
                    return {
                      ...a,
                      cantidad: cantidadConSignoATexto(negarConSigno(cantidad.valor)),
                    };
                  }),
                );
              }
              const pagoVigente = await tx.pagosDeProveedor.vigenteDe(empresaId, bloqueado.id);
              if (pagoVigente !== null) {
                const pagoAnulado = await tx.pagosDeProveedor.anular(empresaId, pagoVigente.id, {
                  por: persona,
                  en: contexto.ahora,
                  motivo: motivo.valor,
                });
                if (!pagoAnulado) throw new Error("el pago ya no estaba vigente bajo bloqueo");
              }
              const comprobanteAnulado = await tx.comprobantesDeProveedor.anular(
                empresaId,
                bloqueado.id,
                {
                  por: persona,
                  en: contexto.ahora,
                  motivo: motivo.valor,
                },
              );
              if (!comprobanteAnulado)
                throw new Error("el comprobante ya no estaba registrado bajo bloqueo");
            }
          }

          const hecho = await tx.recepciones.anular(empresaId, recepcion.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("la recepción ya no estaba confirmada bajo bloqueo");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "COMPRA_ANULADA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { estado: "CONFIRMADA" },
            despues: { estado: "ANULADA", motivo: motivo.valor },
          });
          return ok({ anulada: true });
        },
      ),
    );
  };
}
