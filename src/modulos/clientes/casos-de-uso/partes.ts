import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { buscadosDeDuplicado } from "../persistencia/repositorios-de-partes";
import { nombreCompletoDeParte } from "../dominio/busqueda";
import type { DatosDeParte, EntradaDeParte } from "../dominio/datos-de-parte";
import { razonesDeDuplicado, type RazonDeDuplicado } from "../dominio/duplicados";
import { rolesPedidos, type RolDeParte } from "../dominio/roles";
import { esUuid } from "../persistencia/filas";
import type { Parte } from "../persistencia/modelo";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeClientes, TxDeClientes } from "./contrato";
import type { ErrorDeClientes } from "./errores";
import { claveDeDocumento, datosValidos, entradaDeParte, mismosDatos } from "./partes-comun";

type R<S> = Resultado<S, ErrorDeClientes>;

export type PosibleDuplicado = Readonly<{
  parteId: string;
  nombre: string;
  razones: readonly RazonDeDuplicado[];
}>;

/** Lo que escribe la pantalla al dar de alta una parte: los datos más la clave del alta y los roles. */
export type EntradaDeCrearParte = EntradaDeParte &
  Readonly<{
    /** Un UUID que genera la pantalla al abrir el formulario: es la idempotencia del alta. */
    idempotencia: string;
    roles: readonly string[];
  }>;
export type SalidaDeCrearParte = Readonly<{
  parteId: string;
  yaExistia: boolean;
  posiblesDuplicados: readonly PosibleDuplicado[];
}>;

/**
 * Los campos que se pueden cambiar de una parte: lo que no viene, no cambia; `null` borra un opcional. La naturaleza no se pasa por acá cuando no cambia.
 * `documento` y `domicilio` se reemplazan enteros.
 */
export type CambiosDeParte = Partial<EntradaDeParte>;
export type EntradaDeEditarParte = Readonly<{
  parteId: string;
  versionEsperada: number;
  cambios: CambiosDeParte;
}>;
export type SalidaDeEditarParte = Readonly<{
  version: number;
  yaEstaba: boolean;
  posiblesDuplicados: readonly PosibleDuplicado[];
}>;

export type EntradaDeCambiarEstadoDeParte = Readonly<{ parteId: string }>;
export type SalidaDeCambiarEstadoDeParte = Readonly<{ yaEstaba: boolean }>;

/** Los posibles duplicados de unos datos: las partes de la empresa con el mismo email, teléfono o nombre (sin la propia). El aviso no bloquea. */
export async function buscarDuplicados(
  tx: Pick<TxDeClientes, "partes">,
  contexto: ContextoOperativo,
  datos: DatosDeParte,
  excluirId: string | null,
): Promise<readonly PosibleDuplicado[]> {
  const candidatas = await tx.partes.posiblesDuplicados(
    contexto.empresaId,
    buscadosDeDuplicado(datos),
    excluirId,
  );
  const nuestra = {
    email: datos.email,
    telefono: datos.telefono,
    nombreCompleto: nombreCompletoDeParte(datos),
  };
  return candidatas.map((p) => ({
    parteId: p.id,
    nombre: nombreCompletoDeParte(p),
    razones: razonesDeDuplicado(nuestra, {
      email: p.email,
      telefono: p.telefono,
      nombreCompleto: nombreCompletoDeParte(p),
    }),
  }));
}

/** El documento de unos datos ya es de otra parte de la empresa: el error con quién es (activa o desactivada), o `null` si está libre. */
async function documentoOcupado(
  tx: Pick<TxDeClientes, "partes">,
  contexto: ContextoOperativo,
  datos: DatosDeParte,
  propia: string | null,
): Promise<ErrorDeClientes | null> {
  const clave = claveDeDocumento(datos);
  if (clave === null) return null;
  const otra = await tx.partes.porDocumento(contexto.empresaId, clave);
  if (otra === null || otra.id === propia) return null;
  return otra.estado === "ACTIVA"
    ? { error: "DOCUMENTO_YA_REGISTRADO", parteId: otra.id }
    : { error: "PARTE_INACTIVA_CON_ESE_DOCUMENTO", parteId: otra.id };
}

/** ¿Es la misma alta? (la repetición legítima de un reintento: mismos datos y mismos roles activos). */
async function esLaMismaAlta(
  tx: Pick<TxDeClientes, "partes">,
  contexto: ContextoOperativo,
  existente: Parte,
  datos: DatosDeParte,
  roles: readonly RolDeParte[],
): Promise<boolean> {
  if (!mismosDatos(existente, datos)) return false;
  const guardados = (await tx.partes.rolesDe(contexto.empresaId, [existente.id]))
    .filter((r) => r.activo)
    .map((r) => r.rol)
    .sort();
  return JSON.stringify(guardados) === JSON.stringify([...roles].sort());
}

/**
 * El alta de una parte dentro de la transacción que ya abrió quien llama (el caso de uso `crearParte` y el puerto de otros módulos). NO autoriza: quien
 * llama ya pidió la acción al guard. Repetición por la idempotencia del alta: el mismo contenido da `yaExistia` sin escribir ni auditar; otro contenido,
 * `CLAVE_REUTILIZADA`. El documento ya usado por otra parte da `DOCUMENTO_YA_REGISTRADO` o `PARTE_INACTIVA_CON_ESE_DOCUMENTO` con el id de esa parte,
 * aunque la carrera la haya ganado otra transacción un instante antes.
 */
export async function crearParteDentro(
  tx: TxDeClientes,
  contexto: ContextoOperativo,
  entrada: EntradaDeCrearParte,
): Promise<R<SalidaDeCrearParte>> {
  const { empresaId } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  if (!esUuid(entrada.idempotencia)) return err("IDENTIFICADOR_INVALIDO");
  const roles = rolesPedidos(entrada.roles);
  if (roles === null) return err("ROL_DE_PARTE_INVALIDO");
  const datos = datosValidos(entrada);
  if (!datos.ok) return datos;

  const repetida = await tx.partes.porIdempotencia(empresaId, entrada.idempotencia);
  if (repetida !== null) {
    return (await esLaMismaAlta(tx, contexto, repetida, datos.valor, roles))
      ? ok({ parteId: repetida.id, yaExistia: true, posiblesDuplicados: [] })
      : err("CLAVE_REUTILIZADA");
  }
  const ocupado = await documentoOcupado(tx, contexto, datos.valor, null);
  if (ocupado !== null) return err(ocupado);

  const id = await tx.partes.insertar(empresaId, {
    idempotencia: entrada.idempotencia,
    datos: datos.valor,
    esAtajo: datos.valor.documento === null,
    creadoPor: contexto.personaId,
  });
  if (id === null) {
    // Una única ya estaba ocupada: otra transacción llegó primero. Es la misma alta repetida, o el documento de otra parte.
    const otra = await tx.partes.porIdempotencia(empresaId, entrada.idempotencia);
    if (otra !== null) {
      return (await esLaMismaAlta(tx, contexto, otra, datos.valor, roles))
        ? ok({ parteId: otra.id, yaExistia: true, posiblesDuplicados: [] })
        : err("CLAVE_REUTILIZADA");
    }
    const choque = await documentoOcupado(tx, contexto, datos.valor, null);
    if (choque !== null) return err(choque);
    // No es ninguna de las dos: no se inventa un error de negocio.
    throw new Error("clientes: el alta no insertó la parte y ninguna única la explica");
  }
  for (const rol of roles) await tx.partes.insertarRol(empresaId, id, rol);
  const posiblesDuplicados = await buscarDuplicados(tx, contexto, datos.valor, id);
  // La auditoría no guarda los datos personales (F2): solo qué se creó, con qué roles y si trae documento.
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "PARTE_CREADA",
    entidad: "parte",
    entidadId: id,
    despues: {
      naturaleza: datos.valor.naturaleza,
      roles: [...roles],
      conDocumento: datos.valor.documento !== null,
      posiblesDuplicados: posiblesDuplicados.length,
    },
  });
  return ok({ parteId: id, yaExistia: false, posiblesDuplicados });
}

/**
 * Dar de alta una persona o empresa (E9 §3.1). Guard `partes.crear`; datos validados por campo; documento único por empresa (también entre desactivadas);
 * los posibles duplicados por email, teléfono o nombre se informan y NO bloquean (la persona decide con «Guardar igual»). Repetición:
 * `CLAVE_DE_IDEMPOTENCIA` (la `idempotencia` de la pantalla).
 */
export function armarCrearParte(dependencias: DependenciasDeClientes) {
  return async function crearParte(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearParte,
  ): Promise<R<SalidaDeCrearParte>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCrearParte>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["partes.crear"]);
        if (!permiso.ok) return permiso;
        return crearParteDentro(tx, contexto, entrada);
      },
    );
    return traducir(resultado);
  };
}

/** Los campos que cambiaron entre una parte y los datos nuevos (solo los nombres: la auditoría no guarda valores personales). */
function camposCambiados(antes: Parte, despues: DatosDeParte): string[] {
  const a = JSON.stringify(entradaCanonica(antes));
  const d = entradaCanonica(despues);
  const previo = JSON.parse(a) as Record<string, unknown>;
  return Object.keys(d).filter(
    (campo) => JSON.stringify(previo[campo]) !== JSON.stringify(d[campo as keyof typeof d]),
  );
}

function entradaCanonica(origen: Parte | DatosDeParte): DatosDeParte {
  const valido = datosValidos("version" in origen ? entradaDeParte(origen) : origen);
  if (!valido.ok) throw new Error("clientes: una parte guardada no valida");
  return valido.valor;
}

/**
 * Editar los datos de una parte (E9 §3.1). Guard `partes.editar`; la parte se bloquea (`FOR UPDATE`); lo que no viene en `cambios` no cambia. Repetición
 * (`SIN_CAMBIOS`): si lo pedido ya es lo guardado devuelve lo vigente con `yaEstaba` sin escribir ni auditar, aunque la versión esperada sea vieja, así
 * un reintento tras un éxito no falla; si no, compara `versionEsperada` (`VERSION_DESACTUALIZADA`).
 */
export function armarEditarParte(dependencias: DependenciasDeClientes) {
  return async function editarParte(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarParte,
  ): Promise<R<SalidaDeEditarParte>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarParte>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["partes.editar"]);
        if (!permiso.ok) return permiso;
        const actual = await tx.partes.bloquear(empresaId, entrada.parteId);
        if (actual === null) return err("PARTE_NO_ENCONTRADA");
        const datos = datosValidos({ ...entradaDeParte(actual), ...entrada.cambios });
        if (!datos.ok) return datos;
        if (mismosDatos(actual, datos.valor)) {
          return ok({ version: actual.version, yaEstaba: true, posiblesDuplicados: [] });
        }
        if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
        const ocupado = await documentoOcupado(tx, contexto, datos.valor, actual.id);
        if (ocupado !== null) return err(ocupado);
        const editada = await tx.partes.actualizar(
          empresaId,
          actual.id,
          actual.version,
          datos.valor,
        );
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        const posiblesDuplicados = await buscarDuplicados(tx, contexto, datos.valor, actual.id);
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PARTE_EDITADA",
          entidad: "parte",
          entidadId: actual.id,
          despues: { campos: camposCambiados(actual, datos.valor) },
        });
        return ok({ version: editada.version, yaEstaba: false, posiblesDuplicados });
      },
    );
    return traducir(resultado);
  };
}

function armarCambiarEstado(dependencias: DependenciasDeClientes, activa: boolean) {
  const accion = activa ? "partes.reactivar" : "partes.desactivar";
  return async function cambiarEstado(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarEstadoDeParte,
  ): Promise<R<SalidaDeCambiarEstadoDeParte>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarEstadoDeParte>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [accion]);
        if (!permiso.ok) return permiso;
        const actual = await tx.partes.bloquear(empresaId, entrada.parteId);
        if (actual === null) return err("PARTE_NO_ENCONTRADA");
        if ((actual.estado === "ACTIVA") === activa) return ok({ yaEstaba: true });
        await tx.partes.cambiarEstado(empresaId, actual.id, activa ? "ACTIVA" : "INACTIVA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: activa ? "PARTE_REACTIVADA" : "PARTE_DESACTIVADA",
          entidad: "parte",
          entidadId: actual.id,
          antes: { estado: actual.estado },
          despues: { estado: activa ? "ACTIVA" : "INACTIVA" },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/** Desactivar una parte (E9 §3.1): guard `partes.desactivar`; se conserva y se puede reactivar. Repetición (`YA_ESTABA`). */
export const armarDesactivarParte = (d: DependenciasDeClientes) => armarCambiarEstado(d, false);
/** Reactivar una parte: guard `partes.reactivar`; `yaEstaba` si ya estaba activa. */
export const armarReactivarParte = (d: DependenciasDeClientes) => armarCambiarEstado(d, true);
