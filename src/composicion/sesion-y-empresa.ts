import { ENCABEZADO_DE_IP } from "../capacidades/autenticacion/host-de-autenticacion";
import { decidirEmpresa } from "../capacidades/experiencia/empresa-elegida";
import { origenEsPropio } from "../capacidades/experiencia/origen";
import { hostDelPedido } from "../capacidades/experiencia/puerta";
import { errorDeCodigo, estadoHttpDe, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { ConsultasDeEmpresas } from "../modulos/empresas/publico";
import type {
  CasosDeUsoDeIdentidad,
  ConsultasDeSesion,
  EmpresaDeLaLista,
} from "../modulos/identidad/publico";
import type { EmpresaId, MarcaComercialId, PersonaId } from "../primitivas/identificadores/marca";
import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { Autenticacion, SesionAutenticada } from "../puertos/autenticacion";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  respuestaDeFalla,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { contextoOperativo, contextoDeSesion } from "./contextos";

/**
 * El primer flujo real de la web (W5): de una sesión de Google a la empresa en la que se trabaja. Vive acá, y
 * no en `apps/web`, para probarse con la base real sin levantar Next: las páginas y acciones del servidor
 * solo le pasan lo que ya resolvieron (el host de la puerta, la marca, las cookies del pedido) y aplican lo
 * que devuelve. Nada de acá lee el entorno: todo llega por `DependenciasDeSesion`.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/web-sesion-y-empresa.test.ts`):
 *  - Las empresas salen SIEMPRE filtradas por la marca de la puerta (la del host), nunca por email ni por lo
 *    que mande el navegador (P-1).
 *  - La cookie `zh_empresa` se valida contra esa lista en cada pedido; una empresa que no está (la de otra
 *    marca, una a la que ya no se pertenece) es `SIN_PERMISO`.
 *  - El contexto operativo se arma SOLO con `contextoOperativo` de `contextos.ts` (R-W3), con la empresa ya
 *    validada, la persona de la sesión y la marca del host.
 *  - Todo resultado sale por `aRespuesta` (ADR-016): sin detalle interno, con referencia si es inesperado.
 */

export type DependenciasDeSesion = Readonly<{
  autenticacion: () => Autenticacion;
  consultasDeSesion: () => ConsultasDeSesion;
  casosDeUsoDeIdentidad: () => CasosDeUsoDeIdentidad;
  consultasDeEmpresas: () => ConsultasDeEmpresas;
  /** El reloj: se toma UNA vez por operación y entra como dato (ADR-004, regla G4). */
  ahora: () => Date;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una empresa de la lista de la persona, con lo que la pantalla necesita para elegir y para avisar si no opera. */
export type EmpresaParaLaPantalla = Pick<
  EmpresaDeLaLista,
  "empresaId" | "nombre" | "rol" | "estadoEfectivo"
>;

const paraLaPantalla = (e: EmpresaDeLaLista): EmpresaParaLaPantalla => ({
  empresaId: e.empresaId,
  nombre: e.nombre,
  rol: e.rol,
  estadoEfectivo: e.estadoEfectivo,
});

export type EmpresasDeLaPersona = Readonly<{
  /** `null`: el usuario todavía no está vinculado con ninguna persona (nunca se busca por email). */
  personaId: PersonaId | null;
  empresas: readonly EmpresaParaLaPantalla[];
}>;

type Interno = Readonly<{
  personaId: PersonaId | null;
  empresas: readonly EmpresaDeLaLista[];
}>;

/** Lo que la sesión puede ver de la marca de esta puerta: su persona y sus empresas EN ESA MARCA. */
async function leerEmpresas(
  d: DependenciasDeSesion,
  sesion: SesionAutenticada,
  marcaId: MarcaComercialId,
): Promise<Respuesta<Interno>> {
  try {
    const contexto = contextoDeSesion({ usuarioAuth: sesion.usuarioAuth, ahora: d.ahora() });
    const consultas = d.consultasDeSesion();
    const persona = await consultas.personaDeLaSesion(contexto);
    if (!persona.ok) return { ok: false, error: errorAPublico(persona.error, d.respuesta) };
    if (persona.valor === null) return { ok: true, dato: { personaId: null, empresas: [] } };
    const personaId = persona.valor.personaId;
    const empresas = await consultas.empresasDeLaSesion(contexto, { marcaId });
    return aRespuesta(empresas, d.respuesta, (lista) => ({ personaId, empresas: lista }));
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Las empresas de la persona de la sesión en la marca de la puerta (la pantalla «elegir empresa»). */
export async function empresasDeLaPersona(
  d: DependenciasDeSesion,
  sesion: SesionAutenticada,
  marcaId: MarcaComercialId,
): Promise<Respuesta<EmpresasDeLaPersona>> {
  const leidas = await leerEmpresas(d, sesion, marcaId);
  if (!leidas.ok) return leidas;
  return {
    ok: true,
    dato: { personaId: leidas.dato.personaId, empresas: leidas.dato.empresas.map(paraLaPantalla) },
  };
}

export type EntradaALaEmpresa =
  | Readonly<{
      tipo: "ENTRA";
      empresa: EmpresaParaLaPantalla;
      personaId: PersonaId;
      /** Para llamar a los casos de uso y consultas de la empresa. Solo existe en el servidor. */
      contexto: ContextoOperativo;
    }>
  | Readonly<{ tipo: "ELEGIR"; empresas: readonly EmpresaParaLaPantalla[] }>
  | Readonly<{ tipo: "SIN_EMPRESAS" }>;

export type EntradaDeResolverEmpresa = Readonly<{
  sesion: SesionAutenticada;
  /** La marca de la puerta: la que resolvió el servidor desde el host. */
  marcaId: MarcaComercialId;
  /** El valor de la cookie `zh_empresa` DE ESTE HOST, tal como llegó (no es de confianza). */
  cookieDeEmpresa: string | null;
}>;

/**
 * A qué empresa entra la persona en este pedido (armazón web §3.2 pasos 8 a 10). Con una cookie que no
 * corresponde a una empresa de la persona en esta marca: `SIN_PERMISO`.
 */
export async function resolverEmpresa(
  d: DependenciasDeSesion,
  entrada: EntradaDeResolverEmpresa,
): Promise<Respuesta<EntradaALaEmpresa>> {
  const leidas = await leerEmpresas(d, entrada.sesion, entrada.marcaId);
  if (!leidas.ok) return leidas;
  const { personaId, empresas } = leidas.dato;
  const decision = decidirEmpresa(empresas, entrada.cookieDeEmpresa);
  switch (decision.tipo) {
    case "SIN_PERMISO":
      return { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    case "SIN_EMPRESAS":
      return { ok: true, dato: { tipo: "SIN_EMPRESAS" } };
    case "ELEGIR":
      return {
        ok: true,
        dato: { tipo: "ELEGIR", empresas: decision.empresas.map(paraLaPantalla) },
      };
    case "ENTRA": {
      // Si hay empresas, hay persona vinculada (la lista sale de sus membresías): lo otro es un defecto.
      if (personaId === null) {
        return {
          ok: false,
          error: respuestaDeFalla("hay empresas pero no hay persona vinculada", d.respuesta),
        };
      }
      return {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: paraLaPantalla(decision.empresa),
          personaId,
          // La empresa ya está validada contra la lista; la marca es la de la puerta, nunca la del navegador.
          contexto: contextoOperativo({
            empresaId: decision.empresa.empresaId,
            personaId,
            marcaDeEntrada: entrada.marcaId,
            ahora: d.ahora(),
          }),
        },
      };
    }
  }
}

/**
 * «Entrar a la empresa»: comprueba que la empresa elegida es de la persona en esta marca y devuelve su id
 * para fijar la cookie. Repetirla (doble toque, reintento) da lo mismo y no cambia nada más: la regla natural
 * de repetición de esta operación (ADR-015, punto 4).
 */
export async function elegirEmpresa(
  d: DependenciasDeSesion,
  entrada: Readonly<{
    sesion: SesionAutenticada;
    marcaId: MarcaComercialId;
    empresaId: string;
  }>,
): Promise<Respuesta<Readonly<{ empresaId: EmpresaId }>>> {
  const leidas = await leerEmpresas(d, entrada.sesion, entrada.marcaId);
  if (!leidas.ok) return leidas;
  const elegida =
    entrada.empresaId === ""
      ? undefined
      : leidas.dato.empresas.find((e) => e.empresaId === entrada.empresaId);
  return elegida === undefined
    ? { ok: false, error: errorDeCodigo("SIN_PERMISO") }
    : { ok: true, dato: { empresaId: elegida.empresaId } };
}

/** Una sucursal activa de la empresa, para el selector de este dispositivo. */
export type SucursalParaLaPantalla = Readonly<{ id: string; nombre: string }>;

/**
 * Las sucursales activas de la empresa del contexto, para el selector de sucursal. Pasa por la consulta de
 * empresas (que pide `sucursales.ver` al guard y limita a la empresa y a la marca de la puerta): una persona
 * sin ese permiso recibe el motivo, y la pantalla simplemente no ofrece el selector.
 */
export async function sucursalesDeLaEmpresa(
  d: DependenciasDeSesion,
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly SucursalParaLaPantalla[]>> {
  try {
    const resultado = await d.consultasDeEmpresas().listarSucursales(contexto, {
      incluirInactivas: false,
    });
    return aRespuesta(resultado, d.respuesta, (lista) =>
      lista.map((sucursal) => ({ id: sucursal.id, nombre: sucursal.nombre })),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type InvitacionAceptada = Readonly<{
  yaEstabaAceptada: boolean;
  empresas: readonly Readonly<{ empresaId: EmpresaId; rol: RolDeEmpresa }>[];
}>;

const LARGO_MAXIMO_DEL_TOKEN = 512;

/**
 * Aceptar la invitación con la cuenta que ingresó (armazón web §4.6). El email que se compara con el de la
 * invitación es el VERIFICADO de la sesión, nunca uno que mande el navegador. Repetirla devuelve el mismo
 * resultado exitoso (`yaEstabaAceptada`) sin escribir nada, y dos a la vez dejan una sola membresía: lo
 * resuelve el caso de uso. No sale el id de la persona: la pantalla no lo necesita. Una invitación de OTRA
 * marca que la de la puerta es «no encontrada», igual que una que no existe (sin oráculo).
 */
export async function aceptarInvitacionDeLaSesion(
  d: DependenciasDeSesion,
  entrada: Readonly<{ token: string; sesion: SesionAutenticada; marcaId: MarcaComercialId }>,
): Promise<Respuesta<InvitacionAceptada>> {
  const { token, sesion, marcaId } = entrada;
  if (token === "" || token.length > LARGO_MAXIMO_DEL_TOKEN) {
    return { ok: false, error: errorDeCodigo("INVITACION_NO_ENCONTRADA") };
  }
  try {
    const resultado = await d.casosDeUsoDeIdentidad().aceptarInvitacion({
      token,
      emailAutenticado: sesion.email,
      usuarioAuth: sesion.usuarioAuth,
      // La puerta por la que entró la persona: el caso de uso rechaza una invitación de otra marca.
      marcaDeEntrada: marcaId,
      ahora: d.ahora(),
    });
    return aRespuesta(resultado, d.respuesta, (salida) => ({
      yaEstabaAceptada: salida.yaEstabaAceptada,
      empresas: salida.empresas.map((e) => ({ empresaId: e.empresaId, rol: e.rol })),
    }));
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type PedidoDeAutenticacion = Readonly<{
  /** El host que resolvió la puerta (normalizado): el origen de lo que se le pide a la librería. */
  host: string;
  /** Los encabezados del pedido de la persona: de ahí salen la cookie y los datos para el límite de pedidos. */
  encabezados: Headers;
}>;

/**
 * Los encabezados que la librería necesita de verdad: la cookie y, para su límite de pedidos, la IP y el agente.
 * La IP es SOLO la del encabezado de confianza (`ENCABEZADO_DE_IP`, S3): `x-forwarded-for` ya no se copia. La
 * librería no lo lee (su configuración lista un único encabezado), y copiarlo dejaría a un cambio futuro de
 * configuración confiar sin querer en un valor que el cliente puede mandar.
 */
function encabezadosParaLaLibreria(p: PedidoDeAutenticacion): Headers {
  const salida = new Headers({
    origin: `https://${p.host}`,
    "content-type": "application/json",
  });
  for (const nombre of ["cookie", ENCABEZADO_DE_IP, "user-agent"]) {
    const valor = p.encabezados.get(nombre);
    if (valor !== null) salida.set(nombre, valor);
  }
  return salida;
}

export type CookiesParaAplicar = Readonly<{ cookies: readonly string[] }>;

/**
 * Cierra la sesión: la librería borra la fila (revocación inmediata) y devuelve los `Set-Cookie` que borran
 * la cookie en el navegador. Quien llama (la acción del servidor) los APLICA y vuelve al ingreso.
 */
export async function cerrarSesion(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion,
): Promise<Respuesta<CookiesParaAplicar>> {
  try {
    const respuesta = await d.autenticacion().manejar(
      new Request(`https://${pedido.host}/api/auth/sign-out`, {
        method: "POST",
        headers: encabezadosParaLaLibreria(pedido),
        body: "{}",
      }),
      pedido.host,
    );
    return { ok: true, dato: { cookies: respuesta.headers.getSetCookie() } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type InicioDeIngreso = Readonly<{
  /** A dónde ir (la pantalla de Google), siempre `https:`. */
  url: string;
  /** Las cookies de estado del ingreso (hay que volver con ellas): se aplican antes de redirigir. */
  cookies: readonly string[];
}>;

/**
 * Empieza el ingreso con Google: le pide a la librería la dirección de Google y las cookies del estado del
 * ingreso. `volver` es una ruta propia ya validada (`rutaDeRetorno`).
 */
export async function iniciarIngresoConGoogle(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion & Readonly<{ volver: string }>,
): Promise<Respuesta<InicioDeIngreso>> {
  try {
    const respuesta = await d.autenticacion().manejar(
      new Request(`https://${pedido.host}/api/auth/sign-in/social`, {
        method: "POST",
        headers: encabezadosParaLaLibreria(pedido),
        body: JSON.stringify({
          provider: "google",
          callbackURL: pedido.volver,
          errorCallbackURL: "/ingreso",
        }),
      }),
      pedido.host,
    );
    if (respuesta.status !== 200) {
      return {
        ok: false,
        error: respuestaDeFalla(`el inicio del ingreso respondió ${respuesta.status}`, d.respuesta),
      };
    }
    const cuerpo = (await respuesta.json()) as { url?: unknown };
    const url = typeof cuerpo.url === "string" ? cuerpo.url : "";
    if (!url.startsWith("https://")) {
      return {
        ok: false,
        error: respuestaDeFalla(
          "el inicio del ingreso no devolvió una dirección https",
          d.respuesta,
        ),
      };
    }
    return { ok: true, dato: { url, cookies: respuesta.headers.getSetCookie() } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Atiende el «Seguir» del aviso de sesión (y la renovación silenciosa mientras se usa la pantalla): lee la
 * sesión del pedido, que con el uso se renueva en la base, y devuelve en la RESPUESTA los `Set-Cookie` que
 * la renuevan en el navegador. Un componente de servidor no puede fijar cookies, así que sin esto la cookie
 * moriría a los 15 minutos del ingreso aunque la persona use la aplicación (requisito de W3b). Solo desde el
 * propio origen (el `POST` lo garantiza la ruta). Sin sesión: 401 con el código `SESION_VENCIDA` y nada más.
 */
export async function renovarSesion(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion,
): Promise<Response> {
  const cabeceras = new Headers({
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Content-Type": "application/json",
  });
  const sinPermiso = (codigo: "SIN_PERMISO" | "SESION_VENCIDA") =>
    new Response(JSON.stringify({ codigo }), { status: estadoHttpDe(codigo), headers: cabeceras });
  // Una página de otro sitio no puede mantener viva una sesión que no es suya (P-7).
  if (!origenEsPropio(pedido.encabezados.get("origin"), hostDelPedido(pedido.encabezados))) {
    return sinPermiso("SIN_PERMISO");
  }
  try {
    const sesion = await d.autenticacion().sesionDe({ headers: pedido.encabezados }, pedido.host);
    if (sesion === null) return sinPermiso("SESION_VENCIDA");
    for (const cookie of sesion.cookiesDeRespuesta) cabeceras.append("Set-Cookie", cookie);
    return new Response(JSON.stringify({ venceEn: sesion.venceEn.toISOString() }), {
      status: 200,
      headers: cabeceras,
    });
  } catch (excepcion) {
    const error = aRespuestaDeExcepcion(excepcion, d.respuesta);
    return new Response(
      JSON.stringify(
        error.ok ? {} : { codigo: error.error.codigo, referencia: error.error.referencia },
      ),
      { status: 500, headers: cabeceras },
    );
  }
}
