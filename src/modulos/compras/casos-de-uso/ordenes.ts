import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esClaseComprable } from "../../catalogo/publico";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { huellaDeLaOrden, leerOrden, type OrdenPedida } from "../dominio/orden-de-compra";
import type { OrdenGuardada } from "../persistencia/repositorio-de-ordenes";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirTresVias } from "./nivel-tres-vias";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/** Lo que pide una orden: el contenido (`leerOrden`) más la clave del gesto. */
export type EntradaDeCrearOrden = Readonly<{
  clave: string;
  proveedorId: string;
  sucursalId?: string | null;
  entrega?: string | null;
  lineas: unknown;
}>;

export type SalidaDeCrearOrden = Readonly<{
  ordenId: string;
  /** `true`: la misma orden ya estaba creada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Lo que comparten crear y editar: el proveedor es un proveedor de la empresa, la sucursal (si se eligió) existe, está activa y en el alcance de quien pide, y cada producto
 * existe, está activo y es comprable. Sin sucursal elegida, la orden no tiene destino (nunca se asume «todas»). Los productos se bloquean en modo compartido.
 */
export async function comprobarContenido(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  orden: OrdenPedida,
): Promise<R<null>> {
  const { empresaId } = contexto;
  if (orden.sucursalId !== null) {
    const sucursal = sucursalId(orden.sucursalId);
    const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
    if (!alcance.ok) return alcance;
    const fila = await tx.sucursales.obtener(empresaId, sucursal);
    if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
    if (!fila.activa) return err("SUCURSAL_INACTIVA");
  }
  const proveedor = await directorio.parteParaOperacion(
    tx,
    empresaId,
    orden.proveedorId,
    "PROVEEDOR",
  );
  if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
  for (const l of orden.lineas) {
    const producto = await tx.productosParaCompras.bloquearCompartido(empresaId, l.productoId);
    if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
    if (!producto.activo || !esClaseComprable(producto.claseDeUso)) {
      return err("PRODUCTO_NO_COMPRABLE");
    }
  }
  return ok(null);
}

/**
 * Crear una orden de compra (N4, E9 §3.8): nace BORRADOR, sin número (se asigna al pedirla). Guard `ordenes_de_compra.crear` (gerente y administrador); la empresa tiene que
 * estar en N4 con la perilla de tres vías en el plan. Repetición: misma clave y mismo contenido devuelve lo hecho (`yaExistia`) sin escribir ni auditar; misma clave con otro
 * contenido, `CLAVE_REUTILIZADA`; dos pedidos iguales a la vez: gana uno y el otro ve su fila y repite.
 */
export function armarCrearOrden(dependencias: DependenciasDeCompras) {
  return async function crearOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearOrden,
  ): Promise<R<SalidaDeCrearOrden>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave)) return err("IDENTIFICADOR_INVALIDO");
    const leida = leerOrden(entrada);
    if (!leida.ok) return leida;
    const orden = leida.valor;
    const huella = huellaDeLaOrden(orden);

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCrearOrden>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "ordenes_de_compra.crear",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;
          const repetida = await repeticion(tx, empresaId, entrada.clave, huella);
          if (repetida !== null) return repetida;
          const contenido = await comprobarContenido(tx, contexto, orden);
          if (!contenido.ok) return contenido;

          const ordenId = await tx.ordenesDeCompra.insertar(empresaId, {
            proveedorId: orden.proveedorId,
            sucursalDestinoId: orden.sucursalId,
            entrega: orden.entrega,
            clave: entrada.clave,
            huella,
            creadoPor: persona,
          });
          if (ordenId === undefined) {
            // Perdió una carrera: otra transacción ya escribió la misma clave. Se vuelve a mirar (ya está confirmada su fila).
            const ganadora = await repeticion(tx, empresaId, entrada.clave, huella);
            if (ganadora !== null) return ganadora;
            throw new Error("la orden chocó con una restricción única que no es la clave");
          }
          await tx.ordenesDeCompra.insertarLineas(
            empresaId,
            ordenId,
            orden.lineas.map((l, i) => ({
              numero: i + 1,
              productoId: l.productoId,
              cantidadPedida: l.cantidad,
              precioUnitario: l.precio,
            })),
          );
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "ORDEN_DE_COMPRA_CREADA",
            entidad: "orden_de_compra",
            entidadId: ordenId,
            despues: {
              proveedorId: orden.proveedorId,
              sucursalId: orden.sucursalId,
              entrega: orden.entrega,
              estado: "BORRADOR",
              renglones: orden.lineas.length,
            },
          });
          return ok({ ordenId, yaExistia: false });
        },
      ),
    );
  };
}

/** ¿Ya estaba? Por la clave: misma huella, repetida; otra, reutilizada. `null` si es nueva. */
async function repeticion(
  tx: Pick<TxDeCompras, "ordenesDeCompra">,
  empresaId: ContextoOperativo["empresaId"],
  clave: string,
  huella: string,
): Promise<R<SalidaDeCrearOrden> | null> {
  const previa = await tx.ordenesDeCompra.porClave(empresaId, clave);
  if (previa === null) return null;
  if (decidirPorHuella(previa.huella, huella) !== "REPETIDA") return err("CLAVE_REUTILIZADA");
  return ok({ ordenId: previa.id, yaExistia: true });
}

export type EntradaDeEditarOrden = Readonly<{
  ordenId: string;
  /** La versión que la persona vio: si la orden ya cambió, `VERSION_DESACTUALIZADA`. */
  versionEsperada: number;
  proveedorId: string;
  sucursalId?: string | null;
  entrega?: string | null;
  lineas: unknown;
}>;

export type SalidaDeEditarOrden = Readonly<{
  version: number;
  /** `true`: la orden ya tenía ese contenido: no se escribió ni se auditó nada. */
  sinCambios: boolean;
}>;

/** ¿Lo pedido es lo que la orden ya tiene? Compara la cabecera y las líneas vivas (no retiradas) por producto. */
function esLoMismo(
  guardada: OrdenGuardada,
  lineas: readonly Readonly<{
    productoId: string;
    cantidadPedida: string;
    precioUnitario: string | null;
    retirada: boolean;
  }>[],
  orden: OrdenPedida,
): boolean {
  if (
    guardada.proveedorId !== orden.proveedorId ||
    guardada.sucursalDestinoId !== orden.sucursalId ||
    guardada.entrega !== orden.entrega
  ) {
    return false;
  }
  const vivas = lineas.filter((l) => !l.retirada);
  return (
    vivas.length === orden.lineas.length &&
    orden.lineas.every((pedida) =>
      vivas.some(
        (v) =>
          v.productoId === pedida.productoId &&
          v.cantidadPedida === pedida.cantidad &&
          v.precioUnitario === pedida.precio,
      ),
    )
  );
}

/**
 * Editar una orden que sigue BORRADOR: cambia el proveedor, la sucursal, la entrega y las líneas. Guard `ordenes_de_compra.crear` (editar es seguir creando). Una línea se
 * identifica por su producto: la que ya estaba cambia de cantidad y precio, la que no está entre las pedidas se retira (no se borra) y la nueva se agrega al final. Desde que
 * se pide, no se edita (`ORDEN_NO_ES_BORRADOR`). Si la orden ya tiene ese contenido no escribe (`sinCambios`); con otra versión y otro contenido, `VERSION_DESACTUALIZADA`.
 * La orden se bloquea: editar y pedir a la vez se serializan.
 */
export function armarEditarOrden(dependencias: DependenciasDeCompras) {
  return async function editarOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarOrden,
  ): Promise<R<SalidaDeEditarOrden>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.ordenId)) return err("ORDEN_NO_ENCONTRADA");
    const leida = leerOrden(entrada);
    if (!leida.ok) return leida;
    const orden = leida.valor;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeEditarOrden>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "ordenes_de_compra.crear",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;
          const guardada = await tx.ordenesDeCompra.bloquear(empresaId, entrada.ordenId);
          if (guardada === null) return err("ORDEN_NO_ENCONTRADA");
          if (guardada.estado !== "BORRADOR") return err("ORDEN_NO_ES_BORRADOR");
          const lineas = await tx.ordenesDeCompra.lineasDe(empresaId, guardada.id);
          if (esLoMismo(guardada, lineas, orden)) {
            return ok({ version: guardada.version, sinCambios: true });
          }
          if (guardada.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
          const contenido = await comprobarContenido(tx, contexto, orden);
          if (!contenido.ok) return contenido;

          const cambio = await tx.ordenesDeCompra.actualizarCabecera(
            empresaId,
            guardada.id,
            guardada.version,
            {
              proveedorId: orden.proveedorId,
              sucursalDestinoId: orden.sucursalId,
              entrega: orden.entrega,
            },
          );
          if (!cambio) throw new Error("la orden cambió de versión bajo bloqueo");
          const pedidos = new Map(orden.lineas.map((l) => [l.productoId, l]));
          const usados = new Set<string>();
          for (const existente of lineas.filter((l) => !l.retirada)) {
            const pedida = pedidos.get(existente.productoId);
            await tx.ordenesDeCompra.actualizarLinea(empresaId, guardada.id, existente.numero, {
              cantidadPedida: pedida?.cantidad ?? existente.cantidadPedida,
              precioUnitario: pedida === undefined ? existente.precioUnitario : pedida.precio,
              retirada: pedida === undefined,
            });
            if (pedida !== undefined) usados.add(existente.productoId);
          }
          let numero = lineas.reduce((mayor, l) => Math.max(mayor, l.numero), 0);
          await tx.ordenesDeCompra.insertarLineas(
            empresaId,
            guardada.id,
            orden.lineas
              .filter((l) => !usados.has(l.productoId))
              .map((l) => ({
                numero: ++numero,
                productoId: l.productoId,
                cantidadPedida: l.cantidad,
                precioUnitario: l.precio,
              })),
          );
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "ORDEN_DE_COMPRA_EDITADA",
            entidad: "orden_de_compra",
            entidadId: guardada.id,
            antes: {
              proveedorId: guardada.proveedorId,
              sucursalId: guardada.sucursalDestinoId,
              entrega: guardada.entrega,
              renglones: lineas.filter((l) => !l.retirada).length,
            },
            despues: {
              proveedorId: orden.proveedorId,
              sucursalId: orden.sucursalId,
              entrega: orden.entrega,
              renglones: orden.lineas.length,
            },
          });
          return ok({ version: guardada.version + 1, sinCambios: false });
        },
      ),
    );
  };
}
