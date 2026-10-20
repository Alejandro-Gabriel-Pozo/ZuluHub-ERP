import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  RESTRICCION_DE_UNICIDAD_DE_REFERENCIA,
  armarRegistrarReferenciaDeError,
} from "../../src/plataforma/casos-de-uso/registrar-referencia";
import {
  empresaId,
  personaId,
  tenantId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoGrupo,
  comoInvitacion,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, hashDeToken } from "./fixtures-identidad";
import { comoAdmin } from "./plataforma-apoyo";
import {
  crearCasosDeSoporte,
  crearConsultasDeSoporte,
  crearEntornoDeSoporte,
} from "./soporte-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * Referencia de error (soporte, paso 1, H5 §B.5.9): registrarla desde cada puerta, buscarla y la
 * DECISIÓN de P6 sobre las colisiones de 32 bits (unicidad + reintento). La migración 0004 dejó la
 * tabla SIN unicidad: la restricción `referencia_de_error_referencia_uk` todavía no existe, así que las
 * pruebas del reintento la agregan en su propia base (es el contrato con la migración que la cree).
 * Bases propias: una sin la restricción (como `main`) y otra con ella.
 */

const base = inject("baseDePruebas");
const admin = plataformaEn(AHORA_DE_PRUEBA);

const bytes = (n: number) => new Uint8Array([0xab, 0x12, 0xcd, n]);
const codigo = (n: number) => `PD-AB12-CD${n.toString(16).toUpperCase().padStart(2, "0")}`;

type Entorno = {
  propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  soporte: ReturnType<typeof crearEntornoDeSoporte>;
  datos: ReturnType<typeof crearEntornoDePrueba>;
  dueno: pg.Client;
  empresa: EmpresaId;
  persona: PersonaId;
};

async function armarEntorno(conUnicidad: boolean): Promise<Entorno> {
  if (base === null) throw new Error("sin base");
  const propia = await crearBaseAparte(base);
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const datos = crearEntornoDePrueba(propia.base, 3);
  const e = await crearEmpresaActiva(datos);
  const p = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, e.empresa, p.id, "ADMINISTRADOR");
  // La migración 0004 dejó la tabla sin unicidad; cuando una migración posterior la agregue, estas
  // pruebas siguen valiendo: acá se la quita o se la pone, según el escenario.
  await dueno.query(
    `alter table referencia_de_error drop constraint if exists ${RESTRICCION_DE_UNICIDAD_DE_REFERENCIA}`,
  );
  if (conUnicidad) {
    await dueno.query(
      `alter table referencia_de_error add constraint ${RESTRICCION_DE_UNICIDAD_DE_REFERENCIA} unique (referencia)`,
    );
  }
  return {
    propia,
    soporte: crearEntornoDeSoporte(propia.base, 12),
    datos,
    dueno,
    empresa: empresaId(e.empresa),
    persona: personaId(p.id),
  };
}

async function cerrarEntorno(e: Entorno) {
  await e.dueno.end();
  await e.soporte.cerrar();
  await e.datos.cerrar();
  await e.propia.destruir();
}

describe.skipIf(base === null)("soporte de plataforma: referencias de error", () => {
  describe("registrar y buscar (la tabla como la dejó la migración 0004, sin unicidad)", () => {
    let e: Entorno;
    beforeAll(async () => {
      e = await armarEntorno(false);
    });
    afterAll(async () => {
      await cerrarEntorno(e);
    });

    const registrar = (azar: () => Uint8Array) =>
      crearCasosDeSoporte(e.soporte, azar).registrarReferenciaDeError;
    const buscar = (referencia: string) =>
      crearConsultasDeSoporte(e.soporte).buscarReferencia(admin, { referencia });
    const filas = async (texto: string, parametros: unknown[] = []) =>
      (await e.dueno.query<Record<string, unknown>>(texto, parametros)).rows;

    it("desde cada puerta se registra lo suyo, y soporte lo encuentra tal cual, sin datos de negocio", async () => {
      const rechazo = { accion: "usuarios.invitar", motivo: "SIN_PERMISO" };
      const operativa = await registrar(() => bytes(1))(comoEmpresa(e.empresa, e.persona), {
        ...rechazo,
        empresaId: e.empresa,
        personaId: e.persona,
      });
      expect(operativa).toEqual({ ok: true, valor: codigo(1) });

      // El contexto de grupo exige un tenant real: se usa el de la empresa de prueba.
      const tenant = (await filas("select tenant_id from empresa where id = $1", [e.empresa]))[0]?.[
        "tenant_id"
      ] as string;
      const grupo = await registrar(() => bytes(2))(comoGrupo(tenantId(tenant), e.persona), {
        accion: "empresas.ver",
        motivo: "SIN_PERMISO",
        empresaId: null,
        personaId: e.persona,
      });
      expect(grupo).toEqual({ ok: true, valor: codigo(2) });

      const invitado = await registrar(() => bytes(3))(comoInvitacion(hashDeToken("un-token")), {
        accion: "invitaciones.aceptar",
        motivo: "INVITACION_VENCIDA",
        empresaId: null,
        personaId: null,
      });
      expect(invitado).toEqual({ ok: true, valor: codigo(3) });

      const deLaPlataforma = await registrar(() => bytes(4))(comoAdmin(), {
        accion: "tenants.suspender",
        motivo: "SIN_PERMISO",
        empresaId: null,
        personaId: null,
      });
      expect(deLaPlataforma).toEqual({ ok: true, valor: codigo(4) });

      const encontrada = await buscar(codigo(1).toLowerCase());
      expect(encontrada).toEqual({
        ok: true,
        valor: [
          {
            referencia: codigo(1),
            accion: "usuarios.invitar",
            motivo: "SIN_PERMISO",
            empresaId: e.empresa,
            personaId: e.persona,
            creadoEn: expect.any(Date) as Date,
          },
        ],
      });
      // Lo registrado por cada puerta es lo que ella firmó; la persona de la invitación no existe.
      expect(await buscar(codigo(3))).toMatchObject({
        ok: true,
        valor: [
          {
            accion: "invitaciones.aceptar",
            motivo: "INVITACION_VENCIDA",
            empresaId: null,
            personaId: null,
          },
        ],
      });
      // Y nada más que esos campos: ni texto libre ni datos de negocio.
      expect(Object.keys((encontrada.ok ? encontrada.valor[0] : {}) as object).sort()).toEqual(
        ["accion", "creadoEn", "empresaId", "motivo", "personaId", "referencia"].sort(),
      );
    });

    it("una referencia que no existe no es un error: no hay coincidencias", async () => {
      expect(await buscar("PD-0000-0000")).toEqual({ ok: true, valor: [] });
    });

    it("dos errores que sortearon el mismo código se devuelven AMBOS, de la más vieja a la más nueva", async () => {
      await e.dueno.query(
        `insert into referencia_de_error (referencia, accion, motivo, creado_en) values
          ('PD-DEAD-BEEF', 'usuarios.ver', 'SIN_PERMISO', '2026-10-01T10:00:00Z'),
          ('PD-DEAD-BEEF', 'sucursales.crear', 'EMPRESA_NO_OPERA', '2026-10-01T09:00:00Z')`,
      );
      const r = await buscar("PD-DEAD-BEEF");
      expect(r.ok && r.valor.map((f) => f.accion)).toEqual(["sucursales.crear", "usuarios.ver"]);
    });

    it("una referencia con mala forma es REFERENCIA_INVALIDA", async () => {
      expect(await buscar("PD-12")).toEqual({ ok: false, error: "REFERENCIA_INVALIDA" });
    });
  });

  describe("colisiones: unicidad en la base + reintento (decisión de P6)", () => {
    let conRestriccion: Entorno;
    beforeAll(async () => {
      conRestriccion = await armarEntorno(true);
    });
    afterAll(async () => {
      await cerrarEntorno(conRestriccion);
    });

    const rechazo = () => ({
      accion: "usuarios.invitar",
      motivo: "SIN_PERMISO",
      empresaId: conRestriccion.empresa,
      personaId: conRestriccion.persona,
    });
    const contexto = () => comoEmpresa(conRestriccion.empresa, conRestriccion.persona);
    const registrarCon = (azar: () => Uint8Array) =>
      armarRegistrarReferenciaDeError({ transacciones: conRestriccion.soporte, azar });
    const codigos = async () =>
      (
        await conRestriccion.dueno.query<{ referencia: string }>(
          "select referencia from referencia_de_error order by id",
        )
      ).rows.map((f) => f.referencia);

    it("la base rechaza una referencia repetida con la restricción que el reintento espera", async () => {
      await conRestriccion.dueno.query(
        "insert into referencia_de_error (referencia, accion, motivo) values ('PD-1111-2222', 'a.b', 'X')",
      );
      const r = await conRestriccion.soporte.ejecutar(
        { contexto: contexto() },
        async ({ referenciasDeError }) => {
          await referenciasDeError.registrar({
            referencia: "PD-1111-2222",
            accion: "a.b",
            motivo: "X",
            empresaId: conRestriccion.empresa,
            personaId: conRestriccion.persona,
          });
          return { ok: true as const, valor: null };
        },
      );
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: RESTRICCION_DE_UNICIDAD_DE_REFERENCIA },
      });
    });

    it("ante una colisión sortea otra y la registra: queda la nueva, sin pisar la vieja", async () => {
      await conRestriccion.dueno.query(
        "insert into referencia_de_error (referencia, accion, motivo) values ($1, 'vieja.accion', 'VIEJO')",
        [codigo(0x21)],
      );
      let llamadas = 0;
      const r = await registrarCon(() => bytes(0x21 + llamadas++))(contexto(), rechazo());
      expect(r).toEqual({ ok: true, valor: codigo(0x22) });
      expect(llamadas).toBe(2);
      const filas = (
        await conRestriccion.dueno.query<Record<string, unknown>>(
          "select referencia, accion, motivo from referencia_de_error where referencia in ($1, $2) order by referencia",
          [codigo(0x21), codigo(0x22)],
        )
      ).rows;
      expect(filas).toEqual([
        { referencia: codigo(0x21), accion: "vieja.accion", motivo: "VIEJO" },
        { referencia: codigo(0x22), accion: "usuarios.invitar", motivo: "SIN_PERMISO" },
      ]);
    });

    it("sin colisión registra a la primera y llama al azar una sola vez", async () => {
      let llamadas = 0;
      const r = await registrarCon(() => {
        llamadas += 1;
        return bytes(0x31);
      })(contexto(), rechazo());
      expect(r).toEqual({ ok: true, valor: codigo(0x31) });
      expect(llamadas).toBe(1);
    });

    it("si todos los intentos colisionan, devuelve la colisión y no deja nada nuevo", async () => {
      for (let i = 0; i < 5; i += 1) {
        await conRestriccion.dueno.query(
          "insert into referencia_de_error (referencia, accion, motivo) values ($1, 'a.b', 'X')",
          [codigo(0x40 + i)],
        );
      }
      const antes = (await codigos()).length;
      let llamadas = 0;
      const r = await registrarCon(() => bytes(0x40 + llamadas++))(contexto(), rechazo());
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: RESTRICCION_DE_UNICIDAD_DE_REFERENCIA },
      });
      expect(llamadas).toBe(5);
      expect((await codigos()).length).toBe(antes);
    });

    it("un error que no es una colisión no se reintenta (una persona que no es la del contexto)", async () => {
      let llamadas = 0;
      const r = await registrarCon(() => {
        llamadas += 1;
        return bytes(0x50);
      })(contexto(), {
        ...rechazo(),
        personaId: personaId("00000000-0000-4000-8000-0000000000ff"),
      });
      expect(r.ok).toBe(false);
      expect(llamadas).toBe(1);
      expect(await codigos()).not.toContain(codigo(0x50));
    });

    it("N registros simultáneos que sortean el MISMO código al principio terminan con códigos distintos y ninguno se pierde", async () => {
      const N = 8;
      const antes = (await codigos()).length;
      const resultados = await Promise.all(
        Array.from({ length: N }, (_, i) => {
          let llamadas = 0;
          // Todos arrancan con el mismo código; cada uno sigue con uno propio.
          const azar = () => (llamadas++ === 0 ? bytes(0x60) : bytes(0x70 + i));
          return registrarCon(azar)(contexto(), rechazo());
        }),
      );
      expect(resultados.every((r) => r.ok)).toBe(true);
      const devueltas = resultados.map((r) => (r.ok ? r.valor : ""));
      expect(new Set(devueltas).size).toBe(N);
      const guardadas = (await codigos()).slice(antes);
      expect(guardadas.sort()).toEqual([...devueltas].sort());
      expect(devueltas.filter((c) => c === codigo(0x60))).toHaveLength(1);
    });
  });

  describe("sin la restricción de unicidad (como la tabla de la migración 0004)", () => {
    let e: Entorno;
    beforeAll(async () => {
      e = await armarEntorno(false);
    });
    afterAll(async () => {
      await cerrarEntorno(e);
    });

    it("el caso de uso sigue funcionando y nunca reintenta; la búsqueda devuelve las dos coincidencias", async () => {
      const azar = () => bytes(0x80);
      const registrar = armarRegistrarReferenciaDeError({ transacciones: e.soporte, azar });
      const contexto = comoEmpresa(e.empresa, e.persona);
      const rechazo = {
        accion: "usuarios.invitar",
        motivo: "SIN_PERMISO",
        empresaId: e.empresa,
        personaId: e.persona,
      };
      const a = await registrar(contexto, rechazo);
      const b = await registrar(contexto, rechazo);
      expect(a).toEqual({ ok: true, valor: codigo(0x80) });
      expect(b).toEqual({ ok: true, valor: codigo(0x80) });
      const r = await crearConsultasDeSoporte(e.soporte).buscarReferencia(admin, {
        referencia: codigo(0x80),
      });
      expect(r.ok && r.valor).toHaveLength(2);
    });
  });
});
