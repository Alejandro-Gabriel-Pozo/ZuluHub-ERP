import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import {
  claveDeLaSalidaDeDevolucion,
  huellaDeLaDevolucion,
  leerDevolucion,
} from "../dominio/devolucion";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirTresVias } from "./nivel-tres-vias";
import { leerHechoEn } from "./registrar-compra-apoyo";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/** Lo que pide una devolución: el contenido (`leerDevolucion`), la clave del gesto y, si hace falta, la confirmación de dejar la existencia en negativo. */
export type EntradaDeDevolverAlProveedor = Readonly<{
  clave: string;
  sucursalId: string;
  proveedorId: string;
  depositoId: string;
  /** El valor activo de la lista del sistema de motivos de rechazo (obligatorio y cerrado: sin texto libre). */
  motivoId: string;
  remito?: unknown;
  /** Solo si la persona lo mandó: el `ahora` del contexto no entra en la huella. */
  hechoEn?: Date | undefined;
  /** Con el control `stock.existencia_negativa` en AVISAR, la persona confirma que va a quedar en negativo. */
  confirmoExistenciaNegativa?: boolean | undefined;
  lineas: unknown;
}>;

export type SalidaDeDevolverAlProveedor = Readonly<{
  devolucionId: string;
  numero: number;
  /** `true`: la misma devolución ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Devolver mercadería al proveedor (N4, E9 §3.8): una salida de stock con su motivo (de la lista del sistema de motivos de rechazo), de UN depósito de la sucursal, más la devolución
 * con sus líneas, todo en UNA transacción (o se hace todo o no se hace nada). Devolver mercadería NO devuelve dinero ni crea una nota de crédito. Guard `devoluciones_a_proveedor.registrar`
 * (gerente y administrador) y `stock.registrar_salida`; la sucursal en el alcance de quien pide; la empresa en N4 con la perilla de tres vías. La devolución se numera y se fecha
 * (jornada de la sucursal) en la base; si la línea dice de qué recepción vino, la base verifica que sea del mismo proveedor y producto y que no se devuelva más de lo recibido.
 * Repetición: misma clave y mismo contenido devuelve lo hecho (`yaExistia`) sin escribir ni auditar; misma clave con otro contenido, `CLAVE_REUTILIZADA`; dos pedidos
 * iguales a la vez: gana uno y el otro ve su fila y repite. El control de existencia negativa es el de stock.
 */
export function armarDevolverAlProveedor(dependencias: DependenciasDeCompras) {
  return async function devolverAlProveedor(
    contexto: ContextoOperativo,
    entrada: EntradaDeDevolverAlProveedor,
  ): Promise<R<SalidaDeDevolverAlProveedor>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave)) return err("IDENTIFICADOR_INVALIDO");
    const leida = leerDevolucion(entrada);
    if (!leida.ok) return leida;
    const devolucion = leida.valor;
    const leidoHechoEn = leerHechoEn(entrada.hechoEn, contexto.ahora);
    if (!leidoHechoEn.ok) return leidoHechoEn;
    const huella = huellaDeLaDevolucion(
      devolucion,
      entrada.hechoEn === undefined ? null : entrada.hechoEn.toISOString(),
    );

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeDevolverAlProveedor>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "devoluciones_a_proveedor.registrar",
            "stock.registrar_salida",
          ]);
          if (!permiso.ok) return permiso;
          const sucursal = sucursalId(devolucion.sucursalId);
          const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
          if (!alcance.ok) return alcance;
          const fila = await tx.sucursales.obtener(empresaId, sucursal);
          if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
          if (!fila.activa) return err("SUCURSAL_INACTIVA");
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;

          const repetida = await repeticion(tx, empresaId, entrada.clave, huella);
          if (repetida !== null) return repetida;

          const proveedor = await directorio.parteParaOperacion(
            tx,
            empresaId,
            devolucion.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
          // El depósito es de la sucursal de la devolución (la jornada y el alcance son los de esa sucursal); que esté activo y en el alcance lo comprueba stock al descontar.
          const deposito = await tx.depositos.obtener(empresaId, devolucion.depositoId);
          if (deposito === null || deposito.sucursalId !== sucursal) {
            return err("DEPOSITO_NO_ENCONTRADO");
          }
          const renglones = [];
          for (const l of devolucion.lineas) {
            const producto = await tx.productosParaCompras.obtener(empresaId, l.productoId);
            if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
            renglones.push({
              productoId: l.productoId,
              cantidad: l.cantidad,
              unidadId: producto.unidadBaseId,
            });
          }

          const devolucionId = await tx.devolucionesAProveedor.insertar(empresaId, {
            sucursalId: devolucion.sucursalId,
            proveedorId: proveedor.valor.id,
            motivoId: devolucion.motivoId,
            remitoNumero: devolucion.remito === null ? null : devolucion.remito.numero,
            remitoFecha: devolucion.remito === null ? null : devolucion.remito.fecha,
            clave: entrada.clave,
            huella,
            hechoEn: leidoHechoEn.valor,
            registradoPor: persona,
          });
          if (devolucionId === undefined) {
            // Perdió una carrera: otra transacción ya escribió la misma clave. Se vuelve a mirar (ya está confirmada su fila).
            const ganadora = await repeticion(tx, empresaId, entrada.clave, huella);
            if (ganadora !== null) return ganadora;
            throw new Error("la devolución chocó con una restricción única que no es la clave");
          }

          const salida = await dependencias.stock.salidaPorOrigen.registrarSalida(tx, contexto, {
            clave: claveDeLaSalidaDeDevolucion(devolucionId),
            origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: devolucionId },
            accion: "stock.registrar_salida",
            depositoId: deposito.id,
            motivo: "DEVOLUCION_A_PROVEEDOR",
            hechoEn: leidoHechoEn.valor,
            renglones,
            ...(entrada.confirmoExistenciaNegativa === true
              ? { confirmaciones: ["stock.existencia_negativa"] }
              : {}),
          });
          if (!salida.ok) return salida;
          if (salida.valor.yaExistia) {
            throw new Error("la devolución nueva ya tenía una salida de stock");
          }

          // Cada línea con su renglón de stock: el artículo de cada renglón es el de un producto de la devolución (stock no repite artículo en una salida).
          const articulos = await tx.articulosDeStock.porIds(
            empresaId,
            salida.valor.renglones.map((r) => r.articuloId),
          );
          const productoDe = new Map(articulos.map((a) => [a.id, a.productoId]));
          const guardadas = devolucion.lineas.map((l, i) => {
            const renglon = salida.valor.renglones.find(
              (r) => productoDe.get(r.articuloId) === l.productoId,
            );
            if (renglon === undefined) {
              throw new Error("stock no devolvió el renglón de una línea de la devolución");
            }
            return {
              numero: i + 1,
              depositoId: renglon.depositoId,
              articuloId: renglon.articuloId,
              cantidad: l.cantidad,
              recepcionId: l.origen === null ? null : l.origen.recepcionId,
              lineaDeRecepcion: l.origen === null ? null : l.origen.lineaDeRecepcion,
              movimientoId: salida.valor.movimientoId,
              renglonNumero: renglon.numero,
            };
          });
          await tx.devolucionesAProveedor.insertarLineas(empresaId, devolucionId, guardadas);
          const guardada = await tx.devolucionesAProveedor.obtener(empresaId, devolucionId);
          if (guardada === null) throw new Error("la devolución no quedó guardada");

          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "DEVOLUCION_REGISTRADA",
            entidad: "devolucion_a_proveedor",
            entidadId: devolucionId,
            despues: {
              numero: guardada.numero,
              proveedorId: proveedor.valor.id,
              sucursalId: devolucion.sucursalId,
              depositoId: deposito.id,
              motivoId: devolucion.motivoId,
              remito: devolucion.remito,
              estado: "CONFIRMADA",
              renglones: guardadas.length,
              movimientoId: salida.valor.movimientoId,
              existenciaNegativa: salida.valor.excepciones.length,
            },
          });
          return ok({ devolucionId, numero: guardada.numero, yaExistia: false });
        },
      ),
    );
  };
}

/** ¿Ya estaba? Por la clave: misma huella, repetida; otra, reutilizada. `null` si es nueva. */
async function repeticion(
  tx: Pick<TxDeCompras, "devolucionesAProveedor">,
  empresaId: ContextoOperativo["empresaId"],
  clave: string,
  huella: string,
): Promise<R<SalidaDeDevolverAlProveedor> | null> {
  const previa = await tx.devolucionesAProveedor.porClave(empresaId, clave);
  if (previa === null) return null;
  if (decidirPorHuella(previa.huella, huella) !== "REPETIDA") return err("CLAVE_REUTILIZADA");
  return ok({ devolucionId: previa.id, numero: previa.numero, yaExistia: true });
}

export type EntradaDeAnularDevolucion = Readonly<{ devolucionId: string; motivo: string }>;
export type SalidaDeAnularDevolucion = Readonly<{
  /** `true`: la devolución ya estaba anulada: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}>;

/**
 * Anular una devolución (N4), con motivo: la mercadería vuelve al depósito con una anulación ESPEJO de la salida (mismas cantidades y el mismo costo con que salió), y la devolución
 * queda `ANULADA` con quién, cuándo y por qué; nada se borra. Guard `devoluciones_a_proveedor.anular` (gerente y administrador) y `stock.anular`, y la sucursal en el alcance. Completa
 * lo hecho: no pide la perilla. Todo o nada. Una ya anulada no escribe (`yaEstaba`); la devolución se bloquea, así que dos anulaciones a la vez dejan un solo espejo.
 */
export function armarAnularDevolucion(dependencias: DependenciasDeCompras) {
  return async function anularDevolucion(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularDevolucion,
  ): Promise<R<SalidaDeAnularDevolucion>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.devolucionId)) return err("DEVOLUCION_NO_ENCONTRADA");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeAnularDevolucion>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "devoluciones_a_proveedor.anular",
            "stock.anular",
          ]);
          if (!permiso.ok) return permiso;
          const guardada = await tx.devolucionesAProveedor.bloquear(
            empresaId,
            entrada.devolucionId,
          );
          if (guardada === null) return err("DEVOLUCION_NO_ENCONTRADA");
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(guardada.sucursalId),
          );
          // Una devolución de una sucursal fuera del alcance no existe para quien pide (no se revela).
          if (!alcance.ok) return err("DEVOLUCION_NO_ENCONTRADA");
          if (guardada.estado === "ANULADA") return ok({ yaEstaba: true });

          const espejo = await dependencias.stock.salidaPorOrigen.anular(tx, contexto, {
            origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: guardada.id },
            accion: "stock.anular",
            detalle: motivo.valor,
          });
          if (!espejo.ok) return espejo;
          if (!espejo.valor.habiaSalida) {
            throw new Error("la devolución confirmada no tenía salida de stock");
          }
          await tx.devolucionesAProveedor.anular(empresaId, guardada.id, {
            por: persona,
            motivo: motivo.valor,
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "DEVOLUCION_ANULADA",
            entidad: "devolucion_a_proveedor",
            entidadId: guardada.id,
            antes: { estado: "CONFIRMADA" },
            despues: {
              estado: "ANULADA",
              motivo: motivo.valor,
              anulacionDeStockId: espejo.valor.anulacionId,
            },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
