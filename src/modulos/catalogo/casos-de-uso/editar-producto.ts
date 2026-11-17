import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import type { Producto } from "../dominio/modelo";
import { validarFicha, type EntradaDeFicha, type FichaValida } from "../dominio/producto";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/**
 * Clase, unidad base, tipo y forma de venta NO se editan acá (la forma tiene su comando: `cambiarFormaDeVenta`). EDICIÓN PARCIAL (decisión del 13/11/2026): un campo AUSENTE
 * (`undefined`) NO se toca y conserva lo guardado; `null` o un texto vacío lo BORRA (el nombre, que es obligatorio, no se puede borrar: ausente lo conserva). Previene que una pantalla que
 * olvide mandar un campo guardado lo borre en silencio.
 */
export type EntradaDeEditarProducto = Readonly<
  { productoId: string; versionEsperada: number; nombre?: string | undefined } & Omit<
    EntradaDeFicha,
    "nombre"
  >
>;
export type SalidaDeEditarProducto = Readonly<{ version: number }>;
export type EntradaDeCambiarActivo = Readonly<{ productoId: string }>;
export type SalidaDeCambiarActivo = Readonly<{ yaEstaba: boolean }>;

const FICHA = (p: Producto): Omit<FichaValida, "nombreClave"> => ({
  nombre: p.nombre,
  nombreDeCocina: p.nombreDeCocina,
  descripcionEnCarta: p.descripcionEnCarta,
  codigo: p.codigo,
  codigoDeBarras: p.codigoDeBarras,
  alicuota: p.alicuota,
  seccionDeCartaId: p.seccionDeCartaId,
});

/** La ficha que se valida: lo pedido, y de lo ausente (`undefined`), lo guardado. `null` y vacío pasan tal cual (borran). */
function fusionarConLoGuardado(actual: Producto, e: EntradaDeEditarProducto): EntradaDeFicha {
  const base = FICHA(actual);
  return {
    nombre: e.nombre === undefined ? base.nombre : e.nombre,
    nombreDeCocina: e.nombreDeCocina === undefined ? base.nombreDeCocina : e.nombreDeCocina,
    descripcionEnCarta:
      e.descripcionEnCarta === undefined ? base.descripcionEnCarta : e.descripcionEnCarta,
    codigo: e.codigo === undefined ? base.codigo : e.codigo,
    codigoDeBarras: e.codigoDeBarras === undefined ? base.codigoDeBarras : e.codigoDeBarras,
    alicuota: e.alicuota === undefined ? base.alicuota : e.alicuota,
    seccionDeCartaId: e.seccionDeCartaId === undefined ? base.seccionDeCartaId : e.seccionDeCartaId,
  };
}

/** Solo lo que cambia, antes y después (la auditoría no guarda lo que no se tocó). */
function diferencias(
  antes: Omit<FichaValida, "nombreClave">,
  despues: Omit<FichaValida, "nombreClave">,
) {
  const a: Record<string, string | null> = {};
  const d: Record<string, string | null> = {};
  for (const campo of Object.keys(antes) as Array<keyof typeof antes>) {
    if (antes[campo] !== despues[campo]) {
      a[campo] = antes[campo];
      d[campo] = despues[campo];
    }
  }
  return { antes: a, despues: d };
}

/**
 * Editar la ficha (§3.5). Guard `productos.editar` con alcance TODAS; el producto se bloquea (`FOR UPDATE`); existe, está activo, la ficha
 * es válida para su clase (con alícuota si vende). Repetición (`SIN_CAMBIOS`): si lo pedido ya es lo guardado devuelve lo vigente sin
 * escribir ni auditar aunque la versión esperada sea vieja, así un reintento tras un éxito no falla. Si no, compara `versionEsperada`
 * (`VERSION_DESACTUALIZADA`), guarda, apaga «Falta completar» y audita `PRODUCTO_EDITADO`.
 */
export function armarEditarProducto(dependencias: DependenciasDeCatalogo) {
  return async function editarProducto(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarProducto,
  ): Promise<R<SalidaDeEditarProducto>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarProducto>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const actual = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (actual === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!actual.activo) return err("PRODUCTO_INACTIVO");
        const ficha = validarFicha(actual.claseDeUso, fusionarConLoGuardado(actual, entrada), true);
        if (!ficha.ok) return ficha;
        const seccion = ficha.valor.seccionDeCartaId;
        if (seccion !== null && seccion !== actual.seccionDeCartaId) {
          const encontrada = await tx.productos.obtenerSeccion(empresaId, seccion);
          if (encontrada === null || !encontrada.activa) return err("SECCION_NO_ENCONTRADA");
        }
        const { antes, despues } = diferencias(FICHA(actual), ficha.valor);
        if (Object.keys(despues).length === 0 && !actual.faltaCompletar)
          return ok({ version: actual.version });
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
        const editado = await tx.productos.actualizarFicha(
          empresaId,
          actual.id,
          actual.version,
          ficha.valor,
        );
        if (editado === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRODUCTO_EDITADO",
          entidad: "producto",
          entidadId: actual.id,
          antes: { ...antes, ...(actual.faltaCompletar ? { faltaCompletar: true } : {}) },
          despues: { ...despues, ...(actual.faltaCompletar ? { faltaCompletar: false } : {}) },
        });
        return ok({ version: editado.version });
      },
    );
    return traducir(resultado);
  };
}

function armarCambiarActivo(dependencias: DependenciasDeCatalogo, activo: boolean) {
  const accion = activo ? "productos.reactivar" : "productos.desactivar";
  return async function cambiarActivo(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarActivo,
  ): Promise<R<SalidaDeCambiarActivo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarActivo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [accion]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.productoId)) return err("PRODUCTO_NO_ENCONTRADO");
        const actual = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (actual === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (actual.activo === activo) return ok({ yaEstaba: true });
        // Desactivar (N-4 de la carta real, cambio de comportamiento de una acción que ya estaba): con existencia distinta de cero o con un conteo abierto con cargas,
        // no. Primero se toma el producto (arriba), así no se cruza con ocultar ni con otro desactivar. Reactivar no tiene condiciones.
        if (!activo) {
          const toda = { tipo: "EMPRESA" } as const;
          if (await dependencias.existencias.conExistencia(tx, contexto, actual.id, toda))
            return err("PRODUCTO_CON_EXISTENCIA");
          if (
            await dependencias.existencias.conConteoAbiertoConCargas(tx, contexto, actual.id, toda)
          )
            return err("PRODUCTO_CON_CONTEO_ABIERTO");
        }
        await tx.productos.cambiarActivo(empresaId, actual.id, activo);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: activo ? "PRODUCTO_REACTIVADO" : "PRODUCTO_DESACTIVADO",
          entidad: "producto",
          entidadId: actual.id,
          antes: { activo: !activo },
          despues: { activo },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/** Desactivar: cambia `activo`; las ventas anteriores no cambian y no se tocan precios ni opciones. Repetir: `YA_ESTABA`. */
export const armarDesactivarProducto = (d: DependenciasDeCatalogo) => armarCambiarActivo(d, false);
/** Reactivar: `YA_ESTABA` si ya estaba activo. */
export const armarReactivarProducto = (d: DependenciasDeCatalogo) => armarCambiarActivo(d, true);
