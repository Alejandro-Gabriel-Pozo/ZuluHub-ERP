import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarDeMesaLaCuenta,
  liberarLaMesa,
  tomarElPedido,
  verElMapaDeMesas,
  verLaFichaDeLaMesa,
  type DependenciasDeCuentaDeMesaWeb,
  type FichaParaLaPantalla,
  type MapaParaLaPantalla,
} from "../../../src/composicion/cuenta-de-mesa-web";
import {
  cambiarElEstadoDeLaMesa,
  crearLaMesa,
  editarLaMesa,
  verLaMesa,
  verLasMesas,
  type DependenciasDeMesasWeb,
  type MesaParaLaPantalla,
  type MesasParaLaPantalla,
} from "../../../src/composicion/mesas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTA_DE_MESAS } from "../ui/plantillas/salon/modelo-de-mesas";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las mesas del salón (S-1; maqueta `mesas.html`): las lecturas y las acciones de crear, editar, desactivar y reactivar. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE
 * actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida; la sucursal, la elegida en este dispositivo y validada contra las que la persona puede elegir, `sucursalDelPedido`) y llaman a
 * `src/composicion/mesas-web.ts`, donde se prueba el resto. La sucursal NUNCA viene del navegador y sin sucursal no se asume «todas»: `efectiva` vacía cierra con el genérico. El permiso
 * (`mesas.*`) y la validez de cada dato los decide el servidor dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la acción declara; la
 * clave de creación, la mesa y su versión no viajan en el formulario: los fija la página al armar la acción (`bind`).
 * Cómo se repite sin duplicar: crear lleva la clave de creación (el `id` de la mesa): el doble toque y el reintento son una sola alta; recargar la página es otro intento.
 * Chequeo: `test/web/servidor-salon.test.ts`.
 */

const dependencias: DependenciasDeMesasWeb = {
  casosDeUso: web.casosDeUsoDeSalon,
  consultas: web.consultasDeSalon,
  respuesta: dependenciasDeSesion.respuesta,
};

const dependenciasDeLaCuenta: DependenciasDeCuentaDeMesaWeb = {
  casosDeUso: web.casosDeUsoDeSalon,
  consultas: web.consultasDeSalon,
  respuesta: dependenciasDeSesion.respuesta,
};

/** La clave de creación de UN intento de alta de una mesa: la fija la página al abrirse. Previene: que un doble toque o un reintento por red cortada creen dos mesas. */
export const nuevaClaveDeMesa = (): string => crypto.randomUUID();

/** La sucursal con la que se trabaja: la que el servidor resuelve, `""` si ninguna (nunca «todas»). */
export async function sucursalDeTrabajo(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  return sucursal.ok ? { ok: true, dato: sucursal.dato.efectiva } : sucursal;
}

/** Todas las mesas de la sucursal de trabajo, con el contexto que ya resolvió la página. */
export async function cargarLasMesas(
  contexto: ContextoOperativo,
): Promise<Respuesta<MesasParaLaPantalla>> {
  const sucursal = await sucursalDeTrabajo(contexto);
  return sucursal.ok ? verLasMesas(dependencias, contexto, sucursal.dato) : sucursal;
}

/** Una mesa de la sucursal de trabajo (para editarla). */
export async function cargarLaMesa(
  contexto: ContextoOperativo,
  mesaId: string,
): Promise<Respuesta<MesaParaLaPantalla>> {
  const sucursal = await sucursalDeTrabajo(contexto);
  return sucursal.ok ? verLaMesa(dependencias, contexto, sucursal.dato, mesaId) : sucursal;
}

const DATOS_DE_LA_MESA = ["numero", "forma", "tamano", "columna", "fila"] as const;
const delFormulario = (datos: FormData) =>
  Object.fromEntries(DATOS_DE_LA_MESA.map((campo) => [campo, textoDe(datos, campo)]));

/** Crea la mesa; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function darDeAltaLaMesa(
  claveDeCreacion: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    if (!sucursal.ok) return sucursal;
    return crearLaMesa(dependencias, contexto, sucursal.dato, {
      claveDeCreacion,
      ...delFormulario(datos),
    });
  });
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_MESAS);
}

/** Guarda la mesa con la versión que se vio; si sale bien, vuelve a la lista; si no, devuelve el error ya traducido. */
export async function guardarLaMesa(
  mesaId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    if (!sucursal.ok) return sucursal;
    return editarLaMesa(dependencias, contexto, sucursal.dato, {
      mesaId,
      versionEsperada,
      ...delFormulario(datos),
    });
  });
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(RUTA_DE_MESAS);
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) la mesa. Con éxito o sin él vuelve a pedir la lista: lo que sigue lleva las versiones vigentes. */
export async function cambiarElEstadoDeLaMesaDelSalon(
  mesaId: string,
  activa: boolean,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    if (!sucursal.ok) return sucursal;
    return cambiarElEstadoDeLaMesa(dependencias, contexto, sucursal.dato, { mesaId }, activa);
  });
  revalidatePath(RUTA_DE_MESAS);
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** El id de la cuenta de UN intento de «Tomar pedido»: lo fija la página al abrirse. Previene: que un doble toque, un reintento por red cortada o dos pestañas sobre la misma mesa abran dos cuentas. */
export const nuevoIdDeCuentaDeMesa = (): string => crypto.randomUUID();

/** Corre una operación de la cuenta de mesa con la sucursal de trabajo que fija el servidor (nunca la del navegador; sin ninguna, el genérico). */
const enLaSucursal = <D>(
  hacer: (contexto: ContextoOperativo, sucursalId: string) => Promise<Respuesta<D>>,
): Promise<Respuesta<D>> =>
  conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    return sucursal.ok ? hacer(contexto, sucursal.dato) : sucursal;
  });

/** El mapa de mesas de la sucursal de trabajo; `crudo` puede traer `{ filtro }` (Todas, Libres, En pedido, Ocupadas). */
export const cargarElMapaDeMesas = (crudo?: unknown): Promise<Respuesta<MapaParaLaPantalla>> =>
  enLaSucursal((contexto, sucursal) =>
    verElMapaDeMesas(dependenciasDeLaCuenta, contexto, sucursal, crudo),
  );

/** La ficha de una mesa de la sucursal de trabajo (`{ mesaId }`). */
export const cargarLaFichaDeLaMesa = (crudo: unknown): Promise<Respuesta<FichaParaLaPantalla>> =>
  enLaSucursal((contexto, sucursal) =>
    verLaFichaDeLaMesa(dependenciasDeLaCuenta, contexto, sucursal, crudo),
  );

/** «Tomar pedido» (`{ cuentaId, mesaId }`, con el `cuentaId` de `nuevoIdDeCuentaDeMesa`). */
export const tomarElPedidoDeLaMesa = (crudo: unknown) =>
  enLaSucursal((contexto, sucursal) =>
    tomarElPedido(dependenciasDeLaCuenta, contexto, sucursal, crudo),
  );

/** «Liberar mesa» (`{ cuentaId }`). */
export const liberarLaMesaDelSalon = (crudo: unknown) =>
  enLaSucursal((contexto, sucursal) =>
    liberarLaMesa(dependenciasDeLaCuenta, contexto, sucursal, crudo),
  );

/** «Cambiar de mesa» (`{ cuentaId, mesaDestinoId }`). */
export const cambiarDeMesaLaCuentaDelSalon = (crudo: unknown) =>
  enLaSucursal((contexto, sucursal) =>
    cambiarDeMesaLaCuenta(dependenciasDeLaCuenta, contexto, sucursal, crudo),
  );
