import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { nombreDeEleccionDesdeTexto } from "../../../primitivas/texto/nombre-de-eleccion";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { esUuid } from "../persistencia/filas";
import { esUsoDeDeposito, type Deposito } from "../persistencia/modelo";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeCrearDeposito = Readonly<{
  /** Lo manda la pantalla (idempotencia del alta). */
  id: string;
  sucursalId: string;
  nombre: string;
  /** `NORMAL`, `CUARENTENA` o `RECHAZO`: no cambia después del alta. */
  uso: string;
  /** El depósito del que sale lo que se vende: uno solo por sucursal, activo y de uso `NORMAL`. */
  deVenta: boolean;
}>;
export type SalidaDeCrearDeposito = Readonly<{ depositoId: string; yaExistia: boolean }>;

/** Lo que se cambia: el nombre y si es el de venta. Lo que no viene, no cambia. El uso no se edita. */
export type EntradaDeEditarDeposito = Readonly<{
  depositoId: string;
  nombre?: string | undefined;
  deVenta?: boolean | undefined;
  versionEsperada: number;
}>;
export type SalidaDeEditarDeposito = Readonly<{ version: number; yaEstaba: boolean }>;

export type EntradaDeCambiarActivoDeDeposito = Readonly<{ depositoId: string }>;
export type SalidaDeCambiarActivoDeDeposito = Readonly<{ yaEstaba: boolean }>;

/** El nombre del depósito es un texto de una línea de la lista de permitidos del catálogo (la base lo repite en `deposito_nombre_ck`). */
function nombreDeDeposito(texto: string): Resultado<string, "NOMBRE_INVALIDO"> {
  const nombre = nombreDeEleccionDesdeTexto(texto);
  return nombre.ok ? nombre : err("NOMBRE_INVALIDO");
}

/**
 * Crear un depósito (E5 §3.2). Guard `depositos.crear`; la sucursal tiene que estar en el alcance de quien pide, existir y estar abierta. El
 * nombre es único por sucursal (por clave: `Café` y `CAFÉ` chocan) y el que es «de venta» es de uso `NORMAL`. Repetición
 * (`CLAVE_DE_IDEMPOTENCIA`): el `id` lo manda la pantalla; el mismo `id` con el mismo contenido devuelve `yaExistia` sin escribir ni auditar, con
 * otro contenido, `ID_REUTILIZADO`. Un nombre repetido, un segundo «de venta» y lo demás lo frena la base y se traduce.
 */
export function armarCrearDeposito(dependencias: DependenciasDeStock) {
  return async function crearDeposito(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearDeposito,
  ): Promise<R<SalidaDeCrearDeposito>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCrearDeposito>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["depositos.crear"]);
        if (!permiso.ok) return permiso;
        if (!esUuid(entrada.id)) return err("IDENTIFICADOR_INVALIDO");
        if (!esUuid(entrada.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
        const sucursal = sucursalId(entrada.sucursalId);
        const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
        if (!alcance.ok) return alcance;
        const fila = await tx.sucursales.obtener(empresaId, sucursal);
        if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
        if (!fila.activa) return err("SUCURSAL_INACTIVA");
        const nombre = nombreDeDeposito(entrada.nombre);
        if (!nombre.ok) return nombre;
        if (!esUsoDeDeposito(entrada.uso)) return err("USO_INVALIDO");
        if (entrada.deVenta && entrada.uso !== "NORMAL") return err("USO_NO_VENDIBLE");
        const clave = claveDeNombre(nombre.valor);
        const insertado = await tx.depositos.insertar(empresaId, {
          id: entrada.id,
          sucursalId: sucursal,
          nombre: nombre.valor,
          nombreClave: clave,
          uso: entrada.uso,
          deVenta: entrada.deVenta,
        });
        if (!insertado) {
          const guardado = await tx.depositos.obtener(empresaId, entrada.id);
          const igual =
            guardado !== null &&
            guardado.sucursalId === sucursal &&
            guardado.nombreClave === clave &&
            guardado.uso === entrada.uso &&
            guardado.deVenta === entrada.deVenta;
          return igual ? ok({ depositoId: entrada.id, yaExistia: true }) : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "DEPOSITO_CREADO",
          entidad: "deposito",
          entidadId: entrada.id,
          despues: {
            sucursalId: sucursal,
            nombre: nombre.valor,
            uso: entrada.uso,
            deVenta: entrada.deVenta,
          },
        });
        return ok({ depositoId: entrada.id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Editar el nombre o si es el de venta (E5 §3.2). Guard `depositos.editar`; el depósito se bloquea (`FOR UPDATE`) y su sucursal tiene que estar
 * en el alcance. Repetición (`SIN_CAMBIOS`): si lo pedido ya es lo guardado devuelve lo vigente con `yaEstaba` sin escribir ni auditar aunque
 * la versión esperada sea vieja, así un reintento tras un éxito no falla. Si no, compara `versionEsperada` (`DEPOSITO_DESACTUALIZADO`).
 */
export function armarEditarDeposito(dependencias: DependenciasDeStock) {
  return async function editarDeposito(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarDeposito,
  ): Promise<R<SalidaDeEditarDeposito>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarDeposito>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["depositos.editar"]);
        if (!permiso.ok) return permiso;
        const actual = await tx.depositos.bloquear(empresaId, entrada.depositoId);
        if (actual === null) return err("DEPOSITO_NO_ENCONTRADO");
        const alcance = await exigirAlcanceDeSucursal(tx, contexto, actual.sucursalId);
        if (!alcance.ok) return alcance;
        let nombre = actual.nombre;
        if (entrada.nombre !== undefined) {
          const valido = nombreDeDeposito(entrada.nombre);
          if (!valido.ok) return valido;
          nombre = valido.valor;
        }
        const deVenta = entrada.deVenta ?? actual.deVenta;
        if (deVenta && actual.uso !== "NORMAL") return err("USO_NO_VENDIBLE");
        if (nombre === actual.nombre && deVenta === actual.deVenta) {
          return ok({ version: actual.version, yaEstaba: true });
        }
        if (entrada.versionEsperada !== actual.version) return err("DEPOSITO_DESACTUALIZADO");
        const editado = await tx.depositos.actualizar(empresaId, actual.id, actual.version, {
          nombre,
          nombreClave: claveDeNombre(nombre),
          deVenta,
        });
        if (editado === null) return err("DEPOSITO_DESACTUALIZADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "DEPOSITO_EDITADO",
          entidad: "deposito",
          entidadId: actual.id,
          ...diferencias(actual, editado),
        });
        return ok({ version: editado.version, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/** Solo lo que cambia, antes y después (la auditoría no guarda lo que no se tocó). */
function diferencias(antes: Deposito, despues: Deposito) {
  const a: Record<string, string | boolean> = {};
  const d: Record<string, string | boolean> = {};
  if (antes.nombre !== despues.nombre) {
    a["nombre"] = antes.nombre;
    d["nombre"] = despues.nombre;
  }
  if (antes.deVenta !== despues.deVenta) {
    a["deVenta"] = antes.deVenta;
    d["deVenta"] = despues.deVenta;
  }
  return { antes: a, despues: d };
}

function armarCambiarActivo(dependencias: DependenciasDeStock, activo: boolean) {
  const accion = activo ? "depositos.reactivar" : "depositos.desactivar";
  return async function cambiarActivo(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarActivoDeDeposito,
  ): Promise<R<SalidaDeCambiarActivoDeDeposito>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarActivoDeDeposito>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [accion]);
        if (!permiso.ok) return permiso;
        const actual = await tx.depositos.bloquear(empresaId, entrada.depositoId);
        if (actual === null) return err("DEPOSITO_NO_ENCONTRADO");
        const alcance = await exigirAlcanceDeSucursal(tx, contexto, actual.sucursalId);
        if (!alcance.ok) return alcance;
        if (actual.activo === activo) return ok({ yaEstaba: true });
        // El de venta no se desactiva (la base lo repite con `deposito_de_venta_ck`); con existencia o con un conteo abierto lo frena el disparador.
        if (!activo && actual.deVenta) return err("ES_EL_DE_VENTA");
        await tx.depositos.cambiarActivo(empresaId, actual.id, activo);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: activo ? "DEPOSITO_REACTIVADO" : "DEPOSITO_DESACTIVADO",
          entidad: "deposito",
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

/**
 * Desactivar un depósito (E5 §3.2): guard `depositos.desactivar`. No se desactiva el «de venta» (`ES_EL_DE_VENTA`), ni uno con existencia
 * (`DEPOSITO_CON_EXISTENCIA`) ni con un conteo abierto (`DEPOSITO_CON_CONTEO_ABIERTO`): esos dos los impone la base, así que valen aunque
 * otra sesión esté moviendo mercadería a la vez. Repetición (`YA_ESTABA`).
 */
export const armarDesactivarDeposito = (d: DependenciasDeStock) => armarCambiarActivo(d, false);
/** Reactivar un depósito: guard `depositos.reactivar`; `yaEstaba` si ya estaba activo. */
export const armarReactivarDeposito = (d: DependenciasDeStock) => armarCambiarActivo(d, true);
