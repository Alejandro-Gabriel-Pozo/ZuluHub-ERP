import { randomBytes } from "node:crypto";
import pg from "pg";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { DependenciasDeSesion } from "../../src/composicion/sesion-y-empresa";
import { crearConsultasDeEmpresas } from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeSesion,
} from "../../src/modulos/identidad/publico";
import {
  marcaComercialId,
  type MarcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import type { SesionAutenticada } from "../../src/puertos/autenticacion";
import type { Tokens } from "../../src/puertos/tokens";
import { vincularDeBase } from "./autenticacion-apoyo";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type PerfilDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  type InvitacionDePrueba,
  type RolDePrueba,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { crearMarca, crearMundoDeMarca, marcaPrincipal } from "./marcas-apoyo";

/**
 * El «mundo web» de las pruebas de W5: una base propia con DOS marcas (A y B, cada una con su host de
 * aplicación), la autenticación REAL (Better Auth con el proveedor local de Google, sin red) y los casos
 * de uso y consultas reales de identidad y empresas. Las sesiones no se inventan: se ingresa de verdad por
 * el proveedor local y la sesión queda en la tabla de la librería con el host donde nació. No hay Google
 * real en el CI.
 */
export const HOST_A = "app.hoteldellago.test";
export const HOST_B = "app.panaderialospinos.test";

export type MundoWeb = Readonly<{
  propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  dueno: pg.Client;
  proveedor: ProveedorLocal;
  auth: AutenticacionDePrueba;
  tokens: Tokens;
  marcaA: MarcaComercialId;
  marcaB: MarcaComercialId;
  dependencias: DependenciasDeSesion;
  /** Lo que el servidor mandó a su registro (con detalle); nunca sale en una respuesta. */
  registros: string[];
  cerrar(): Promise<void>;
}>;

export async function armarMundoWeb(base: BaseDePruebas): Promise<MundoWeb> {
  const propia = await crearBaseAparte(base);
  const entorno = crearEntornoDePrueba(propia.base, 10);
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const proveedor = await levantarProveedorLocal();
  const auth = armarAutenticacionDePrueba(propia.base, proveedor);
  const tokens = crearTokensHmac(randomBytes(32));
  const principal = await marcaPrincipal(dueno);
  const marcaA = marcaComercialId(await crearMarca(dueno, { padre: principal }));
  const marcaB = marcaComercialId(await crearMarca(dueno, { padre: principal }));
  const registros: string[] = [];
  const dependencias: DependenciasDeSesion = {
    autenticacion: () => auth.autenticacion,
    consultasDeSesion: () => crearConsultasDeSesion({ transacciones: entorno }),
    casosDeUsoDeIdentidad: () =>
      crearCasosDeUsoDeIdentidad({ transacciones: entorno, tokens, reglas: REGLAS_DE_EMPRESA }),
    consultasDeEmpresas: () =>
      crearConsultasDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA }),
    ahora: () => new Date(),
    respuesta: { registrar: (d) => registros.push(d) },
  };
  return {
    propia,
    dueno,
    proveedor,
    auth,
    tokens,
    marcaA,
    marcaB,
    dependencias,
    registros,
    async cerrar() {
      await auth.cerrar();
      await entorno.cerrar();
      await dueno.end();
      await proveedor.cerrar();
      await propia.destruir();
    },
  };
}

export type Ingresado = Readonly<{
  navegador: Navegador;
  perfil: PerfilDePrueba;
  sesion: SesionAutenticada;
}>;

/** Ingresa de verdad con Google (proveedor local) en `host` y devuelve la sesión que ve el servidor. */
export async function ingresarEn(
  mundo: MundoWeb,
  host: string,
  perfil: PerfilDePrueba = perfilAlAzar(),
  navegador: Navegador = new Navegador(),
): Promise<Ingresado> {
  const r = await navegador.ingresarConGoogle(
    mundo.auth.autenticacion,
    host,
    mundo.proveedor,
    perfil,
  );
  if (r.estado !== 302) throw new Error(`el ingreso de prueba dio ${r.estado}`);
  const sesion = await mundo.auth.autenticacion.sesionDe(navegador.pedidoDe(host), host);
  if (sesion === null) throw new Error("el ingreso de prueba no dejó sesión");
  return { navegador, perfil, sesion };
}

/** La persona del email de la sesión, ya vinculada con su usuario (lo que deja aceptar una invitación). */
export async function personaVinculada(
  mundo: MundoWeb,
  sesion: SesionAutenticada,
): Promise<string> {
  const persona = await crearPersonaDeBase(mundo.dueno, sesion.email);
  await vincularDeBase(mundo.dueno, persona.id, sesion.usuarioAuth);
  return persona.id;
}

/** Una empresa activa en esa marca con la persona de miembro. */
export async function empresaDeLaMarca(
  mundo: MundoWeb,
  marca: MarcaComercialId,
  persona: string,
  rol: RolDePrueba = "GERENTE",
  opciones: { tenant?: string; estado?: "ACTIVE" | "PROVISIONING" | "SUSPENDED" } = {},
): Promise<{ empresa: string; tenant: string }> {
  const mundoDeMarca = await crearMundoDeMarca(mundo.dueno, {
    marca,
    ...(opciones.tenant === undefined ? {} : { tenant: opciones.tenant }),
    ...(opciones.estado === undefined ? {} : { estado: opciones.estado }),
  });
  await crearMembresiaDeBase(mundo.dueno, mundoDeMarca.empresa, persona, rol);
  return { empresa: mundoDeMarca.empresa, tenant: mundoDeMarca.tenant };
}

/** Una invitación pendiente a esas empresas para ese email, con su token en claro. */
export async function invitar(
  mundo: MundoWeb,
  tenant: string,
  empresas: readonly { empresa: string; rol?: RolDePrueba }[],
  email: string,
  tipo: "ALTA_GERENTE" | "USUARIO" = "USUARIO",
): Promise<{ token: string; invitacion: InvitacionDePrueba }> {
  const emitido = mundo.tokens.emitir();
  const invitacion = await crearInvitacionDeBase(mundo.dueno, {
    tenant,
    id: emitido.invitacionId,
    tokenHash: emitido.tokenHash,
    email,
    tipo,
  });
  for (const e of empresas)
    await incluirEmpresa(mundo.dueno, invitacion, e.empresa, e.rol ?? "OPERADOR");
  return { token: emitido.token, invitacion };
}
