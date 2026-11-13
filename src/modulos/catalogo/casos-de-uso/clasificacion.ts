import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  puedeCrearBajo,
  puedeDesactivar,
  puedeMover,
  puedeReactivar,
  type ArbolDeClasificacion,
} from "../../../primitivas/clasificacion/arbol";
import { nombreDeNodoDesdeTexto } from "../../../primitivas/clasificacion/nombre-de-nodo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { esUuid } from "../dominio/identificadores";
import type { NodoGuardado } from "../persistencia/repositorio-de-clasificacion";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo, TxDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCrearNodo = Readonly<{
  /** Lo manda la aplicación: es la idempotencia del alta. */
  id: string;
  /** `null` = un departamento (primer nivel). */
  padreId: string | null;
  nombre: string;
}>;
export type SalidaDeCrearNodo = Readonly<{ nodoId: string; yaExistia: boolean }>;
export type EntradaDeRenombrarNodo = Readonly<{
  nodoId: string;
  versionEsperada: number;
  nombre: string;
}>;
export type SalidaDeRenombrarNodo = Readonly<{ version: number }>;
export type EntradaDeMoverNodo = Readonly<{
  nodoId: string;
  versionEsperada: number;
  nuevoPadreId: string;
}>;
export type SalidaDeMoverNodo = Readonly<{ version: number; yaEstaba: boolean }>;
export type EntradaDeCambiarActivoDeNodo = Readonly<{ nodoId: string }>;
export type SalidaDeCambiarActivoDeNodo = Readonly<{ yaEstaba: boolean }>;

/**
 * Clasificación comercial (departamento → categoría → …; A2b, plan aprobado el 12/11/2026): acción `productos.editar` con alcance TODAS, como las secciones de la
 * carta (decisión del dueño). Toda escritura toma primero el candado del árbol de la empresa y decide leyendo el árbol que dejó la anterior: las reglas (sin ciclos, tope
 * de niveles, un departamento no se mueve, nada vivo debajo de algo desactivado) son las de la primitiva `arbol.ts`; la base las repite como defensa en profundidad.
 * Repetir cada comando no duplica ni vuelve a auditar: crear con el mismo id devuelve lo existente (con otro contenido, `ID_REUTILIZADO`); renombrar con el mismo
 * nombre y mover al padre que ya tiene devuelven lo vigente; desactivar y reactivar dicen `yaEstaba`. Mover y renombrar llevan la versión del nodo.
 */

const arbolDe = (nodos: readonly NodoGuardado[]): ArbolDeClasificacion =>
  new Map(nodos.map((n) => [n.id, { id: n.id, padreId: n.padreId, activo: n.activo }]));

/**
 * Las cinco escrituras corren en READ COMMITTED a propósito: serializadas por el candado del árbol, cada lectura posterior al candado tiene que ver lo último
 * confirmado. Con una foto fija (serializable o repetible) el segundo pedido decidiría sobre el árbol que había ANTES de esperar el candado (la prueba de dos altas a
 * la vez lo mostró: la segunda no veía el nodo recién creado y fallaba como «id reutilizado»). La seguridad no depende del aislamiento: la base impone las reglas con
 * el mismo candado.
 */
const OPCIONES_DE_ESCRITURA = (contexto: ContextoOperativo) =>
  ({ contexto, aislamiento: "read committed" }) as const;

/** Paso común de todo comando: permiso, alcance sobre toda la empresa y el candado del árbol. */
async function empezar(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCatalogo,
): Promise<R<null>> {
  const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
  if (!permiso.ok) return permiso;
  const alcance = await exigirAlcanceTotal(tx, contexto);
  if (!alcance.ok) return alcance;
  await tx.clasificacion.bloquearArbol(contexto.empresaId);
  return ok(null);
}

export function armarCrearNodoDeClasificacion(dependencias: DependenciasDeCatalogo) {
  return async function crearNodoDeClasificacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearNodo,
  ): Promise<R<SalidaDeCrearNodo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      OPCIONES_DE_ESCRITURA(contexto),
      async (tx): Promise<R<SalidaDeCrearNodo>> => {
        const inicio = await empezar(tx, contexto, dependencias);
        if (!inicio.ok) return inicio;
        if (!esUuid(entrada.id) || (entrada.padreId !== null && !esUuid(entrada.padreId))) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const nombre = nombreDeNodoDesdeTexto(entrada.nombre);
        if (!nombre.ok) return err("NOMBRE_DE_NODO_INVALIDO");
        const clave = claveDeNombre(nombre.valor);
        const nodos = await tx.clasificacion.todos(empresaId);
        const existente = nodos.find((n) => n.id === entrada.id);
        if (existente !== undefined) {
          const igual = existente.padreId === entrada.padreId && existente.nombreClave === clave;
          return igual ? ok({ nodoId: existente.id, yaExistia: true }) : err("ID_REUTILIZADO");
        }
        const puede = puedeCrearBajo(arbolDe(nodos), entrada.padreId);
        if (!puede.ok) return puede;
        const creado = await tx.clasificacion.insertar(empresaId, {
          id: entrada.id,
          padreId: entrada.padreId,
          nombre: nombre.valor,
          nombreClave: clave,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "CLASIFICACION_NODO_CREADO",
          entidad: "nodo_de_clasificacion",
          entidadId: creado.id,
          despues: { nombre: creado.nombre, padreId: creado.padreId },
        });
        return ok({ nodoId: creado.id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

export function armarRenombrarNodoDeClasificacion(dependencias: DependenciasDeCatalogo) {
  return async function renombrarNodoDeClasificacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeRenombrarNodo,
  ): Promise<R<SalidaDeRenombrarNodo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      OPCIONES_DE_ESCRITURA(contexto),
      async (tx): Promise<R<SalidaDeRenombrarNodo>> => {
        const inicio = await empezar(tx, contexto, dependencias);
        if (!inicio.ok) return inicio;
        const nombre = nombreDeNodoDesdeTexto(entrada.nombre);
        if (!nombre.ok) return err("NOMBRE_DE_NODO_INVALIDO");
        const actual = await tx.clasificacion.obtener(empresaId, entrada.nodoId);
        if (actual === null) return err("NODO_INEXISTENTE");
        if (actual.nombre === nombre.valor) return ok({ version: actual.version });
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
        const editado = await tx.clasificacion.cambiar(empresaId, actual.id, actual.version, {
          nombre: nombre.valor,
          nombreClave: claveDeNombre(nombre.valor),
        });
        if (editado === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "CLASIFICACION_NODO_RENOMBRADO",
          entidad: "nodo_de_clasificacion",
          entidadId: actual.id,
          antes: { nombre: actual.nombre },
          despues: { nombre: editado.nombre },
        });
        return ok({ version: editado.version });
      },
    );
    return traducir(resultado);
  };
}

export function armarMoverNodoDeClasificacion(dependencias: DependenciasDeCatalogo) {
  return async function moverNodoDeClasificacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeMoverNodo,
  ): Promise<R<SalidaDeMoverNodo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      OPCIONES_DE_ESCRITURA(contexto),
      async (tx): Promise<R<SalidaDeMoverNodo>> => {
        const inicio = await empezar(tx, contexto, dependencias);
        if (!inicio.ok) return inicio;
        if (!esUuid(entrada.nodoId) || !esUuid(entrada.nuevoPadreId)) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const nodos = await tx.clasificacion.todos(empresaId);
        const actual = nodos.find((n) => n.id === entrada.nodoId);
        if (actual === undefined) return err("NODO_INEXISTENTE");
        if (actual.padreId === entrada.nuevoPadreId) {
          return ok({ version: actual.version, yaEstaba: true });
        }
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
        const puede = puedeMover(arbolDe(nodos), actual.id, entrada.nuevoPadreId);
        if (!puede.ok) return puede;
        const movido = await tx.clasificacion.cambiar(empresaId, actual.id, actual.version, {
          padreId: entrada.nuevoPadreId,
        });
        if (movido === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "CLASIFICACION_NODO_MOVIDO",
          entidad: "nodo_de_clasificacion",
          entidadId: actual.id,
          antes: { padreId: actual.padreId },
          despues: { padreId: movido.padreId },
        });
        return ok({ version: movido.version, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/** Desactivar y reactivar son el mismo comando con distinta regla: se arma una sola vez y cada uno trae la suya y su acción de auditoría. */
function armarCambioDeActivo(
  dependencias: DependenciasDeCatalogo,
  activo: boolean,
  regla: (arbol: ArbolDeClasificacion, id: string) => Resultado<null, ErrorDeCatalogo>,
  accion: string,
) {
  return async function cambiarActivo(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarActivoDeNodo,
  ): Promise<R<SalidaDeCambiarActivoDeNodo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      OPCIONES_DE_ESCRITURA(contexto),
      async (tx): Promise<R<SalidaDeCambiarActivoDeNodo>> => {
        const inicio = await empezar(tx, contexto, dependencias);
        if (!inicio.ok) return inicio;
        const nodos = await tx.clasificacion.todos(empresaId);
        const actual = nodos.find((n) => n.id === entrada.nodoId);
        if (actual === undefined) return err("NODO_INEXISTENTE");
        if (actual.activo === activo) return ok({ yaEstaba: true });
        const puede = regla(arbolDe(nodos), actual.id);
        if (!puede.ok) return puede;
        const cambiado = await tx.clasificacion.cambiar(empresaId, actual.id, actual.version, {
          activo,
        });
        if (cambiado === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion,
          entidad: "nodo_de_clasificacion",
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

export const armarDesactivarNodoDeClasificacion = (dependencias: DependenciasDeCatalogo) =>
  armarCambioDeActivo(dependencias, false, puedeDesactivar, "CLASIFICACION_NODO_DESACTIVADO");

export const armarReactivarNodoDeClasificacion = (dependencias: DependenciasDeCatalogo) =>
  armarCambioDeActivo(dependencias, true, puedeReactivar, "CLASIFICACION_NODO_REACTIVADO");
