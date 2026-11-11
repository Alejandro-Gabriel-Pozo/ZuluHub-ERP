import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { nombreDeEleccionDesdeTexto } from "../../../primitivas/texto/nombre-de-eleccion";
import { esUuid, seccionDeCartaId, type SeccionDeCartaId } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

const MAXIMO_DEL_ORDEN = 100_000;
const ordenValido = (orden: number) =>
  Number.isInteger(orden) && orden >= 0 && orden <= MAXIMO_DEL_ORDEN;

export type EntradaDeCrearSeccion = Readonly<{ id: string; nombre: string; orden: number }>;
export type SalidaDeCrearSeccion = Readonly<{ seccionId: SeccionDeCartaId; yaExistia: boolean }>;
export type EntradaDeEditarSeccion = Readonly<{
  seccionId: string;
  versionEsperada: number;
  nombre: string;
  orden: number;
}>;
export type SalidaDeEditarSeccion = Readonly<{ version: number }>;
export type EntradaDeDesactivarSeccion = Readonly<{ seccionId: string }>;
export type SalidaDeDesactivarSeccion = Readonly<{ yaEstaba: boolean }>;

/**
 * Secciones de la carta (E2 mínimo §3.5): la lista de la empresa; el producto elige una. Acción `productos.editar` con alcance TODAS
 * (SUPUESTO (DEC-0071) S10: ninguna pantalla aprobada las crea; pregunta Q5). Crear: el `id` lo manda la aplicación (idempotencia); el nombre es único
 * por empresa (por clave). Editar: control de versión; repetir lo ya aplicado devuelve lo vigente. Desactivar no toca los productos que
 * la usan: siguen apuntando a ella.
 */
export function armarCrearSeccionDeCarta(dependencias: DependenciasDeCatalogo) {
  return async function crearSeccionDeCarta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearSeccion,
  ): Promise<R<SalidaDeCrearSeccion>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCrearSeccion>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.id)) return err("IDENTIFICADOR_INVALIDO");
        const nombre = nombreDeEleccionDesdeTexto(entrada.nombre);
        if (!nombre.ok) return err("NOMBRE_DE_SECCION_INVALIDO");
        if (!ordenValido(entrada.orden)) return err("ORDEN_INVALIDO");
        const id = seccionDeCartaId(entrada.id);
        const clave = claveDeNombre(nombre.valor);
        const insertada = await tx.productos.insertarSeccion(
          empresaId,
          id,
          nombre.valor,
          clave,
          entrada.orden,
        );
        if (!insertada) {
          const guardada = await tx.productos.obtenerSeccion(empresaId, id);
          const igual =
            guardada !== null &&
            claveDeNombre(guardada.nombre) === clave &&
            guardada.orden === entrada.orden;
          return igual ? ok({ seccionId: id, yaExistia: true }) : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SECCION_DE_CARTA_CREADA",
          entidad: "seccion_de_carta",
          entidadId: id,
          despues: { nombre: nombre.valor, orden: entrada.orden },
        });
        return ok({ seccionId: id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

export function armarEditarSeccionDeCarta(dependencias: DependenciasDeCatalogo) {
  return async function editarSeccionDeCarta(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarSeccion,
  ): Promise<R<SalidaDeEditarSeccion>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarSeccion>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const nombre = nombreDeEleccionDesdeTexto(entrada.nombre);
        if (!nombre.ok) return err("NOMBRE_DE_SECCION_INVALIDO");
        if (!ordenValido(entrada.orden)) return err("ORDEN_INVALIDO");
        const actual = await tx.productos.obtenerSeccion(empresaId, entrada.seccionId);
        if (actual === null) return err("SECCION_NO_ENCONTRADA");
        if (actual.nombre === nombre.valor && actual.orden === entrada.orden)
          return ok({ version: actual.version });
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
        const editada = await tx.productos.actualizarSeccion(empresaId, actual.id, actual.version, {
          nombre: nombre.valor,
          nombreClave: claveDeNombre(nombre.valor),
          orden: entrada.orden,
        });
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SECCION_DE_CARTA_EDITADA",
          entidad: "seccion_de_carta",
          entidadId: actual.id,
          antes: { nombre: actual.nombre, orden: actual.orden },
          despues: { nombre: editada.nombre, orden: editada.orden },
        });
        return ok({ version: editada.version });
      },
    );
    return traducir(resultado);
  };
}

export function armarDesactivarSeccionDeCarta(dependencias: DependenciasDeCatalogo) {
  return async function desactivarSeccionDeCarta(
    contexto: ContextoOperativo,
    entrada: EntradaDeDesactivarSeccion,
  ): Promise<R<SalidaDeDesactivarSeccion>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDesactivarSeccion>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const actual = await tx.productos.obtenerSeccion(empresaId, entrada.seccionId);
        if (actual === null) return err("SECCION_NO_ENCONTRADA");
        if (!actual.activa) return ok({ yaEstaba: true });
        await tx.productos.desactivarSeccion(empresaId, actual.id);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SECCION_DE_CARTA_DESACTIVADA",
          entidad: "seccion_de_carta",
          entidadId: actual.id,
          antes: { activa: true },
          despues: { activa: false },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
