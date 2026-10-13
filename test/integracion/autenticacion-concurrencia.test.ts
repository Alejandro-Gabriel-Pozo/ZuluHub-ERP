import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import type { UsuarioAuthId } from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import { usuarioAlAzar } from "../utilidades/usuarios";
import {
  AHORA_DE_PRUEBA,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  emailAlAzar,
  incluirEmpresa,
  type RolDePrueba,
} from "./fixtures-identidad";

/**
 * Autenticación (W3a), concurrencia REAL de `aceptarInvitacion` con usuario: cada prueba lanza varias
 * transacciones a la vez (`Promise.all`) y, con una barrera dentro de la transacción, fuerza que TODAS hayan
 * leído el estado antes de que cualquiera escriba. Después mira la base: una sola persona, un solo vínculo, ni
 * una membresía ni una constancia duplicada, y el perdedor recibe el error TIPADO (nunca una excepción ni un
 * estado a medias). Lo que se garantiza es la regla de negocio, no que nadie pierda nunca por agotar los
 * reintentos (`ConcurrenciaAgotada` es una respuesta legítima bajo carga: «reintentá»).
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;
const RONDAS = 8;

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;
type Resultado = Awaited<ReturnType<CasosDeUsoDeIdentidad["aceptarInvitacion"]>>;

const esAgotada = (r: Resultado): boolean =>
  !r.ok &&
  typeof r.error === "object" &&
  "tipo" in r.error &&
  r.error.tipo === "ConcurrenciaAgotada";

describe.skipIf(base === null)(
  "autenticación: concurrencia de aceptarInvitacion con usuario",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let tokens: Tokens;
    let casos: CasosDeUsoDeIdentidad;
    let barrera: () => Promise<void> = () => Promise.resolve();
    let gancho: Gancho = (tx) => tx;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
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

    /** Prepara la ronda: `participantes` transacciones esperan tras leer la invitación. */
    const ronda = (participantes: number) => {
      barrera = crearBarrera(participantes);
      gancho = (tx, esperar) => {
        let primera = true;
        const original = tx.invitaciones;
        return {
          ...tx,
          invitaciones: {
            ...original,
            obtenerPorHash: async (hash: string) => {
              const r = await original.obtenerPorHash(hash);
              if (primera) {
                primera = false;
                await esperar();
              }
              return r;
            },
          },
        };
      };
    };

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const contar = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

    const invitacion = async (
      empresas: { e: EmpresaDePrueba; rol: RolDePrueba }[],
      email = emailAlAzar("multi"),
    ) => {
      const emitido = tokens.emitir();
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: empresas[0]?.e.tenant as string,
        id: emitido.invitacionId,
        tokenHash: emitido.tokenHash,
        email,
      });
      for (const { e, rol } of empresas) await incluirEmpresa(dueno, inv, e.empresa, rol);
      return { inv, email, token: emitido.token };
    };

    const aceptar = (token: string, email: string, usuarioAuth: UsuarioAuthId) =>
      casos.aceptarInvitacion({ token, emailAutenticado: email, usuarioAuth, ahora });

    const personasDe = (email: string) =>
      filas<{ id: string; usuario_auth_id: string | null }>(
        "select id, usuario_auth_id from persona where email = $1",
        [email],
      );
    const vinculadas = (empresa: string) =>
      contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'PERSONA_VINCULADA'",
        [empresa],
      );

    // =============================================================================================
    it("A1: dos aceptaciones simultáneas de la misma invitación con el MISMO usuario: una gana, la otra ve el resultado, y el vínculo y las constancias no se duplican", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e1 = await crearEmpresaActiva(entorno);
        const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
        const e3 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
        const { email, token } = await invitacion([
          { e: e1, rol: "OPERADOR" },
          { e: e2, rol: "ADMINISTRADOR" },
          { e: e3, rol: "OPERADOR" },
        ]);
        const usuario = usuarioAlAzar();
        ronda(2);

        const [x, y] = await Promise.all([
          aceptar(token, email, usuario),
          aceptar(token, email, usuario),
        ]);

        expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
        expect(
          [x, y].filter((r) => r.ok && r.valor.yaEstabaAceptada),
          `ronda ${n}: una gana, la otra ve el resultado`,
        ).toHaveLength(1);
        if (x.ok && y.ok) expect(x.valor.personaId).toBe(y.valor.personaId);
        const personas = await personasDe(email);
        expect(personas, `ronda ${n}`).toEqual([{ id: personas[0]?.id, usuario_auth_id: usuario }]);
        expect(
          await contar("select count(*) as n from membresia where persona_id = $1", [
            personas[0]?.id,
          ]),
        ).toBe(3);
        for (const e of [e1, e2, e3]) expect(await vinculadas(e.empresa), `ronda ${n}`).toBe(1);
      }
    });

    it("A2: tres aceptaciones simultáneas con el mismo usuario: ninguna falla y todo queda una sola vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const { empresa, email, token } = await (async () => {
          const e = await crearEmpresaEnAlta(entorno);
          const emitido = tokens.emitir();
          const correo = emailAlAzar("gerente");
          const inv = await crearInvitacionDeBase(dueno, {
            tenant: e.tenant,
            id: emitido.invitacionId,
            tokenHash: emitido.tokenHash,
            tipo: "ALTA_GERENTE",
            email: correo,
          });
          await incluirEmpresa(dueno, inv, e.empresa, "GERENTE");
          return { empresa: e, email: correo, token: emitido.token };
        })();
        const usuario = usuarioAlAzar();
        ronda(3);

        const r = await Promise.all([
          aceptar(token, email, usuario),
          aceptar(token, email, usuario),
          aceptar(token, email, usuario),
        ]);

        expect(
          r.map((x) => x.ok),
          `ronda ${n}`,
        ).toEqual([true, true, true]);
        expect(r.filter((x) => x.ok && x.valor.yaEstabaAceptada)).toHaveLength(2);
        expect(
          await filas("select rol, activo from membresia where empresa_id = $1", [empresa.empresa]),
        ).toEqual([{ rol: "GERENTE", activo: true }]);
        expect(await vinculadas(empresa.empresa)).toBe(1);
        expect(await personasDe(email)).toHaveLength(1);
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'EMPRESA_ACTIVADA'",
            [empresa.empresa],
          ),
        ).toBe(1);
      }
    });

    it("A3: dos aceptaciones simultáneas de la misma invitación con usuarios DISTINTOS: gana uno, el otro recibe PERSONA_DE_OTRO_USUARIO, y no se duplica nada", async () => {
      let rechazos = 0;
      for (let n = 0; n < RONDAS; n++) {
        const e1 = await crearEmpresaActiva(entorno);
        const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
        const { email, token } = await invitacion([
          { e: e1, rol: "OPERADOR" },
          { e: e2, rol: "OPERADOR" },
        ]);
        const u1 = usuarioAlAzar();
        const u2 = usuarioAlAzar();
        ronda(2);

        const [x, y] = await Promise.all([aceptar(token, email, u1), aceptar(token, email, u2)]);

        const intentos = [
          [x, u1],
          [y, u2],
        ] as const;
        const ganadores = intentos.filter(([r]) => r.ok);
        if (ganadores.length === 2 || intentos.some(([r]) => esAgotada(r))) {
          // Bajo una carga extrema el adaptador puede agotar los reintentos: eso no es una violación.
          expect(ganadores.length, `ronda ${n}: nunca dos ganadores con usuarios distintos`).toBe(
            1,
          );
          continue;
        }
        expect(ganadores, `ronda ${n}: exactamente un ganador`).toHaveLength(1);
        const perdedor = intentos.find(([r]) => !r.ok);
        expect(perdedor?.[0]).toEqual({ ok: false, error: "PERSONA_DE_OTRO_USUARIO" });
        rechazos += 1;
        const personas = await personasDe(email);
        expect(personas, `ronda ${n}`).toEqual([
          { id: personas[0]?.id, usuario_auth_id: ganadores[0]?.[1] },
        ]);
        expect(
          await contar("select count(*) as n from membresia where persona_id = $1", [
            personas[0]?.id,
          ]),
        ).toBe(2);
        for (const e of [e1, e2]) expect(await vinculadas(e.empresa)).toBe(1);
        expect(
          await filas("select estado, aceptada_por from invitacion where email = $1", [email]),
        ).toEqual([{ estado: "ACEPTADA", aceptada_por: personas[0]?.id }]);
      }
      expect(rechazos, "la regla se ejerció en la mayoría de las rondas").toBeGreaterThan(0);
    });

    it("A4: dos invitaciones DISTINTAS al mismo email aceptadas a la vez por el mismo usuario: la persona se vincula una sola vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e1 = await crearEmpresaActiva(entorno);
        const e2 = await crearEmpresaActiva(entorno);
        const email = emailAlAzar("doble");
        const a = await invitacion([{ e: e1, rol: "OPERADOR" }], email);
        const b = await invitacion([{ e: e2, rol: "OPERADOR" }], email);
        const usuario = usuarioAlAzar();
        // La barrera espera la primera lectura de cada transacción (de la invitación que sea).
        ronda(2);

        const [x, y] = await Promise.all([
          aceptar(a.token, email, usuario),
          aceptar(b.token, email, usuario),
        ]);

        if (esAgotada(x) || esAgotada(y)) continue;
        expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
        const personas = await personasDe(email);
        expect(personas, `ronda ${n}`).toEqual([{ id: personas[0]?.id, usuario_auth_id: usuario }]);
        expect(
          await contar("select count(*) as n from membresia where persona_id = $1", [
            personas[0]?.id,
          ]),
        ).toBe(2);
        // Una sola constancia de vínculo en total, aunque hayan sido dos invitaciones.
        expect((await vinculadas(e1.empresa)) + (await vinculadas(e2.empresa))).toBe(1);
      }
    });

    it("A5: un usuario que acepta a la vez dos invitaciones para DOS emails distintos se queda con UNA persona; la otra aceptación recibe USUARIO_DE_OTRA_PERSONA y no deja nada", async () => {
      let rechazos = 0;
      for (let n = 0; n < RONDAS; n++) {
        const e1 = await crearEmpresaActiva(entorno);
        const e2 = await crearEmpresaActiva(entorno);
        const a = await invitacion([{ e: e1, rol: "OPERADOR" }]);
        const b = await invitacion([{ e: e2, rol: "OPERADOR" }]);
        const usuario = usuarioAlAzar();
        ronda(2);

        const [x, y] = await Promise.all([
          aceptar(a.token, a.email, usuario),
          aceptar(b.token, b.email, usuario),
        ]);

        if (esAgotada(x) || esAgotada(y)) continue;
        const oks = [x, y].filter((r) => r.ok);
        expect(oks, `ronda ${n}: exactamente una`).toHaveLength(1);
        const fallo = [x, y].find((r) => !r.ok);
        expect(fallo).toEqual({ ok: false, error: "USUARIO_DE_OTRA_PERSONA" });
        rechazos += 1;
        expect(
          await contar("select count(*) as n from persona where usuario_auth_id = $1", [usuario]),
        ).toBe(1);
        // La persona del perdedor no existe (la transacción entera se revirtió) y su invitación sigue pendiente.
        const personas = (await personasDe(a.email)).length + (await personasDe(b.email)).length;
        expect(personas).toBe(1);
        expect(
          await contar(
            "select count(*) as n from invitacion where id = any($1) and estado = 'PENDIENTE'",
            [[a.inv.id, b.inv.id]],
          ),
        ).toBe(1);
      }
      expect(rechazos).toBeGreaterThan(0);
    });
  },
);
