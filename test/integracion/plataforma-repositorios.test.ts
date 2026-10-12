import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  empresaId,
  invitacionId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
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
  aceptarDeBase,
  incluirEmpresa,
  revocarDeBase,
} from "./fixtures-identidad";
import {
  adminInexistente,
  comoAdmin,
  comoAdminDe,
  comoSistema,
  comoSoporte,
  crearAdminDeBase,
  esperarAccesoDenegado,
  esperarError,
} from "./plataforma-apoyo";

/**
 * H5 plataforma, tramo P4: los métodos de repositorio que usa plataforma (`sembrar`,
 * `listarAltasVencidas`, `obtenerAltaVigente`, `cambiarActivoGlobal`) contra una base real, con los
 * actores ADMIN, SOPORTE, `sistema`, un administrador dado de baja y uno inexistente. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("plataforma: repositorios contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let bajaId: ReturnType<typeof adminInexistente>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    bajaId = (await crearAdminDeBase(dueno, { activo: false })).id;
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async (texto: string, parametros: unknown[] = []) =>
    (await dueno.query<Record<string, unknown>>(texto, parametros)).rows;
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas(texto, parametros))[0]?.["n"]);

  /** Los actores que no pueden escribir estructura: soporte, `sistema`, uno de baja y uno inexistente. */
  const sinPermisoDeEscritura = () =>
    [
      ["soporte", comoSoporte()],
      ["sistema", comoSistema()],
      ["de baja", comoAdminDe(bajaId)],
      ["inexistente", comoAdminDe(adminInexistente())],
    ] as const;

  // ===========================================================================================
  // sembrar
  // ===========================================================================================
  describe("sucursales.sembrar", () => {
    const sembrar = (contexto: ReturnType<typeof comoAdmin>, empresa: EmpresaId, nombre: string) =>
      entorno.ejecutar({ contexto }, async ({ sucursales }) => {
        await sucursales.sembrar(empresa, nombre);
        return ok(null);
      });
    const sucursalesDe = (empresa: string) =>
      filas("select nombre, activa, version from sucursal where empresa_id = $1 order by nombre", [
        empresa,
      ]);

    it("el administrador siembra la sucursal inicial de una empresa en alta, sin leerla de vuelta", async () => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      expect(await sembrar(comoAdmin(), empresa, "Casa central")).toEqual({
        ok: true,
        valor: null,
      });
      expect(await sucursalesDe(empresa)).toEqual([
        { nombre: "Casa central", activa: true, version: 1 },
      ]);
    });

    it("`crear` (con RETURNING) no le sirve a plataforma: no tiene SELECT sobre sucursal; por eso existe `sembrar`", async () => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async ({ sucursales }) =>
        ok(await sucursales.crear(empresa, "Casa central")),
      );
      esperarAccesoDenegado(r);
      expect(await sucursalesDe(empresa)).toEqual([]);
    });

    it("soporte, `sistema`, un administrador de baja y uno inexistente no siembran nada", async () => {
      for (const [quien, contexto] of sinPermisoDeEscritura()) {
        const { empresa } = await crearEmpresaEnAlta(entorno);
        esperarAccesoDenegado(await sembrar(contexto, empresa, "Casa central"));
        expect(await sucursalesDe(empresa), quien).toEqual([]);
      }
    });

    it("un nombre repetido (sin distinguir mayúsculas) es unicidad; uno inválido, check; una empresa que no existe, referencia", async () => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      await sembrar(comoAdmin(), empresa, "Casa central");
      esperarError(
        await sembrar(comoAdmin(), empresa, "CASA CENTRAL"),
        "Unicidad",
        "sucursal_nombre_uk",
      );
      esperarError(await sembrar(comoAdmin(), empresa, ""), "Check", "sucursal_nombre_ck");
      esperarError(await sembrar(comoAdmin(), empresa, " Norte"), "Check", "sucursal_nombre_ck");
      esperarError(
        await sembrar(comoAdmin(), empresaId(randomUUID()), "Casa central"),
        "Referencia",
        "sucursal_empresa_id_fkey",
      );
      expect(await sucursalesDe(empresa)).toHaveLength(1);
    });

    it("atómico: si algo falla después de sembrar, no queda la sucursal", async () => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      await expect(
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ sucursales }) => {
          await sucursales.sembrar(empresa, "Casa central");
          throw new Error("falla forzada");
        }),
      ).rejects.toThrow("falla forzada");
      expect(await sucursalesDe(empresa)).toEqual([]);
    });

    it("dos siembras simultáneas del mismo nombre: gana una sola, la otra es unicidad", async () => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      const barrera = crearBarrera(2);
      const intento = () =>
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ sucursales }) => {
          await barrera();
          await sucursales.sembrar(empresa, "Casa central");
          return ok(null);
        });
      const rs = await Promise.all([intento(), intento()]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      esperarError(
        rs.find((r) => !r.ok)!,
        "Unicidad",
        "sucursal_nombre_uk",
      );
      expect(await sucursalesDe(empresa)).toHaveLength(1);
    });
  });

  // ===========================================================================================
  // listarAltasVencidas
  // ===========================================================================================
  describe("empresas.listarAltasVencidas", () => {
    // Fechas de 2001: nada de lo que crean los demás tests (que usan "ahora") entra en la lista.
    const T = new Date("2001-06-01T12:00:00.000Z");
    const ms = (n: number) => new Date(T.getTime() + n);
    const DIA = 86_400_000;

    const conFecha = async (empresa: EmpresaId, cuando: Date) => {
      await dueno.query("update empresa set creado_en = $2 where id = $1", [empresa, cuando]);
    };
    const enAltaCon = async (cuando: Date) => {
      const { empresa } = await crearEmpresaEnAlta(entorno);
      await conFecha(empresa, cuando);
      return empresa;
    };
    const listar = (contexto: ReturnType<typeof comoAdmin>, hasta: Date, limite = 100) =>
      entorno.ejecutar({ contexto, soloLectura: true }, async ({ empresas }) =>
        ok(await empresas.listarAltasVencidas(hasta, limite)),
      );
    const ids = async (hasta: Date, limite = 100, contexto = comoAdmin()) => {
      const r = await listar(contexto, hasta, limite);
      if (!r.ok) throw new Error(`no se pudo listar: ${JSON.stringify(r.error)}`);
      return r.valor.map((a) => a.empresa.id);
    };

    let muyVieja: EmpresaId;
    let uno: EmpresaId;
    let justo: EmpresaId;
    let despues: EmpresaId;
    // Seis con la misma fecha: sin desempate por id, que salgan ordenadas por casualidad es 1 en 720.
    const empatadas: EmpresaId[] = [];
    let activa: EmpresaId;
    let suspendida: EmpresaId;
    let cancelada: EmpresaId;

    beforeAll(async () => {
      if (base === null) return;
      muyVieja = await enAltaCon(ms(-3 * DIA));
      uno = await enAltaCon(ms(-1));
      justo = await enAltaCon(ms(0));
      despues = await enAltaCon(ms(1));
      for (let i = 0; i < 6; i++) empatadas.push(await enAltaCon(ms(-2 * DIA)));
      // Viejas pero que ya no están en alta: no se listan.
      activa = (await crearEmpresaActiva(entorno)).empresa;
      suspendida = (await crearEmpresaActiva(entorno)).empresa;
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where id = $1",
        [suspendida],
      );
      cancelada = (await crearEmpresaEnAlta(entorno)).empresa;
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'x' where id = $1",
        [cancelada],
      );
      for (const e of [activa, suspendida, cancelada]) await conFecha(e, ms(-5 * DIA));
    });

    it("el límite es INCLUSIVO: `creado_en <= hasta` entra; un milisegundo después, no", async () => {
      const r = await ids(T);
      expect(r).toContain(justo);
      expect(r).toContain(uno);
      expect(r).not.toContain(despues);
      expect(await ids(ms(1))).toContain(despues);
      expect(await ids(ms(-1))).not.toContain(justo);
      expect(await ids(ms(-1))).toContain(uno);
      expect(await ids(ms(-2))).not.toContain(uno);
    });

    it("solo las que siguen en alta (PROVISIONING), de la más vieja a la más nueva y con desempate por id", async () => {
      expect(await ids(T)).toEqual([muyVieja, ...[...empatadas].sort(), uno, justo]);
      for (const fuera of [activa, suspendida, cancelada]) {
        expect(await ids(T)).not.toContain(fuera);
      }
    });

    it("respeta el límite y trae la empresa completa con su fecha de creación", async () => {
      expect(await ids(T, 1)).toEqual([muyVieja]);
      expect(await ids(T, 3)).toHaveLength(3);
      const r = await listar(comoAdmin(), T, 1);
      expect(r.ok).toBe(true);
      const alta = r.ok ? r.valor[0] : undefined;
      expect(alta?.creadoEn).toEqual(ms(-3 * DIA));
      expect(alta?.empresa.id).toBe(muyVieja);
      expect(alta?.empresa.estado).toBe("PROVISIONING");
      expect(alta?.empresa.motivoEstado).toBeNull();
      // La versión es la de la fila (el armado de la prueba la actualizó para fijar la fecha).
      const [fila] = await filas("select version from empresa where id = $1", [muyVieja]);
      expect(alta?.empresa.version).toBe(fila?.["version"]);
    });

    it("rechaza un límite que no es un entero mayor o igual a 1 y una fecha inválida", async () => {
      for (const malo of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(listar(comoAdmin(), T, malo), String(malo)).rejects.toThrow(
          `limite debe ser un entero mayor o igual a 1 (llegó ${malo})`,
        );
      }
      await expect(listar(comoAdmin(), new Date("no es una fecha"))).rejects.toThrow(
        "creadasHasta no es una fecha válida",
      );
    });

    it("la lee cualquier actor vigente (administrador, soporte, `sistema`); uno de baja o inexistente no ve nada", async () => {
      const esperado = await ids(T);
      expect(esperado.length).toBeGreaterThan(0);
      for (const contexto of [comoSoporte(), comoSistema()]) {
        expect(await ids(T, 100, contexto)).toEqual(esperado);
      }
      for (const contexto of [comoAdminDe(bajaId), comoAdminDe(adminInexistente())]) {
        expect(await ids(T, 100, contexto)).toEqual([]);
      }
    });

    it("el barrido es repetible: una vez cancelada, el alta no vuelve a aparecer", async () => {
      const vencida = await enAltaCon(ms(-10 * DIA));
      expect(await ids(T)).toContain(vencida);
      const cancelar = () =>
        entorno.ejecutar({ contexto: comoSistema() }, async ({ empresas }) => {
          const actual = await empresas.obtener(vencida);
          if (actual === null) throw new Error("no existe");
          return ok(
            await empresas.cambiarEstado(vencida, actual.version, {
              estado: "CANCELLED",
              motivoEstado: "ALTA_VENCIDA",
            }),
          );
        });
      const r = await cancelar();
      expect(r.ok && r.valor.ok).toBe(true);
      expect(await ids(T)).not.toContain(vencida);
      expect(await ids(T)).toEqual(await ids(T));
    });
  });

  // ===========================================================================================
  // obtenerAltaVigente
  // ===========================================================================================
  describe("invitaciones.obtenerAltaVigente", () => {
    const leer = (contexto: ReturnType<typeof comoAdmin>, empresa: EmpresaId) =>
      entorno.ejecutar({ contexto, soloLectura: true }, async ({ invitaciones }) =>
        ok(await invitaciones.obtenerAltaVigente(empresa)),
      );
    const alta = async (
      e: { tenant: string; empresa: string },
      datos: { emitidaEn: Date; email?: string; id?: string },
    ) => {
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: e.tenant,
        tipo: "ALTA_GERENTE",
        emitidaEn: datos.emitidaEn,
        venceEn: new Date(datos.emitidaEn.getTime() + 86_400_000),
        ...(datos.email === undefined ? {} : { email: datos.email }),
        ...(datos.id === undefined ? {} : { id: datos.id }),
      });
      await incluirEmpresa(dueno, inv, e.empresa, "GERENTE");
      return inv;
    };
    const t0 = new Date("2026-10-10T12:00:00Z");
    const mas = (horas: number) => new Date(t0.getTime() + horas * 3_600_000);

    it("una empresa que nunca tuvo alta: null", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      expect(await leer(comoAdmin(), e.empresa)).toEqual({ ok: true, valor: null });
    });

    it("una alta pendiente: la invitación con su empresa y el rol GERENTE, sin sucursales", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const inv = await alta(e, { emitidaEn: t0, email: "gerente@prueba.test" });
      const r = await leer(comoAdmin(), e.empresa);
      expect(r).toEqual({
        ok: true,
        valor: {
          id: invitacionId(inv.id),
          tenantId: e.tenant,
          tipo: "ALTA_GERENTE",
          email: "gerente@prueba.test",
          estado: "PENDIENTE",
          emitidaEn: t0,
          venceEn: mas(24),
          empresas: [{ empresaId: e.empresa, rol: "GERENTE", sucursales: [] }],
          aceptadaPor: null,
          reemplazadaPor: null,
          version: 1,
        },
      });
    });

    it("devuelve la ÚLTIMA aunque la anterior siga a la vista: la cadena de reenvíos termina en la reemplazante", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const primera = await alta(e, { emitidaEn: t0 });
      await revocarDeBase(dueno, primera, "REENVIADA");
      const segunda = await alta(e, { emitidaEn: mas(5) });
      await dueno.query("update invitacion set reemplazada_por = $2 where id = $1", [
        primera.id,
        segunda.id,
      ]);
      const r = await leer(comoAdmin(), e.empresa);
      expect(r.ok && r.valor?.id).toBe(segunda.id);
      expect(r.ok && r.valor?.estado).toBe("PENDIENTE");
      expect(r.ok && r.valor?.reemplazadaPor).toBeNull();
    });

    it("una revocada sin reemplazo y una aceptada también se devuelven, con su estado", async () => {
      const revocada = await crearEmpresaEnAlta(entorno);
      const inv = await alta(revocada, { emitidaEn: t0 });
      await revocarDeBase(dueno, inv, "REVOCADA_POR_PLATAFORMA");
      const r1 = await leer(comoAdmin(), revocada.empresa);
      expect(r1.ok && r1.valor).toMatchObject({
        id: inv.id,
        estado: "REVOCADA",
        reemplazadaPor: null,
      });

      const aceptada = await crearEmpresaEnAlta(entorno);
      const email = emailAlAzar("gerente");
      const inv2 = await alta(aceptada, { emitidaEn: t0, email });
      const persona = await crearPersonaDeBase(dueno, email);
      await aceptarDeBase(dueno, inv2, persona.id, mas(1));
      const r2 = await leer(comoAdmin(), aceptada.empresa);
      expect(r2.ok && r2.valor).toMatchObject({
        id: inv2.id,
        estado: "ACEPTADA",
        aceptadaPor: personaId(persona.id),
      });
    });

    it("las de usuario y las de otras empresas no cuentan", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const otra = await crearEmpresaEnAlta(entorno, { tenant: e.tenant });
      const propiaAlta = await alta(e, { emitidaEn: t0 });
      await alta(otra, { emitidaEn: mas(10) });
      const deUsuario = await crearInvitacionDeBase(dueno, {
        tenant: e.tenant,
        tipo: "USUARIO",
        emitidaEn: mas(20),
        venceEn: mas(40),
      });
      await incluirEmpresa(dueno, deUsuario, e.empresa, "OPERADOR");
      const r = await leer(comoAdmin(), e.empresa);
      expect(r.ok && r.valor?.id).toBe(propiaAlta.id);
      const sinAlta = await crearEmpresaEnAlta(entorno, { tenant: e.tenant });
      const deUsuario2 = await crearInvitacionDeBase(dueno, {
        tenant: e.tenant,
        tipo: "USUARIO",
        emitidaEn: mas(20),
        venceEn: mas(40),
      });
      await incluirEmpresa(dueno, deUsuario2, sinAlta.empresa, "OPERADOR");
      expect(await leer(comoAdmin(), sinAlta.empresa)).toEqual({ ok: true, valor: null });
    });

    it("con la misma fecha de emisión, desempata por id (la mayor)", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const ids = [randomUUID(), randomUUID()].sort();
      const menor = await alta(e, { emitidaEn: t0, id: ids[0] as string });
      await revocarDeBase(dueno, menor, "REENVIADA");
      const mayor = await alta(e, { emitidaEn: t0, id: ids[1] as string });
      const r = await leer(comoAdmin(), e.empresa);
      expect(r.ok && r.valor?.id).toBe(mayor.id);
      // Y al revés: el id mayor revocado y el menor pendiente igual gana el mayor.
      const f = await crearEmpresaEnAlta(entorno);
      const ids2 = [randomUUID(), randomUUID()].sort();
      const mayor2 = await alta(f, { emitidaEn: t0, id: ids2[1] as string });
      await revocarDeBase(dueno, mayor2, "REENVIADA");
      await alta(f, { emitidaEn: t0, id: ids2[0] as string });
      const r2 = await leer(comoAdmin(), f.empresa);
      expect(r2.ok && r2.valor?.id).toBe(mayor2.id);
    });

    it("la leen soporte y `sistema`; un administrador de baja o inexistente no ve nada", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const inv = await alta(e, { emitidaEn: t0 });
      for (const contexto of [comoAdmin(), comoSoporte(), comoSistema()]) {
        const r = await leer(contexto, e.empresa);
        expect(r.ok && r.valor?.id).toBe(inv.id);
      }
      for (const contexto of [comoAdminDe(bajaId), comoAdminDe(adminInexistente())]) {
        expect(await leer(contexto, e.empresa)).toEqual({ ok: true, valor: null });
      }
    });

    it("no toca invitacion_sucursal: anda con el rol de plataforma, que no la puede leer; `obtenerPorId` sí la lee y no anda", async () => {
      const e = await crearEmpresaEnAlta(entorno);
      const inv = await alta(e, { emitidaEn: t0 });
      expect((await leer(comoAdmin(), e.empresa)).ok).toBe(true);
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async ({ invitaciones }) =>
        ok(await invitaciones.obtenerPorId(invitacionId(inv.id))),
      );
      esperarAccesoDenegado(r);
    });

    it("una empresa que no existe no tiene alta", async () => {
      expect(await leer(comoAdmin(), empresaId(randomUUID()))).toEqual({ ok: true, valor: null });
    });
  });

  // ===========================================================================================
  // cambiarActivoGlobal
  // ===========================================================================================
  describe("personas.cambiarActivoGlobal", () => {
    const cambiar = (contexto: ReturnType<typeof comoAdmin>, persona: PersonaId, activo: boolean) =>
      entorno.ejecutar({ contexto }, async ({ personas }) =>
        ok(await personas.cambiarActivoGlobal(persona, activo)),
      );
    const nueva = async (): Promise<PersonaId> => personaId((await crearPersonaDeBase(dueno)).id);
    const activoGlobal = async (persona: string) =>
      (await filas("select activo_global from persona where id = $1", [persona]))[0]?.[
        "activo_global"
      ];

    it("suspende y reactiva; repetirlo no cambia nada y devuelve false", async () => {
      const persona = await nueva();
      expect(await cambiar(comoAdmin(), persona, false)).toEqual({ ok: true, valor: true });
      expect(await activoGlobal(persona)).toBe(false);
      expect(await cambiar(comoAdmin(), persona, false)).toEqual({ ok: true, valor: false });
      expect(await activoGlobal(persona)).toBe(false);
      expect(await cambiar(comoAdmin(), persona, true)).toEqual({ ok: true, valor: true });
      expect(await activoGlobal(persona)).toBe(true);
      expect(await cambiar(comoAdmin(), persona, true)).toEqual({ ok: true, valor: false });
      expect(await activoGlobal(persona)).toBe(true);
    });

    it("una persona que no existe: false", async () => {
      expect(await cambiar(comoAdmin(), personaId(randomUUID()), false)).toEqual({
        ok: true,
        valor: false,
      });
    });

    it("soporte, `sistema`, un administrador de baja y uno inexistente no cambian nada (la base filtra la fila)", async () => {
      for (const [quien, contexto] of sinPermisoDeEscritura()) {
        const persona = await nueva();
        expect(await cambiar(contexto, persona, false), quien).toEqual({ ok: true, valor: false });
        expect(await activoGlobal(persona), quien).toBe(true);
        await dueno.query("update persona set activo_global = false where id = $1", [persona]);
        expect(await cambiar(contexto, persona, true), quien).toEqual({ ok: true, valor: false });
        expect(await activoGlobal(persona), quien).toBe(false);
      }
    });

    it("la suspensión corta los permisos en la operación siguiente y la reactivación los devuelve", async () => {
      const e = await crearEmpresaActiva(entorno);
      const persona = await nueva();
      await crearMembresiaDeBase(dueno, e.empresa, persona, "GERENTE");
      const contexto = comoEmpresa(e.empresa, persona);
      if (contexto.tipo !== "OPERATIVO") throw new Error("contexto de prueba");
      const rol = () =>
        entorno.ejecutar({ contexto }, async ({ autorizacion }) =>
          ok((await autorizacion.delActor(contexto)).rol),
        );
      expect(await rol()).toEqual({ ok: true, valor: "GERENTE" });
      await cambiar(comoAdmin(), persona, false);
      expect(await rol()).toEqual({ ok: true, valor: null });
      await cambiar(comoAdmin(), persona, true);
      expect(await rol()).toEqual({ ok: true, valor: "GERENTE" });
    });

    it("atómico con la auditoría: si algo falla después, la persona sigue activa y no queda constancia", async () => {
      const persona = await nueva();
      await expect(
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ personas, auditoriaDePlataforma }) => {
          await personas.cambiarActivoGlobal(persona, false);
          await auditoriaDePlataforma.registrar({
            accion: "PERSONA_SUSPENDIDA",
            entidad: "persona",
            entidadId: persona,
            antes: { activoGlobal: true },
            despues: { activoGlobal: false },
          });
          throw new Error("falla forzada");
        }),
      ).rejects.toThrow("falla forzada");
      expect(await activoGlobal(persona)).toBe(true);
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [
          persona,
        ]),
      ).toBe(0);
      // Y sin falla, quedan las dos cosas juntas.
      await entorno.ejecutar(
        { contexto: comoAdmin() },
        async ({ personas, auditoriaDePlataforma }) => {
          await personas.cambiarActivoGlobal(persona, false);
          await auditoriaDePlataforma.registrar({
            accion: "PERSONA_SUSPENDIDA",
            entidad: "persona",
            entidadId: persona,
          });
          return ok(null);
        },
      );
      expect(await activoGlobal(persona)).toBe(false);
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [
          persona,
        ]),
      ).toBe(1);
    });

    it("seis suspensiones simultáneas de la misma persona: una sola la cambia", async () => {
      const persona = await nueva();
      const N = 6;
      const barrera = crearBarrera(N);
      const rs = await Promise.all(
        Array.from({ length: N }, () =>
          entorno.ejecutar({ contexto: comoAdmin(), reintentos: 15 }, async ({ personas }) => {
            await barrera();
            return ok(await personas.cambiarActivoGlobal(persona, false));
          }),
        ),
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.filter((r) => r.ok && r.valor)).toHaveLength(1);
      expect(await activoGlobal(persona)).toBe(false);
    });

    it("suspender y reactivar a la vez: solo hay resultados que corresponden a un orden serial", async () => {
      for (let vuelta = 0; vuelta < 4; vuelta++) {
        const persona = await nueva();
        const barrera = crearBarrera(2);
        const de = (activo: boolean) =>
          entorno.ejecutar({ contexto: comoAdmin(), reintentos: 15 }, async ({ personas }) => {
            await barrera();
            return ok(await personas.cambiarActivoGlobal(persona, activo));
          });
        const [suspender, reactivar] = await Promise.all([de(false), de(true)]);
        expect(suspender).toEqual({ ok: true, valor: true });
        if (reactivar.ok && reactivar.valor) {
          // La suspensión fue primero y después se reactivó.
          expect(await activoGlobal(persona)).toBe(true);
        } else {
          // La reactivación fue primero (no había nada que reactivar) y después se suspendió.
          expect(reactivar).toEqual({ ok: true, valor: false });
          expect(await activoGlobal(persona)).toBe(false);
        }
      }
    });
  });
});
