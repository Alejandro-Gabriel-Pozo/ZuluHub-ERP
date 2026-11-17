import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { ocultoPor } from "../dominio/carta-publica";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, exigirSucursalAbierta, traducir } from "./comun";
import type { AlcanceDeExistencia, DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Dónde se oculta: en un local, o en toda la empresa. */
export type AlcanceDeOcultamiento =
  Readonly<{ tipo: "EMPRESA" }> | Readonly<{ tipo: "SUCURSAL"; sucursalId: string }>;

export type EntradaDeOcultarProducto = Readonly<{
  productoId: string;
  alcance: AlcanceDeOcultamiento;
  /** El ESTADO que se quiere (no alterna): `true` oculta, `false` vuelve a mostrar. */
  oculto: boolean;
}>;

export type SalidaDeOcultarProducto = Readonly<{
  /** `true` si ya estaba en ese estado: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
  /** Al mostrar en un local: `"EMPRESA"` si toda la empresa lo sigue ocultando (el local no puede mostrar lo que la empresa oculta). */
  sigueOcultoPor: "EMPRESA" | null;
}>;

/**
 * El botón «Ocultar» / «Volver a mostrar» (carta real §6.1 y §6.5). Fija un ESTADO por alcance: dos veces seguidas da el mismo resultado (la segunda es `yaEstaba`,
 * sin escribir ni auditar). Acción `vidrieras.marcar_disponibilidad` (los tres roles). EN UN LOCAL: el operador solo en SUS locales (alcance); gerente y
 * administrador en cualquiera; el local tiene que existir y estar abierto. EN TODA LA EMPRESA: alcance TODAS y, además, `vidrieras.editar` (que solo tienen gerente y
 * administrador): el operador no oculta lo de todos los locales (N-2, sin claves nuevas). Se toma el producto con `FOR UPDATE`: dos ocultar a la vez, o ocultar y
 * desactivar, se ponen en fila. OCULTAR escribe la fila y recién entonces pregunta a stock por el alcance (así, si stock suma existencia a la vez, ve la fila): con
 * existencia distinta de cero (también negativa) → `PRODUCTO_CON_EXISTENCIA`; con un conteo abierto con cargas → `PRODUCTO_CON_CONTEO_ABIERTO`; el error revierte
 * la fila y la auditoría. Un producto sin artículo de stock se oculta siempre. MOSTRAR no tiene condiciones. «Oculto» y «desactivado» son independientes.
 * Una cuenta abierta con el producto ya cargado se puede cobrar: eso lo respeta la cotización (T8), no esta acción. Auditoría: una entrada por cambio.
 */
export function armarOcultarProducto(dependencias: DependenciasDeCatalogo) {
  return async function ocultarProducto(
    contexto: ContextoOperativo,
    entrada: EntradaDeOcultarProducto,
  ): Promise<R<SalidaDeOcultarProducto>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeOcultarProducto>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "vidrieras.marcar_disponibilidad",
        ]);
        if (!permiso.ok) return permiso;
        if (entrada.alcance.tipo === "EMPRESA") {
          const soloDeGerencia = await exigirAcciones(
            dependencias.reglas,
            ["vidrieras.marcar_disponibilidad", "vidrieras.editar"],
            () => tx.autorizacion.delActor(contexto),
          );
          if (!soloDeGerencia.ok) return soloDeGerencia;
          const total = await exigirAlcanceTotal(tx, contexto);
          if (!total.ok) return total;
        } else {
          if (!esUuid(entrada.alcance.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
          const local = await exigirSucursalAbierta(
            tx,
            contexto,
            sucursalId(entrada.alcance.sucursalId),
          );
          if (!local.ok) return local;
        }
        if (!esUuid(entrada.productoId)) return err("PRODUCTO_NO_ENCONTRADO");
        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");

        const sucursal: SucursalId | null =
          entrada.alcance.tipo === "SUCURSAL" ? sucursalId(entrada.alcance.sucursalId) : null;
        const alcance: AlcanceDeExistencia =
          sucursal === null ? { tipo: "EMPRESA" } : { tipo: "SUCURSAL", sucursalId: sucursal };
        const actual = await tx.disponibilidadDeProductos.bloquear(
          empresaId,
          producto.id,
          sucursal,
        );
        const sigueOcultoPor = async () =>
          sucursal === null
            ? null
            : ocultoPor(
                  await tx.disponibilidadDeProductos.queAlcanzanAlLocal(
                    empresaId,
                    producto.id,
                    sucursal,
                  ),
                  sucursal,
                ) === "EMPRESA"
              ? ("EMPRESA" as const)
              : null;
        if ((actual?.oculto ?? false) === entrada.oculto)
          return ok({ yaEstaba: true, sigueOcultoPor: await sigueOcultoPor() });

        const fijada = await tx.disponibilidadDeProductos.fijar(empresaId, {
          productoId: producto.id,
          sucursalId: sucursal,
          oculto: entrada.oculto,
          actualizadoPor: contexto.personaId,
          actualizadoEn: contexto.ahora,
        });
        if (entrada.oculto) {
          if (await dependencias.existencias.conExistencia(tx, contexto, producto.id, alcance))
            return err("PRODUCTO_CON_EXISTENCIA");
          if (
            await dependencias.existencias.conConteoAbiertoConCargas(
              tx,
              contexto,
              producto.id,
              alcance,
            )
          )
            return err("PRODUCTO_CON_CONTEO_ABIERTO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: entrada.oculto ? "PRODUCTO_OCULTADO" : "PRODUCTO_MOSTRADO",
          entidad: "producto",
          entidadId: producto.id,
          antes: { oculto: actual?.oculto ?? false, alcance: alcance.tipo, sucursalId: sucursal },
          despues: { oculto: fijada.oculto, alcance: alcance.tipo, sucursalId: sucursal },
        });
        return ok({ yaEstaba: false, sigueOcultoPor: await sigueOcultoPor() });
      },
    );
    return traducir(resultado);
  };
}
