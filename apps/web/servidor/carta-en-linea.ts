import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { errorDeCodigo } from "../../../src/capacidades/experiencia/respuesta";
import {
  cambiarElEstadoDeLaCartaEnLinea,
  guardarLaCartaEnLinea,
  verLaCartaEnLinea,
  type CartaEnLineaParaLaPantalla,
  type DependenciasDeCartaEnLineaWeb,
} from "../../../src/composicion/carta-en-linea-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTA_DE_LA_CARTA_EN_LINEA } from "../ui/plantillas/carta/modelo-de-carta-en-linea";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";
import { textoDe } from "./formularios-de-caja";

/**
 * «Carta en línea» (C1): la lectura y las acciones de guardar los textos, poner la carta en línea y sacarla. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa
 * (`conLaEmpresa`: sesión, origen propio y empresa elegida) y llaman a `src/composicion/carta-en-linea-web.ts`, donde se prueba el resto. El permiso y la validez de cada dato los decide el
 * servidor, dentro de la transacción: acá no se decide ni se valida nada.
 *
 * La sucursal la fija el SERVIDOR: es la elegida en este dispositivo (cookie validada contra las que la persona puede elegir, `sucursalDelPedido`), nunca la que diga el navegador; la que
 * la página mostró solo viaja ligada (`bind`, cifrada) y se COMPARA con la del servidor: si la persona cambió de sucursal en otra pestaña, el pedido se rechaza (el genérico) y no actúa
 * sobre la sucursal nueva. Del formulario solo se toman los tres textos y la identidad (cara, paleta, color propio y logo); la carta, su versión y la sucursal las fija la página.
 *
 * Cómo se repite sin duplicar: guardar lleva la clave de la carta (la misma clave dos veces es una sola carta); poner y sacar piden un ESTADO (repetirlo no escribe ni audita de nuevo).
 * Tras CUALQUIER resultado se vuelve a pedir la página (`revalidatePath`): lo que sigue lleva la versión vigente y, si hubo un conflicto, se ve lo que cambió.
 * Chequeo: `test/web/acciones-de-carta-en-linea.test.ts`.
 */

const dependencias: DependenciasDeCartaEnLineaWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  hostPropioDeLaCarta: web.hostPropioDeLaCarta,
  respuesta: dependenciasDeSesion.respuesta,
};

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/**
 * La clave de creación de UN intento de alta de la carta: la fija la página al abrirse. Recargar es otro intento (otra clave); reenviar el mismo formulario es el mismo. Previene: que un doble
 * toque o un reintento por red cortada creen dos cartas. Chequeo: `test/web/carta-en-linea-pagina.test.ts`.
 */
export const nuevaClaveDeCarta = (): string => crypto.randomUUID();

/** La carta de la sucursal, con el contexto que ya resolvió la página. `hostDeApp` es el de la marca del pedido. */
export function cargarLaCartaEnLinea(
  contexto: ContextoOperativo,
  sucursalId: string,
  hostDeApp: string | null,
): Promise<Respuesta<CartaEnLineaParaLaPantalla>> {
  return verLaCartaEnLinea(dependencias, contexto, { sucursalId, hostDeApp });
}

/** La sucursal con la que se trabaja (la elegida en el dispositivo, o la única abierta); `""` si ninguna: la página manda a elegirla. Nunca «todas». */
export async function sucursalDeLaCarta(contexto: ContextoOperativo): Promise<string> {
  const sucursal = await sucursalDelPedido(contexto);
  return sucursal.ok ? sucursal.dato.efectiva : "";
}

async function conLaSucursal<D>(
  hacer: (contexto: ContextoOperativo, sucursalId: string) => Promise<Respuesta<D>>,
): Promise<Respuesta<D>> {
  return conLaEmpresa(async (contexto) => {
    const sucursalId = await sucursalDeLaCarta(contexto);
    return sucursalId === "" ? { ok: false, error: GENERICO } : hacer(contexto, sucursalId);
  });
}

/** Lo que una acción devuelve: siempre vuelve a pedir la página, con éxito o sin él. */
function seQuedaEnLaPantalla<D>(respuesta: Respuesta<D>): ResultadoDeAccion {
  revalidatePath(RUTA_DE_LA_CARTA_EN_LINEA);
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/**
 * Un campo de identidad del formulario: su texto, o `undefined` si el formulario no lo trajo (o trajo un archivo; un pedido que no lo trae conserva lo vigente; uno que lo trae vacío lo deja «sin elegir»). El
 * valor lo valida `leerElPedidoDeGuardarLaCarta`: acá no se interpreta.
 */
const identidadDe = (datos: FormData, nombre: string): string | undefined => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : undefined;
};

/** Guarda los textos y la identidad (cara, color y logo); crea la carta fuera de línea si no existía. `versionEsperada` es `null` para una carta nueva. */
export async function guardarLosTextosDeLaCarta(
  ligado: Readonly<{ cartaId: string; sucursalId: string; versionEsperada: number | null }>,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaSucursal((contexto, sucursalId) =>
    guardarLaCartaEnLinea(
      dependencias,
      contexto,
      {
        ...ligado,
        nombre: textoDe(datos, "nombre"),
        rubro: textoDe(datos, "rubro"),
        lugar: textoDe(datos, "lugar"),
        cara: identidadDe(datos, "cara"),
        paleta: identidadDe(datos, "paleta"),
        colorPropio: identidadDe(datos, "colorPropio"),
        logo: identidadDe(datos, "logo"),
      },
      sucursalId,
    ),
  );
  return seQuedaEnLaPantalla(respuesta);
}

/** Pone la carta en línea (`EN_LINEA`) o la saca (`FUERA_DE_LINEA`), con la versión que la persona vio. */
export async function cambiarElEstadoDeLaCarta(
  ligado: Readonly<{
    cartaId: string;
    sucursalId: string;
    versionEsperada: number;
    estado: "EN_LINEA" | "FUERA_DE_LINEA";
  }>,
): Promise<ResultadoDeAccion> {
  const respuesta = await conLaSucursal((contexto, sucursalId) =>
    cambiarElEstadoDeLaCartaEnLinea(dependencias, contexto, ligado, sucursalId),
  );
  return seQuedaEnLaPantalla(respuesta);
}
