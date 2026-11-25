import "server-only";
import { revalidatePath } from "next/cache";
import type { ErrorPublico, Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarElContacto,
  desactivarLaParte,
  fichaDeLaParte,
  guardarLaParte,
  listarLasPartes,
  quitarElContacto,
  reactivarLaParte,
  type DependenciasDeDirectorioWeb,
  type FichaParaLaPantalla,
  type PartesParaLaLista,
  type PosibleDuplicadoParaLaPantalla,
  type ResultadoDeGuardar,
} from "../../../src/composicion/directorio-web";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { RUTA_DE_CLIENTES } from "../ui/plantillas/clientes/modelo-de-directorio";

/**
 * «Clientes y proveedores»: la lectura de la lista y de la ficha y las acciones de guardar, desactivar, reactivar y los contactos. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN
 * actúa (la empresa y la persona salen de la sesión, nunca del formulario) y llaman a `src/composicion/directorio-web.ts`. El permiso y toda regla del negocio los decide el servidor dentro
 * de su transacción: la pantalla no replica ninguna. Las acciones NO redirigen (un `redirect` dentro de una acción pierde el host y la puerta responde «No encontrado»): devuelven el resultado y la pantalla navega; el aviso de posibles duplicados NO es un error: vuelve con la lista de coincidencias
 * y no escribe nada hasta que la persona elige «Guardar igual».
 */

const dependencias: DependenciasDeDirectorioWeb = {
  casosDeUso: web.casosDeUsoDeClientes,
  consultas: web.consultasDeClientes,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Lo que vuelve de guardar: el error ya traducido (o nada) y, si hay coincidencias, las partes parecidas. */
export type ResultadoDeGuardarLaParte = Readonly<{
  error: ErrorPublico | null;
  /** Quedó guardada: la pantalla vuelve a la lista (la acción NO redirige: un `redirect` dentro de una acción pierde el host, defecto hallado el 16/11/2026). */
  guardada: boolean;
  duplicados: readonly PosibleDuplicadoParaLaPantalla[];
}>;

/** La lista de partes según lo que dice la dirección (`texto`, `rol`, `desactivados`, `despuesDe`): se vuelve a validar en la composición. */
export function cargarLasPartes(
  buscar: Readonly<{
    texto?: string | undefined;
    rol?: string | undefined;
    desactivados?: string | undefined;
    despuesDe?: string | undefined;
  }>,
): Promise<Respuesta<PartesParaLaLista>> {
  const rol =
    buscar.rol === "cliente" ? "CUSTOMER" : buscar.rol === "proveedor" ? "PROVEEDOR" : null;
  return conLaEmpresa((contexto) =>
    listarLasPartes(dependencias, contexto, {
      texto: buscar.texto ?? null,
      rol,
      incluirDesactivadas: buscar.desactivados === "1",
      despuesDe: buscar.despuesDe ?? null,
    }),
  );
}

export function cargarLaParte(parteId: string): Promise<Respuesta<FichaParaLaPantalla>> {
  return conLaEmpresa((contexto) => fichaDeLaParte(dependencias, contexto, parteId));
}

/** Los roles marcados, en la lista cerrada de la composición; lo que no sea un rol conocido lo rechaza ella. */
const rolesDe = (datos: FormData): string[] =>
  datos.getAll("roles").filter((r): r is string => typeof r === "string");

/** Guardar el formulario: un alta (sin `parteId`) o una edición (con `parteId` y la versión que se vio). */
export async function guardarLaParteDelFormulario(
  parteId: string | null,
  versionEsperada: number | null,
  datos: FormData,
): Promise<ResultadoDeGuardarLaParte> {
  const r = await conLaEmpresa((contexto) =>
    guardarLaParte(dependencias, contexto, {
      idempotencia: textoDe(datos, "idempotencia"),
      parteId,
      versionEsperada,
      guardarIgual: textoDe(datos, "guardarIgual") === "1",
      naturaleza: textoDe(datos, "naturaleza"),
      nombre: textoDe(datos, "nombre"),
      apellido: textoDe(datos, "apellido"),
      alias: textoDe(datos, "alias"),
      documentoTipo: textoDe(datos, "documentoTipo"),
      documentoPais: textoDe(datos, "documentoPais"),
      documentoNumero: textoDe(datos, "documentoNumero"),
      condicionIva: textoDe(datos, "condicionIva"),
      email: textoDe(datos, "email"),
      telefono: textoDe(datos, "telefono"),
      calle: textoDe(datos, "calle"),
      numero: textoDe(datos, "numero"),
      codigoPostal: textoDe(datos, "codigoPostal"),
      localidad: textoDe(datos, "localidad"),
      provincia: textoDe(datos, "provincia"),
      nota: textoDe(datos, "nota"),
      roles: rolesDe(datos),
    }),
  );
  if (!r.ok) return { error: r.error, guardada: false, duplicados: [] };
  if (r.dato.estado === "DUPLICADOS") {
    return { error: null, guardada: false, duplicados: r.dato.duplicados };
  }
  return { error: null, guardada: true, duplicados: [] };
}

/**
 * El alta rápida de un proveedor desde «Nueva compra» (maqueta `compra.html`, «Agregar proveedor»): solo el nombre y si es persona o empresa, con el rol Proveedor y nada más (DDD 15/11/2026, 8a).
 * Es el MISMO alta del directorio (`guardarLaParte`), con su clave de creación (idempotencia) y su aviso de duplicados, que no bloquea (8b): sin `guardarIgual` y con una parte parecida no se escribe nada
 * y vuelven las coincidencias. La empresa y la persona salen de la sesión.
 */
export function altaRapidaDeProveedor(
  clave: string,
  naturaleza: string,
  nombre: string,
  guardarIgual: boolean,
): Promise<Respuesta<ResultadoDeGuardar>> {
  return conLaEmpresa((contexto) =>
    guardarLaParte(dependencias, contexto, {
      idempotencia: clave,
      parteId: null,
      versionEsperada: null,
      guardarIgual,
      naturaleza,
      nombre,
      roles: ["PROVEEDOR"],
    }),
  );
}

/** Termina una acción sobre una parte: el error ya traducido o nada. No redirige: la pantalla decide adónde ir. */
function terminar(respuesta: Respuesta<unknown>): ResultadoDeAccion {
  return { error: respuesta.ok ? null : respuesta.error };
}

/** Cambiar el estado vuelve a pedir la lista (`revalidatePath`): lo que sigue lleva el estado vigente. Solo si salió bien. */
export async function desactivarLaParteDelDirectorio(parteId: string): Promise<ResultadoDeAccion> {
  const resultado = terminar(
    await conLaEmpresa((contexto) => desactivarLaParte(dependencias, contexto, { parteId })),
  );
  if (resultado.error === null) revalidatePath(RUTA_DE_CLIENTES);
  return resultado;
}

export async function reactivarLaParteDelDirectorio(parteId: string): Promise<ResultadoDeAccion> {
  const resultado = terminar(
    await conLaEmpresa((contexto) => reactivarLaParte(dependencias, contexto, { parteId })),
  );
  if (resultado.error === null) revalidatePath(RUTA_DE_CLIENTES);
  return resultado;
}

export async function agregarUnContacto(
  deParteId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return terminar(
    await conLaEmpresa((contexto) =>
      agregarElContacto(dependencias, contexto, {
        deParteId,
        contactoId: textoDe(datos, "contactoId"),
        cargo: textoDe(datos, "cargo"),
      }),
    ),
  );
}

export async function quitarUnContacto(
  deParteId: string,
  contactoId: string,
  tipo: string,
): Promise<ResultadoDeAccion> {
  return terminar(
    await conLaEmpresa((contexto) =>
      quitarElContacto(dependencias, contexto, { deParteId, contactoId, tipo }),
    ),
  );
}

/** La clave de creación de UN intento de alta: la fija la página al abrirse. Previene: que un doble toque o un reintento por red cortada creen dos partes. */
export const nuevaClaveDeParte = (): string => crypto.randomUUID();
