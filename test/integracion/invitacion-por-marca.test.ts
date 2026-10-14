import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  marcaComercialId,
  personaId,
  sucursalId,
  type MarcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  sucursalDe,
} from "./fixtures-identidad";
import { crearMarca, crearMundoDeMarca } from "./marcas-apoyo";

/**
 * Q1: aceptar una invitación solo desde la puerta de la marca del tenant que invita (marcas y planes,
 * §B.2.4). Un enlace abierto desde el host de OTRA marca se responde exactamente igual que uno que no
 * existe (`INVITACION_NO_ENCONTRADA`: no se revela que existe), no escribe nada y no consume la
 * invitación; desde la puerta correcta sigue siendo idempotente (aceptar dos veces no duplica la
 * membresía) y también lo es en la carrera entre las dos puertas. Base real, roles limitados.
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;

describe.skipIf(base === null)("aceptar una invitación según la marca de entrada", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let tokens: Tokens;
  let casos: CasosDeUsoDeIdentidad;
  const A: MarcaComercialId = MARCA_PRINCIPAL_DE_PRUEBA;
  let B: MarcaComercialId;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    B = marcaComercialId(await crearMarca(dueno));
    tokens = crearTokensHmac(randomBytes(32));
    casos = crearCasosDeUsoDeIdentidad({
      transacciones: entorno,
      tokens,
      reglas: REGLAS_DE_EMPRESA,
    });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const aceptar = (token: string, email: string, marcaDeEntrada: MarcaComercialId) =>
    casos.aceptarInvitacion({
      token,
      emailAutenticado: email,
      usuarioAuth: usuarioDePrueba(email),
      marcaDeEntrada,
      ahora,
    });

  const NO_ENCONTRADA = { ok: false, error: "INVITACION_NO_ENCONTRADA" } as const;

  /** Una empresa activa de la marca A cuyo gerente invita a un email nuevo (con el caso de uso real). */
  const invitacionDeA = async () => {
    const e = await crearEmpresaActiva(entorno);
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    const sucursal = await sucursalDe(dueno, e.empresa);
    const email = emailAlAzar("invitado");
    const r = await casos.invitarUsuario(comoEmpresa(e.empresa, personaId(g.id)), {
      email,
      rol: "OPERADOR",
      sucursales: [sucursalId(sucursal)],
    });
    if (!r.ok) throw new Error(`no se pudo invitar: ${JSON.stringify(r.error)}`);
    return { ...e, email, id: r.valor.invitacionId, token: tokens.derivar(r.valor.invitacionId) };
  };

  /** Todo lo que aceptar podría tocar, para esa empresa y ese email: la «foto» de la base. */
  const foto = async (empresa: string, email: string) =>
    JSON.stringify({
      personas: (await dueno.query("select * from persona where email = $1", [email])).rows,
      membresias: (
        await dueno.query("select * from membresia where empresa_id = $1 order by persona_id", [
          empresa,
        ])
      ).rows,
      asignaciones: (
        await dueno.query(
          "select * from asignacion_sucursal where empresa_id = $1 order by persona_id, sucursal_id",
          [empresa],
        )
      ).rows,
      invitaciones: (
        await dueno.query(
          `select i.* from invitacion i
           where i.id in (select invitacion_id from invitacion_empresa where empresa_id = $1)
           order by i.id`,
          [empresa],
        )
      ).rows,
      empresa: (await dueno.query("select estado, version from empresa where id = $1", [empresa]))
        .rows,
      auditoria: (
        await dueno.query("select id from auditoria_empresa where empresa_id = $1 order by id", [
          empresa,
        ])
      ).rows,
    });

  const membresiasDe = async (empresa: string, email: string) =>
    (
      await dueno.query<{ n: string }>(
        `select count(*) as n from membresia m join persona p on p.id = m.persona_id
         where m.empresa_id = $1 and p.email = $2`,
        [empresa, email],
      )
    ).rows[0]?.n;

  it("por la puerta de la marca del tenant se acepta (y lo mismo con la marca B para un tenant de B)", async () => {
    const i = await invitacionDeA();
    const r = await aceptar(i.token, i.email, A);
    expect(r).toMatchObject({ ok: true, valor: { yaEstabaAceptada: false } });
    expect(await membresiasDe(i.empresa, i.email)).toBe("1");

    // Simétrico: una invitación de un tenant de la marca B se acepta por B.
    const mundoB = await crearMundoDeMarca(dueno, { marca: B });
    const emailB = emailAlAzar("invitado-b");
    const emitido = tokens.emitir();
    const invB = await crearInvitacionDeBase(dueno, {
      tenant: mundoB.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      email: emailB,
    });
    await incluirEmpresa(dueno, invB, mundoB.empresa, "OPERADOR");
    expect(await aceptar(emitido.token, emailB, A)).toEqual(NO_ENCONTRADA);
    expect(await membresiasDe(mundoB.empresa, emailB)).toBe("0");
    expect(await aceptar(emitido.token, emailB, B)).toMatchObject({
      ok: true,
      valor: { yaEstabaAceptada: false },
    });
    expect(await membresiasDe(mundoB.empresa, emailB)).toBe("1");
  });

  it("desde la puerta de OTRA marca (o de una que no existe) responde igual que un token inexistente, no escribe nada y no consume la invitación", async () => {
    const i = await invitacionDeA();
    const antes = await foto(i.empresa, i.email);
    const inexistente = await aceptar(randomUUID(), i.email, A);
    expect(inexistente).toEqual(NO_ENCONTRADA);
    for (const marca of [B, marcaComercialId(randomUUID())]) {
      for (let repeticion = 0; repeticion < 3; repeticion++) {
        expect(await aceptar(i.token, i.email, marca)).toEqual(inexistente);
      }
    }
    // Ni siquiera con un email distinto o sin sesión verificada se distingue de la inexistente.
    expect(await aceptar(i.token, "otro@prueba.test", B)).toEqual(inexistente);
    expect(
      await casos.aceptarInvitacion({
        token: i.token,
        emailAutenticado: null,
        usuarioAuth: usuarioDePrueba("sin-sesion"),
        marcaDeEntrada: B,
        ahora,
      }),
    ).toEqual(inexistente);
    expect(await foto(i.empresa, i.email)).toBe(antes);
    // La invitación sigue intacta: desde la puerta correcta se acepta.
    expect(await aceptar(i.token, i.email, A)).toMatchObject({
      ok: true,
      valor: { yaEstabaAceptada: false },
    });
    expect(await membresiasDe(i.empresa, i.email)).toBe("1");
  });

  it("una invitación ya aceptada tampoco se reconoce desde la puerta de otra marca (sin oráculo)", async () => {
    const i = await invitacionDeA();
    const primera = await aceptar(i.token, i.email, A);
    expect(primera.ok).toBe(true);
    expect(await aceptar(i.token, i.email, B)).toEqual(NO_ENCONTRADA);
  });

  it("idempotente por la puerta correcta: aceptar dos veces devuelve lo mismo y no duplica la membresía", async () => {
    const i = await invitacionDeA();
    const primera = await aceptar(i.token, i.email, A);
    const segunda = await aceptar(i.token, i.email, A);
    if (!primera.ok || !segunda.ok) throw new Error("las dos aceptaciones debían ser exitosas");
    expect(primera.valor.yaEstabaAceptada).toBe(false);
    expect(segunda.valor).toEqual({ ...primera.valor, yaEstabaAceptada: true });
    expect(await membresiasDe(i.empresa, i.email)).toBe("1");
    const { rows } = await dueno.query<{ n: string }>(
      "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'INVITACION_ACEPTADA'",
      [i.empresa],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("el alta del gerente desde otra puerta no activa la empresa; desde la suya sí", async () => {
    const e = await crearEmpresaEnAlta(entorno);
    const email = emailAlAzar("gerente");
    const emitido = tokens.emitir();
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: e.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      tipo: "ALTA_GERENTE",
      email,
    });
    await incluirEmpresa(dueno, inv, e.empresa, "GERENTE");
    const antes = await foto(e.empresa, email);
    expect(await aceptar(emitido.token, email, B)).toEqual(NO_ENCONTRADA);
    expect(await foto(e.empresa, email)).toBe(antes);
    expect(
      (
        await dueno.query<{ estado: string }>("select estado from empresa where id = $1", [
          e.empresa,
        ])
      ).rows[0]?.estado,
    ).toBe("PROVISIONING");
    expect(await aceptar(emitido.token, email, A)).toMatchObject({ ok: true });
    expect(
      (
        await dueno.query<{ estado: string }>("select estado from empresa where id = $1", [
          e.empresa,
        ])
      ).rows[0]?.estado,
    ).toBe("ACTIVE");
  });

  it("simultáneo: el mismo enlace por las dos puertas a la vez; las de B dan NO_ENCONTRADA siempre, las de A tienen éxito y la membresía es una", async () => {
    const i = await invitacionDeA();
    const puertas = [A, B, A, B, B, A];
    const barrera = crearBarrera(puertas.length);
    const resultados = await Promise.all(
      puertas.map(async (marca) => {
        await barrera();
        return aceptar(i.token, i.email, marca);
      }),
    );
    resultados.forEach((r, n) => {
      if (puertas[n] === A) expect(r.ok, `puerta A, intento ${n}`).toBe(true);
      else expect(r, `puerta B, intento ${n}`).toEqual(NO_ENCONTRADA);
    });
    const nuevas = resultados.filter((r) => r.ok && !r.valor.yaEstabaAceptada);
    expect(nuevas).toHaveLength(1);
    expect(await membresiasDe(i.empresa, i.email)).toBe("1");
  });
});
