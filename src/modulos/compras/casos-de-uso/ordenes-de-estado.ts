import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirTresVias } from "./nivel-tres-vias";
import { comprobarContenido } from "./ordenes";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDePedirOrden = Readonly<{ ordenId: string }>;
export type SalidaDePedirOrden = Readonly<{
  numero: number;
  /** `true`: la orden ya estaba pedida: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}>;

/**
 * Pedir una orden (N4): del BORRADOR a PEDIDA; la base le asigna el número y el momento, y abre el saldo de cada línea. Guard `ordenes_de_compra.pedir` (gerente y
 * administrador). Es un compromiso nuevo con el proveedor: pide N4 y la perilla como crear, y vuelve a comprobar que el proveedor, la sucursal y los productos sigan siendo
 * válidos (pudieron desactivarse desde el borrador). Una ya pedida devuelve su número (`yaEstaba`) sin escribir; una cerrada o anulada, `ORDEN_NO_ES_BORRADOR`. La orden se
 * bloquea: pedir, editar y anular a la vez se serializan.
 */
export function armarPedirOrden(dependencias: DependenciasDeCompras) {
  return async function pedirOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDePedirOrden,
  ): Promise<R<SalidaDePedirOrden>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.ordenId)) return err("ORDEN_NO_ENCONTRADA");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDePedirOrden>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "ordenes_de_compra.pedir",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;
          const guardada = await tx.ordenesDeCompra.bloquear(empresaId, entrada.ordenId);
          if (guardada === null) return err("ORDEN_NO_ENCONTRADA");
          if (guardada.estado === "PEDIDA" && guardada.numero !== null) {
            return ok({ numero: guardada.numero, yaEstaba: true });
          }
          if (guardada.estado !== "BORRADOR") return err("ORDEN_NO_ES_BORRADOR");
          const lineas = (await tx.ordenesDeCompra.lineasDe(empresaId, guardada.id)).filter(
            (l) => !l.retirada,
          );
          const contenido = await comprobarContenido(tx, contexto, {
            proveedorId: guardada.proveedorId,
            sucursalId: guardada.sucursalDestinoId,
            entrega: guardada.entrega,
            lineas: lineas.map((l) => ({
              productoId: l.productoId,
              cantidad: l.cantidadPedida,
              precio: l.precioUnitario,
            })),
          });
          if (!contenido.ok) return contenido;
          await tx.ordenesDeCompra.cambiarEstado(empresaId, guardada.id, {
            estado: "PEDIDA",
            por: persona,
          });
          const pedida = await tx.ordenesDeCompra.obtener(empresaId, guardada.id);
          if (pedida === null || pedida.numero === null) {
            throw new Error("la orden pedida no quedó con número");
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "ORDEN_DE_COMPRA_PEDIDA",
            entidad: "orden_de_compra",
            entidadId: guardada.id,
            antes: { estado: "BORRADOR" },
            despues: { estado: "PEDIDA", numero: pedida.numero, renglones: lineas.length },
          });
          return ok({ numero: pedida.numero, yaEstaba: false });
        },
      ),
    );
  };
}

export type EntradaDeCerrarOrden = Readonly<{ ordenId: string }>;
export type SalidaDeCerrarOrden = Readonly<{
  /** `COMPLETA` si todas las líneas llegaron a lo pedido; `CON_SALDO` si quedó algo sin recibir (lo decide la base). */
  motivo: "COMPLETA" | "CON_SALDO";
  /** `true`: la orden ya estaba cerrada: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}>;

/**
 * Cerrar una orden pedida (N4): deja de esperar mercadería, con lo que falte («con saldo») o sin faltante. Guard `ordenes_de_compra.cerrar` (gerente y administrador). Completa
 * lo iniciado: no pide la perilla. Una ya cerrada devuelve su motivo (`yaEstaba`) sin escribir; una que no está pedida (borrador o anulada), `ORDEN_NO_ESTA_PEDIDA`.
 */
export function armarCerrarOrden(dependencias: DependenciasDeCompras) {
  return async function cerrarOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarOrden,
  ): Promise<R<SalidaDeCerrarOrden>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.ordenId)) return err("ORDEN_NO_ENCONTRADA");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCerrarOrden>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "ordenes_de_compra.cerrar",
          ]);
          if (!permiso.ok) return permiso;
          const guardada = await tx.ordenesDeCompra.bloquear(empresaId, entrada.ordenId);
          if (guardada === null) return err("ORDEN_NO_ENCONTRADA");
          if (guardada.estado === "CERRADA" && guardada.cierreMotivo !== null) {
            return ok({ motivo: guardada.cierreMotivo, yaEstaba: true });
          }
          if (guardada.estado !== "PEDIDA") return err("ORDEN_NO_ESTA_PEDIDA");
          await tx.ordenesDeCompra.cambiarEstado(empresaId, guardada.id, {
            estado: "CERRADA",
            por: persona,
          });
          const cerrada = await tx.ordenesDeCompra.obtener(empresaId, guardada.id);
          if (cerrada === null || cerrada.cierreMotivo === null) {
            throw new Error("la orden cerrada no quedó con motivo de cierre");
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "ORDEN_DE_COMPRA_CERRADA",
            entidad: "orden_de_compra",
            entidadId: guardada.id,
            antes: { estado: "PEDIDA" },
            despues: { estado: "CERRADA", motivo: cerrada.cierreMotivo },
          });
          return ok({ motivo: cerrada.cierreMotivo, yaEstaba: false });
        },
      ),
    );
  };
}

export type EntradaDeAnularOrden = Readonly<{ ordenId: string; motivo: string }>;

/**
 * Anular una orden (N4), borrador o pedida, con motivo: queda con quién y cuándo y nada se borra. Guard `ordenes_de_compra.anular` (gerente y administrador). Completa lo
 * iniciado: no pide la perilla. FALLA CERRADO si la orden tiene recepciones vigentes (`ORDEN_CON_RECEPCIONES`: primero se anulan; lo impone la base). Una ya anulada no escribe
 * (`yaEstaba`); una cerrada, `ORDEN_YA_CERRADA`.
 */
export function armarAnularOrden(dependencias: DependenciasDeCompras) {
  return async function anularOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularOrden,
  ): Promise<R<Readonly<{ yaEstaba: boolean }>>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.ordenId)) return err("ORDEN_NO_ENCONTRADA");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<Readonly<{ yaEstaba: boolean }>>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "ordenes_de_compra.anular",
          ]);
          if (!permiso.ok) return permiso;
          const guardada = await tx.ordenesDeCompra.bloquear(empresaId, entrada.ordenId);
          if (guardada === null) return err("ORDEN_NO_ENCONTRADA");
          if (guardada.estado === "ANULADA") return ok({ yaEstaba: true });
          if (guardada.estado === "CERRADA") return err("ORDEN_YA_CERRADA");
          await tx.ordenesDeCompra.cambiarEstado(empresaId, guardada.id, {
            estado: "ANULADA",
            por: persona,
            motivo: motivo.valor,
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "ORDEN_DE_COMPRA_ANULADA",
            entidad: "orden_de_compra",
            entidadId: guardada.id,
            antes: { estado: guardada.estado },
            despues: { estado: "ANULADA", motivo: motivo.valor },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
