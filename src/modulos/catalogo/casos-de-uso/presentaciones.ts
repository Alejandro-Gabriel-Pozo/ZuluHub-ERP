import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esClaseComprable } from "../dominio/clase-comprable";
import { datosDePresentacion, nombreDePresentacionDesdeTexto } from "../dominio/presentaciones";
import type { PresentacionGuardada } from "../persistencia/repositorio-de-presentaciones";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCrearPresentacion = Readonly<{
  productoId: string;
  nombre: string;
  /** Texto decimal en la unidad base del producto (con peso variable, el peso aproximado). */
  cantidad: string;
  dePesoVariable: boolean;
}>;
export type SalidaDeCrearPresentacion = Readonly<{
  presentacion: PresentacionGuardada;
  yaExistia: boolean;
}>;

/**
 * Crear una presentación de un producto (E9 §3.2; X5 y D131: dato del PRODUCTO, parte de «Cómo se compra» de su ficha; usa la acción que ya existe
 * `productos.editar`, con alcance TODAS porque afecta a toda la empresa). Solo de lo que se compra (materia prima, insumo, reventa) y activo.
 * Repetición (`YA_ESTABA`): el mismo nombre con la misma cantidad y el mismo peso variable devuelve la existente (`yaExistia`); el mismo nombre con
 * otra cantidad es `PRESENTACION_REPETIDA` («otra cantidad es otra presentación»).
 */
export function armarCrearPresentacion(dependencias: DependenciasDeCatalogo) {
  return async function crearPresentacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearPresentacion,
  ): Promise<R<SalidaDeCrearPresentacion>> {
    const { empresaId } = contexto;
    const datos = datosDePresentacion(entrada);
    if (!datos.ok) return datos;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCrearPresentacion>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
          if (!permiso.ok) return permiso;
          const alcance = await exigirAlcanceTotal(tx, contexto);
          if (!alcance.ok) return alcance;
          const producto = await tx.productos.obtener(empresaId, entrada.productoId);
          if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
          if (!producto.activo || !esClaseComprable(producto.claseDeUso)) {
            return err("PRODUCTO_NO_COMPRABLE");
          }
          const existente = await tx.presentacionesDeProducto.porNombre(
            empresaId,
            producto.id,
            datos.valor.nombreClave,
          );
          if (existente !== null) {
            return existente.cantidad === datos.valor.cantidad &&
              existente.dePesoVariable === datos.valor.dePesoVariable
              ? ok({ presentacion: existente, yaExistia: true })
              : err("PRESENTACION_REPETIDA");
          }
          const presentacion = await tx.presentacionesDeProducto.insertar(empresaId, {
            productoId: producto.id,
            nombre: datos.valor.nombre,
            nombreClave: datos.valor.nombreClave,
            cantidad: datos.valor.cantidad,
            dePesoVariable: datos.valor.dePesoVariable,
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "PRESENTACION_CREADA",
            entidad: "presentacion_de_producto",
            entidadId: presentacion.id,
            despues: {
              productoId: producto.id,
              nombre: presentacion.nombre,
              cantidad: presentacion.cantidad,
              dePesoVariable: presentacion.dePesoVariable,
            },
          });
          return ok({ presentacion, yaExistia: false });
        },
      ),
    );
  };
}

export type EntradaDeEditarPresentacion = Readonly<{
  presentacionId: string;
  nombre: string;
  activa: boolean;
  versionEsperada: number;
}>;

/**
 * Renombrar o apagar una presentación (la cantidad no cambia: otra cantidad es otra presentación). Guard `productos.editar`; la presentación se bloquea.
 * Repetición (`SIN_CAMBIOS`): pedir lo que ya tiene devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar. Lo ya comprado no
 * cambia: las líneas de compra guardan sus números, no el nombre.
 */
export function armarEditarPresentacion(dependencias: DependenciasDeCatalogo) {
  return async function editarPresentacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarPresentacion,
  ): Promise<R<PresentacionGuardada>> {
    const { empresaId } = contexto;
    const nombre = nombreDePresentacionDesdeTexto(entrada.nombre);
    if (!nombre.ok) return nombre;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<PresentacionGuardada>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
          if (!permiso.ok) return permiso;
          const alcance = await exigirAlcanceTotal(tx, contexto);
          if (!alcance.ok) return alcance;
          const actual = await tx.presentacionesDeProducto.bloquear(
            empresaId,
            entrada.presentacionId,
          );
          if (actual === null) return err("PRESENTACION_NO_ENCONTRADA");
          if (actual.nombre === nombre.valor.nombre && actual.activa === entrada.activa) {
            return ok(actual);
          }
          if (actual.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
          const otra = await tx.presentacionesDeProducto.porNombre(
            empresaId,
            actual.productoId,
            nombre.valor.nombreClave,
          );
          if (otra !== null && otra.id !== actual.id) return err("PRESENTACION_REPETIDA");
          const editada = await tx.presentacionesDeProducto.actualizar(
            empresaId,
            actual.id,
            actual.version,
            {
              nombre: nombre.valor.nombre,
              nombreClave: nombre.valor.nombreClave,
              activa: entrada.activa,
            },
          );
          if (editada === null) return err("VERSION_DESACTUALIZADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "PRESENTACION_EDITADA",
            entidad: "presentacion_de_producto",
            entidadId: actual.id,
            antes: { nombre: actual.nombre, activa: actual.activa },
            despues: { nombre: editada.nombre, activa: editada.activa },
          });
          return ok(editada);
        },
      ),
    );
  };
}
