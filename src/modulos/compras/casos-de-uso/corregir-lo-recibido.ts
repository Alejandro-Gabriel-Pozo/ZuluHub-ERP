import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  camposDeHuellaDeLaCorreccionDeLoRecibido,
  claveDelMovimientoDeLaCorreccion,
  idDeLaCorreccionDeLoRecibido,
  leerCorreccionDeLoRecibido,
  type CausaDeCorreccion,
} from "../dominio/correccion-de-lo-recibido";
import { leerCantidad, leerCantidadPositiva, textoDeCantidad } from "../dominio/decimal";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeCorregirLoRecibido = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  /** Cuántas correcciones de esta línea había cuando quien pide miró la recepción (0 si ninguna). */
  correccionesVistas: number;
  /** La cantidad realmente recibida, en la unidad de stock de la línea. */
  cantidad: string;
  causa: CausaDeCorreccion;
  nota?: string | null | undefined;
  confirmoExistenciaNegativa?: boolean | undefined;
}>;

export type SalidaDeCorregirLoRecibido = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  cantidadAnterior: string;
  cantidadNueva: string;
  /** `true`: la misma corrección ya estaba hecha (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Corregir lo recibido de una línea de una recepción separada ya confirmada (E9 N3, decisión del dueño del 25/11/2026): no se reabre la recepción; se suma un registro con la cantidad que de
 * verdad llegó, su causa (lista cerrada) y una nota opcional, y el stock se acomoda con UN movimiento por la diferencia (una entrada si llegó más, una salida si llegó menos), todo en UNA
 * transacción serializable por la fila del saldo de la línea. Guard `compras.corregir` (gerente y administrador) más `stock.registrar_entrada` o `stock.registrar_salida` según el sentido; la
 * sucursal de la recepción en el alcance de quien corrige. La cantidad es la de la unidad de stock (la misma con la que se concilia). Una corrección que dejaría lo recibido por debajo de lo
 * ya conciliado se rechaza (primero se anula la conciliación): la base lo impide aunque este caso de uso lo olvidara. La entrada declara el costo de la línea si lo tiene; la salida sale al
 * promedio vigente y lo ya vendido conserva su costo. Solo líneas que entraron enteras a UN depósito de uso normal. Repetición: misma clave y mismo contenido devuelve lo hecho sin escribir ni
 * auditar; misma clave con otro contenido, `CLAVE_REUTILIZADA`; dos pedidos a la vez sobre la línea: gana uno y el otro ve `CORRECCION_DESACTUALIZADA`.
 */
export function armarCorregirLoRecibido(dependencias: DependenciasDeCompras) {
  return async function corregirLoRecibido(
    contexto: ContextoOperativo,
    entrada: EntradaDeCorregirLoRecibido,
  ): Promise<R<SalidaDeCorregirLoRecibido>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    const pedido = leerCorreccionDeLoRecibido(entrada);
    if (!pedido.ok) return pedido;
    const p = pedido.valor;
    const correccionId = idDeLaCorreccionDeLoRecibido(p.clave);
    const huella = huellaDeComando(
      "corregir_lo_recibido",
      camposDeHuellaDeLaCorreccionDeLoRecibido(p),
      [],
    );

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCorregirLoRecibido>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, ["compras.corregir"]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepcionesSeparadas.bloquearSeparada(
            empresaId,
            p.recepcionId,
          );
          if (recepcion === null || recepcion.nivel !== "RECEPCION_SEPARADA") {
            return err("RECEPCION_NO_ENCONTRADA");
          }
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;

          const previa = await tx.correccionesDeLoRecibido.porClave(empresaId, p.clave);
          if (previa !== null) {
            return decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({
                  recepcionId: previa.recepcionId,
                  linea: previa.linea,
                  numero: previa.numero,
                  cantidadAnterior: previa.cantidadAnterior,
                  cantidadNueva: previa.cantidadNueva,
                  yaExistia: true,
                })
              : err("CLAVE_REUTILIZADA");
          }
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          if (recepcion.estado !== "CONFIRMADA") return err("RECEPCION_NO_CONFIRMADA");

          const lineas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const linea = lineas.find((l) => l.numero === p.linea);
          if (linea === undefined) return err("LINEA_NO_ENCONTRADA");
          // Lo que rige hoy es el saldo (la línea conserva lo que se cargó): la fila se bloquea, y con ella se serializan las correcciones y las conciliaciones de esta línea.
          const saldo = await tx.correccionesDeLoRecibido.saldoBloqueado(
            empresaId,
            recepcion.id,
            linea.numero,
          );
          if (saldo === null) return err("LINEA_NO_ENCONTRADA");
          const ultima = await tx.correccionesDeLoRecibido.ultimaDeLaLinea(
            empresaId,
            recepcion.id,
            linea.numero,
          );
          if ((ultima?.numero ?? 0) !== p.correccionesVistas)
            return err("CORRECCION_DESACTUALIZADA");

          const anterior = leerCantidadPositiva(saldo.recibida);
          const asignada = leerCantidad(saldo.asignada);
          const nueva = leerCantidadPositiva(p.cantidad);
          if (anterior === null || nueva === null || asignada === null) {
            throw new Error("el saldo de la línea no es una cantidad válida");
          }
          if (nueva === anterior) return err("SIN_CAMBIOS");
          if (nueva < asignada) return err("CORRECCION_BAJO_LO_CONCILIADO");

          // La línea tiene que haber entrado entera a UN depósito de uso normal y activo: lo demás (varios destinos, cuarentena, rechazo) no se corrige acá.
          const entradas = (
            await tx.recepcionesSeparadas.entradasDe(empresaId, recepcion.id)
          ).filter((e) => e.linea === linea.numero);
          const unica = entradas.length === 1 ? entradas[0] : undefined;
          if (unica === undefined) return err("CORRECCION_NO_SOPORTADA_PARA_LA_LINEA");
          const deposito = await tx.depositos.obtener(empresaId, unica.depositoId);
          if (deposito === null || !deposito.activo || deposito.uso !== "NORMAL") {
            return err("CORRECCION_NO_SOPORTADA_PARA_LA_LINEA");
          }

          const sentido = nueva > anterior ? "ENTRADA" : "SALIDA";
          const accionDeStock =
            sentido === "ENTRADA" ? "stock.registrar_entrada" : "stock.registrar_salida";
          const permisoDeStock = await autorizar(tx, contexto, dependencias.reglas, [
            accionDeStock,
          ]);
          if (!permisoDeStock.ok) return permisoDeStock;
          const producto = await tx.productosParaCompras.obtener(empresaId, linea.productoId);
          if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");

          const diferencia = textoDeCantidad(
            sentido === "ENTRADA" ? nueva - anterior : anterior - nueva,
          );
          const movimiento = await dependencias.stock.correccionDeRecepcion.registrar(
            tx,
            contexto,
            {
              clave: claveDelMovimientoDeLaCorreccion(correccionId),
              origen: { tipo: "CORRECCION_DE_RECEPCION", id: correccionId },
              accion: accionDeStock,
              depositoId: deposito.id,
              sentido,
              hechoEn: contexto.ahora,
              renglones: [
                {
                  productoId: linea.productoId,
                  cantidad: diferencia,
                  unidadId: producto.unidadBaseId,
                  ...(sentido === "ENTRADA" && linea.costoPorUnidadDeStock !== null
                    ? { costoUnitario: linea.costoPorUnidadDeStock }
                    : {}),
                },
              ],
              ...(p.confirmoExistenciaNegativa
                ? { confirmaciones: ["stock.existencia_negativa"] }
                : {}),
            },
          );
          if (!movimiento.ok) return movimiento;
          if (movimiento.valor.yaExistia) {
            throw new Error("la corrección nueva ya tenía un movimiento de stock");
          }

          const numero = p.correccionesVistas + 1;
          const anteriorTexto = textoDeCantidad(anterior);
          const nuevaTexto = textoDeCantidad(nueva);
          const guardada = await tx.correccionesDeLoRecibido.insertar(empresaId, {
            id: correccionId,
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero,
            cantidadAnterior: anteriorTexto,
            cantidadNueva: nuevaTexto,
            causa: p.causa,
            nota: p.nota,
            movimientoId: movimiento.valor.movimientoId,
            clave: p.clave,
            huella,
            registradoPor: persona,
          });
          if (!guardada) {
            throw new Error(
              "la corrección chocó con una restricción única bajo el bloqueo de la línea",
            );
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "COMPRA_CORREGIDA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { linea: linea.numero, cantidadRecibida: anteriorTexto },
            despues: {
              tipo: "CANTIDAD_RECIBIDA",
              linea: linea.numero,
              numero,
              cantidadRecibida: nuevaTexto,
              causa: p.causa,
              nota: p.nota,
              movimientoId: movimiento.valor.movimientoId,
              depositoId: deposito.id,
              existenciaNegativa: movimiento.valor.excepciones.length,
            },
          });
          return ok({
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero,
            cantidadAnterior: anteriorTexto,
            cantidadNueva: nuevaTexto,
            yaExistia: false,
          });
        },
      ),
    );
  };
}
