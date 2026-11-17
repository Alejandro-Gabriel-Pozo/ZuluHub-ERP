import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import {
  claveDeLaEntradaDeStock,
  elegirDepositoDeLaCompra,
  motivoDeAnulacionDesdeTexto,
  origenDeLaEntradaDeStock,
} from "../dominio/registrar-compra";
import type { EntradaDeLinea } from "../persistencia/repositorio-de-recepciones-separadas";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

type Destino = Readonly<{
  linea: number;
  depositoId: string;
  uso: string;
  /** `true`: quien confirma eligió un destino distinto del que proponía el control. */
  cambiado: boolean;
}>;

export type EntradaDeConfirmarRecepcion = Readonly<{
  recepcionId: string;
  /** El depósito NORMAL donde entra la mercadería conforme; sin elegir, el único depósito normal activo de la sucursal (S-4). */
  depositoId?: string | null | undefined;
  /**
   * El destino que quien confirma le da a una línea, en lugar del que propone su control (rechazada → rechazo, con observaciones → cuarentena, el resto → normal):
   * cualquier depósito activo de la sucursal. Cada cambio queda en la auditoría.
   */
  destinos?: readonly Readonly<{ linea: number; depositoId: string }>[] | undefined;
}>;

export type SalidaDeConfirmarRecepcion = Readonly<{
  recepcionId: string;
  /** Los movimientos de stock que dejó la confirmación (uno por depósito de destino); vacío si nada controlaba stock. */
  movimientos: readonly string[];
  /** `true`: ya estaba confirmada: no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Confirmar una recepción pendiente (N3 y N4, E9 §3.8): es el momento en que la mercadería pasa a ser stock. Guard `recepciones.confirmar` (gerente y administrador,
 * DEC-0700) y, si algún renglón entra a stock, `stock.registrar_entrada`; la sucursal de la recepción en el alcance. La recepción se bloquea: el estado bajo bloqueo
 * decide, así que dos confirmaciones a la vez dejan una sola (la otra la encuentra ya confirmada y repite). Repetición (`yaExistia`): una recepción ya confirmada
 * devuelve sus movimientos sin escribir ni auditar; una anulada es `RECEPCION_YA_ANULADA`.
 *
 * Todo en UNA transacción: el estado, la entrada de stock (con clave determinista por recepción y depósito), lo que entró por línea, el último precio del proveedor
 * (se registra al confirmar, no al recibir; DEC-0701) y la auditoría. La hora de la entrada de stock es la de la confirmación (DEC-0701).
 *
 * Destino de cada línea (N3-3, decisión del dueño del 14/11/2026: se puede recibir directo a cuarentena o a rechazo): el control PROPONE (rechazada → rechazo, con
 * observaciones → cuarentena, conforme o sin control → normal) y quien confirma puede cambiarlo línea por línea (`destinos`); el cambio queda en la auditoría. Sin depósito de
 * cuarentena o rechazo en la sucursal, la confirmación se BLOQUEA con `DEPOSITO_DE_CALIDAD_NO_CONFIGURADO` (falla cerrada, nunca entra al normal en silencio); con más de uno
 * y sin elegir, `DEPOSITO_A_ELEGIR`. Una línea rechazada no actualiza el último precio del proveedor (DEC-0703). Una entrada de stock por depósito de destino.
 */
export function armarConfirmarRecepcion(dependencias: DependenciasDeCompras) {
  return async function confirmarRecepcion(
    contexto: ContextoOperativo,
    entrada: EntradaDeConfirmarRecepcion,
  ): Promise<R<SalidaDeConfirmarRecepcion>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.recepcionId)) return err("RECEPCION_NO_ENCONTRADA");
    if (
      entrada.depositoId !== undefined &&
      entrada.depositoId !== null &&
      !esUuid(entrada.depositoId)
    ) {
      return err("DEPOSITO_NO_ENCONTRADO");
    }
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeConfirmarRecepcion>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "recepciones.confirmar",
          ]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepcionesSeparadas.bloquearSeparada(
            empresaId,
            entrada.recepcionId,
          );
          if (recepcion === null || !esNivelDeRecepcionSeparada(recepcion.nivel)) {
            return err("RECEPCION_NO_ENCONTRADA");
          }
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          if (recepcion.estado === "CONFIRMADA") {
            const hechas = await tx.recepcionesSeparadas.entradasDe(empresaId, recepcion.id);
            return ok({
              recepcionId: recepcion.id,
              movimientos: [...new Set(hechas.map((h) => h.movimientoId))],
              yaExistia: true,
            });
          }

          // Qué entra a stock: los renglones de artículos controlados con stock activo, cada uno al destino que le toca (ver `destinoDeLaLinea`).
          const lineas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const controles = await tx.recepcionesSeparadas.controlesDe(empresaId, recepcion.id);
          const condicionDe = new Map(controles.map((c) => [c.linea, c.condicion]));
          const rechazadas = new Set(
            controles.filter((c) => c.condicion === "RECHAZADA").map((c) => c.linea),
          );
          const controla = await dependencias.stock.articulosDeVenta.controla(
            tx,
            contexto,
            lineas.map((l) => l.productoId),
          );
          const entran = lineas.filter((l) => controla.get(l.productoId)?.controla === true);
          const destinos: Destino[] = [];
          if (entran.length > 0) {
            const acciones: [ClaveAccion, ...ClaveAccion[]] = ["stock.registrar_entrada"];
            const stock = await autorizar(tx, contexto, dependencias.reglas, acciones);
            if (!stock.ok) return stock;
            const sucursal = sucursalId(recepcion.sucursalId);
            const depositos = (
              await tx.depositos.listar(empresaId, {
                alcance: [sucursal],
                sucursalId: sucursal,
                soloActivos: true,
              })
            ).map((d) => ({ id: d.id, uso: d.uso }));
            const pedidos = new Map((entrada.destinos ?? []).map((d) => [d.linea, d.depositoId]));
            for (const linea of pedidos.keys()) {
              if (!entran.some((l) => l.numero === linea)) return err("LINEA_NO_ENCONTRADA");
            }
            for (const l of entran) {
              const destino = destinoDeLaLinea({
                condicion: condicionDe.get(l.numero) ?? null,
                depositos,
                elegidoParaLaLinea: pedidos.get(l.numero) ?? null,
                depositoNormal: entrada.depositoId ?? null,
              });
              if (!destino.ok) return destino;
              destinos.push({ linea: l.numero, ...destino.valor });
            }
          }

          const confirmada = await tx.recepcionesSeparadas.confirmar(
            empresaId,
            recepcion.id,
            persona,
          );
          if (!confirmada) throw new Error("la recepción ya no estaba pendiente bajo bloqueo");
          const movimientos: string[] = [];
          const entradas: EntradaDeLinea[] = [];
          for (const depositoId of [...new Set(destinos.map((d) => d.depositoId))]) {
            const deEste = entran.filter((l) =>
              destinos.some((d) => d.linea === l.numero && d.depositoId === depositoId),
            );
            const renglones = [];
            for (const l of deEste) {
              const producto = await tx.productosParaCompras.obtener(empresaId, l.productoId);
              if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
              renglones.push({
                productoId: l.productoId,
                cantidad: l.cantidadEnStock,
                unidadId: producto.unidadBaseId,
                ...(l.costoPorUnidadDeStock === null
                  ? {}
                  : { costoUnitario: l.costoPorUnidadDeStock }),
              });
            }
            const hecha = await dependencias.stock.entradaPorOrigen.registrarEntrada(tx, contexto, {
              clave: claveDeLaEntradaDeStock(recepcion.id, depositoId),
              origen: { tipo: "RECEPCION", id: origenDeLaEntradaDeStock(recepcion.id, depositoId) },
              accion: "stock.registrar_entrada",
              depositoId,
              motivo: "COMPRA",
              hechoEn: contexto.ahora,
              renglones,
            });
            if (!hecha.ok) return hecha;
            movimientos.push(hecha.valor.movimientoId);
            for (const l of deEste) {
              entradas.push({
                linea: l.numero,
                depositoId,
                movimientoId: hecha.valor.movimientoId,
                cantidad: l.cantidadEnStock,
              });
            }
          }
          await tx.recepcionesSeparadas.insertarEntradas(empresaId, recepcion.id, entradas);

          // Lo que cobró el proveedor: la compra más nueva gana (se registra al confirmar, no al recibir).
          for (const l of lineas) {
            if (rechazadas.has(l.numero) || l.precio === null || l.costoPorUnidadDeStock === null) {
              continue;
            }
            if (l.precioPorTipo === null) continue;
            await tx.ofertasDeProveedor.registrar(empresaId, {
              proveedorId: recepcion.proveedorId,
              productoId: l.productoId,
              presentacionId: l.presentacionId,
              precioPorTipo: l.precioPorTipo,
              unidadDePrecioId: l.unidadDePrecioId,
              ultimoPrecio: l.precio,
              ultimoCostoPorUnidadDeStock: l.costoPorUnidadDeStock,
              ultimaCompraId: recepcion.id,
              ultimaCompraEn: contexto.ahora,
            });
          }

          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "RECEPCION_CONFIRMADA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { estado: "PENDIENTE" },
            despues: {
              estado: "CONFIRMADA",
              renglones: lineas.length,
              sinEntrada: lineas.length - entran.length,
              movimientos,
              destinos: destinos.map((d) => ({
                linea: d.linea,
                depositoId: d.depositoId,
                uso: d.uso,
                destinoElegido: d.cambiado,
              })),
            },
          });
          return ok({ recepcionId: recepcion.id, movimientos, yaExistia: false });
        },
      ),
    );
  };
}

const USO_QUE_PROPONE: Readonly<Record<string, string>> = {
  CONFORME: "NORMAL",
  CON_OBSERVACIONES: "CUARENTENA",
  RECHAZADA: "RECHAZO",
};

/**
 * A qué depósito va una línea: el que eligió quien confirma (cualquier depósito activo de la sucursal) o, sin elección, el que corresponde al uso que propone su control.
 * Del uso normal sirve `elegirDepositoDeLaCompra` (el elegido o el único); de cuarentena o rechazo, el único de la sucursal.
 */
function destinoDeLaLinea(
  datos: Readonly<{
    condicion: string | null;
    depositos: readonly Readonly<{ id: string; uso: string }>[];
    elegidoParaLaLinea: string | null;
    depositoNormal: string | null;
  }>,
): R<Readonly<{ depositoId: string; uso: string; cambiado: boolean }>> {
  const uso = USO_QUE_PROPONE[datos.condicion ?? "CONFORME"] ?? "NORMAL";
  if (datos.elegidoParaLaLinea !== null) {
    const elegido = datos.depositos.find((d) => d.id === datos.elegidoParaLaLinea);
    if (elegido === undefined) return err("DEPOSITO_NO_ENCONTRADO");
    return ok({ depositoId: elegido.id, uso: elegido.uso, cambiado: elegido.uso !== uso });
  }
  const candidatos = datos.depositos.filter((d) => d.uso === uso).map((d) => d.id);
  if (uso === "NORMAL") {
    const normal = elegirDepositoDeLaCompra(candidatos, datos.depositoNormal);
    return normal.ok ? ok({ depositoId: normal.valor, uso, cambiado: false }) : normal;
  }
  const [unico, ...resto] = candidatos;
  if (unico === undefined) return err("DEPOSITO_DE_CALIDAD_NO_CONFIGURADO");
  if (resto.length > 0) return err("DEPOSITO_A_ELEGIR");
  return ok({ depositoId: unico, uso, cambiado: false });
}

export type EntradaDeAnularRecepcionPendiente = Readonly<{ recepcionId: string; motivo: string }>;

/**
 * Anular una recepción que todavía está PENDIENTE (nada entró a stock, así que no hay nada que devolver). Guard `recepciones.anular` (gerente y administrador). El
 * motivo es obligatorio y queda con quién y cuándo; nada se borra. Una ya anulada es `RECEPCION_YA_ANULADA` y no escribe; una ya confirmada es
 * `RECEPCION_YA_CONFIRMADA` (su anulación devuelve el stock y llega con el camino de anular de N3). Con dos anulaciones, o una anulación y una confirmación a la vez,
 * el estado bajo bloqueo decide.
 */
export function armarAnularRecepcionPendiente(dependencias: DependenciasDeCompras) {
  return async function anularRecepcionPendiente(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularRecepcionPendiente,
  ): Promise<R<Readonly<{ anulada: true }>>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.recepcionId)) return err("RECEPCION_NO_ENCONTRADA");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<Readonly<{ anulada: true }>>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "recepciones.anular",
          ]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepcionesSeparadas.bloquearSeparada(
            empresaId,
            entrada.recepcionId,
          );
          if (recepcion === null || !esNivelDeRecepcionSeparada(recepcion.nivel)) {
            return err("RECEPCION_NO_ENCONTRADA");
          }
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          if (recepcion.estado === "CONFIRMADA") return err("RECEPCION_YA_CONFIRMADA");
          const hecho = await tx.recepcionesSeparadas.anularPendiente(empresaId, recepcion.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("la recepción ya no estaba pendiente bajo bloqueo");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "RECEPCION_ANULADA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { estado: "PENDIENTE" },
            despues: { estado: "ANULADA", motivo: motivo.valor },
          });
          return ok({ anulada: true });
        },
      ),
    );
  };
}
