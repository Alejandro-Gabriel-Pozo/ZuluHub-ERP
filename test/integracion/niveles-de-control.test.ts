import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { FORMA_DE_CLAVE_DE_CONTROL } from "../../src/capacidades/controles/catalogo";
import { NIVELES_DE_CONTROL } from "../../src/capacidades/controles/nivel";
import {
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { sucursalDe } from "./fixtures-identidad";

/**
 * Tramo previo común, ADR-008: el adaptador de `NivelesDeControl` contra una base real. Lee el nivel
 * que rige un control (empresa, endurecido por la sucursal, o PERMITIR si el plan no lo incluye) de
 * `nivel_de_control` (0007), dentro de la transacción en curso y sin caché. Los valores se escriben
 * con el dueño de la base (el caso de uso que los fija, `controles.configurar`, lo construye otro tramo).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

// Las claves de control son del catálogo de cada módulo; para probar el adaptador alcanza cualquier
// texto con la forma de la base (el adaptador es genérico en la clave).
const CONTROL = "caja.cierre_con_diferencia";
const OTRO_CONTROL = "stock.existencia_negativa";

describe.skipIf(base === null)("niveles de control: el adaptador contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Una empresa con su sucursal inicial y otra más. */
  const escenario = async () => {
    const { empresa } = await crearEmpresaActiva(entorno);
    const central = sucursalId(await sucursalDe(dueno, empresa));
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Local 2') returning id",
      [empresa],
    );
    return { empresa, central, otra: sucursalId(rows[0]?.id as string) };
  };
  const fijar = (
    empresa: EmpresaId,
    control: string,
    nivel: string,
    sucursal: SucursalId | null = null,
  ) =>
    dueno.query(
      "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, $3, $4)",
      [empresa, sucursal, control, nivel],
    );
  const nivelDe = async (
    empresa: EmpresaId,
    sucursal: SucursalId | null,
    disponible = true,
    control = CONTROL,
  ) => {
    const contexto = comoEmpresa(empresa);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.niveles.nivel(control, { empresaId: empresa, sucursalId: sucursal }, disponible)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  it("sin fila rige PERMITIR", async () => {
    const e = await escenario();
    expect(await nivelDe(e.empresa, null)).toBe("PERMITIR");
    expect(await nivelDe(e.empresa, e.central)).toBe("PERMITIR");
  });

  it.each(NIVELES_DE_CONTROL)(
    "el nivel %s de la empresa rige, con o sin sucursal",
    async (nivel) => {
      const e = await escenario();
      await fijar(e.empresa, CONTROL, nivel);
      expect(await nivelDe(e.empresa, null)).toBe(nivel);
      expect(await nivelDe(e.empresa, e.central)).toBe(nivel);
    },
  );

  it("la sucursal endurece el nivel de la empresa, solo en esa sucursal", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "AVISAR");
    await fijar(e.empresa, CONTROL, "BLOQUEAR", e.central);
    expect(await nivelDe(e.empresa, e.central)).toBe("BLOQUEAR");
    expect(await nivelDe(e.empresa, e.otra)).toBe("AVISAR");
    expect(await nivelDe(e.empresa, null)).toBe("AVISAR");
  });

  it("la sucursal sin nivel de empresa también endurece (la empresa rige PERMITIR)", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "AVISAR", e.central);
    expect(await nivelDe(e.empresa, e.central)).toBe("AVISAR");
    expect(await nivelDe(e.empresa, e.otra)).toBe("PERMITIR");
  });

  it("la sucursal no afloja lo que la empresa bloqueó", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "BLOQUEAR");
    await fijar(e.empresa, CONTROL, "PERMITIR", e.central);
    expect(await nivelDe(e.empresa, e.central)).toBe("BLOQUEAR");
  });

  it("sin la sucursal en la pregunta, los niveles de sus sucursales no cuentan", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "BLOQUEAR", e.central);
    expect(await nivelDe(e.empresa, null)).toBe("PERMITIR");
  });

  it("si el plan no incluye el control rige PERMITIR, aunque haya un nivel guardado", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "BLOQUEAR");
    await fijar(e.empresa, CONTROL, "BLOQUEAR", e.central);
    expect(await nivelDe(e.empresa, e.central, false)).toBe("PERMITIR");
    expect(await nivelDe(e.empresa, e.central, true)).toBe("BLOQUEAR");
  });

  it("cada control tiene su propio nivel", async () => {
    const e = await escenario();
    await fijar(e.empresa, CONTROL, "BLOQUEAR");
    expect(await nivelDe(e.empresa, null, true, OTRO_CONTROL)).toBe("PERMITIR");
    expect(await nivelDe(e.empresa, null, true, CONTROL)).toBe("BLOQUEAR");
  });

  it("aislamiento: el nivel de otra empresa no rige, ni preguntando por su sucursal", async () => {
    const mia = await escenario();
    const ajena = await escenario();
    await fijar(ajena.empresa, CONTROL, "BLOQUEAR");
    await fijar(ajena.empresa, CONTROL, "BLOQUEAR", ajena.central);
    expect(await nivelDe(mia.empresa, null)).toBe("PERMITIR");
    expect(await nivelDe(mia.empresa, ajena.central)).toBe("PERMITIR");
    // Y preguntar por la empresa ajena desde mi contexto tampoco la deja ver (la RLS la oculta).
    const contexto = comoEmpresa(mia.empresa);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.niveles.nivel(CONTROL, { empresaId: ajena.empresa, sucursalId: null }, true)),
    );
    expect(r).toEqual({ ok: true, valor: "PERMITIR" });
  });

  it("se lee en la transacción en curso, sin caché: ve el nivel que esa transacción acaba de fijar, y un cambio ya confirmado rige de inmediato", async () => {
    const e = await escenario();
    const contexto = comoEmpresa(e.empresa);
    const r = await entorno.ejecutar({ contexto }, async (tx) => {
      const niveles = tx.niveles;
      const alcance = { empresaId: e.empresa, sucursalId: null };
      const antes = await niveles.nivel(CONTROL, alcance, true);
      await sql`insert into nivel_de_control (empresa_id, control, nivel)
                values (${e.empresa}, ${CONTROL}, 'AVISAR')`.execute(tx.db);
      const despues = await niveles.nivel(CONTROL, alcance, true);
      return ok({ antes, despues });
    });
    expect(r).toEqual({ ok: true, valor: { antes: "PERMITIR", despues: "AVISAR" } });
    await dueno.query(
      "update nivel_de_control set nivel = 'BLOQUEAR' where empresa_id = $1 and control = $2",
      [e.empresa, CONTROL],
    );
    expect(await nivelDe(e.empresa, null)).toBe("BLOQUEAR");
  });

  it("un nivel desconocido en la base es una falla (no se decide por omisión)", async () => {
    const aparte = await crearBaseAparte(base!);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
    try {
      await cliente.connect();
      const { empresa } = await crearEmpresaActiva(entornoAparte);
      await cliente.query("alter table nivel_de_control drop constraint nivel_de_control_nivel_ck");
      await cliente.query(
        "insert into nivel_de_control (empresa_id, control, nivel) values ($1, $2, 'SUSPENDER')",
        [empresa, CONTROL],
      );
      await expect(
        entornoAparte.ejecutar({ contexto: comoEmpresa(empresa) }, async (tx) =>
          ok(await tx.niveles.nivel(CONTROL, { empresaId: empresa, sucursalId: null }, true)),
        ),
      ).rejects.toThrow("nivel de control desconocido en la base: SUSPENDER");
    } finally {
      await cliente.end();
      await entornoAparte.cerrar();
      await aparte.destruir();
    }
  });

  describe("los valores de TypeScript son exactamente los de la base", () => {
    const definicion = async (restriccion: string) => {
      const { rows } = await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
        [restriccion],
      );
      expect(rows, `${restriccion} existe una sola vez`).toHaveLength(1);
      return rows[0]?.def ?? "";
    };

    it("los niveles son exactamente los del CHECK nivel_de_control_nivel_ck", async () => {
      const def = await definicion("nivel_de_control_nivel_ck");
      expect([...def.matchAll(/'([A-Z]+)'/g)].map((m) => m[1] ?? "").sort()).toEqual(
        [...NIVELES_DE_CONTROL].sort(),
      );
    });

    it("la forma de la clave de control es la del CHECK nivel_de_control_control_ck (misma decisión sobre muchas claves)", async () => {
      const claves = [
        "caja.cierre_con_diferencia",
        "a.b",
        "",
        "caja",
        "caja.",
        ".x",
        "Caja.x",
        "caja.X",
        "caja.x-y",
        "caja.x.y",
        "caja2.x",
        "caja.x2",
        "caja.x\n",
        " caja.x",
        "caja_x.y",
        "caja.__",
      ];
      const { rows } = await dueno.query<{ clave: string; valida: boolean }>(
        `select c as clave, (c ~ '^[a-z]+\\.[a-z_]+$') as valida from unnest($1::text[]) as c`,
        [claves],
      );
      // Primero se comprueba que la expresión de la base es esa (si alguien cambia el CHECK, falla acá).
      expect(await definicion("nivel_de_control_control_ck")).toContain("'^[a-z]+\\.[a-z_]+$'");
      for (const fila of rows) {
        expect(FORMA_DE_CLAVE_DE_CONTROL.test(fila.clave), JSON.stringify(fila.clave)).toBe(
          fila.valida,
        );
      }
    });
  });

  describe("concurrencia", () => {
    it("N1: cambiar el nivel a la vez que varias operaciones lo leen: cada una ve el viejo o el nuevo (nunca un error) y después rige el nuevo", async () => {
      for (let n = 0; n < 6; n++) {
        const e = await escenario();
        await fijar(e.empresa, CONTROL, "PERMITIR");
        const lectores = 4;
        const barrera = crearBarrera(lectores + 1);
        const contexto = comoEmpresa(e.empresa);
        const leer = () =>
          entorno.ejecutar({ contexto }, async (tx) => {
            await barrera();
            return ok(
              await tx.niveles.nivel(CONTROL, { empresaId: e.empresa, sucursalId: null }, true),
            );
          });
        const escribir = async () => {
          await barrera();
          await dueno.query(
            "update nivel_de_control set nivel = 'BLOQUEAR' where empresa_id = $1 and control = $2",
            [e.empresa, CONTROL],
          );
        };
        const [, ...vistos] = await Promise.all([
          escribir(),
          ...Array.from({ length: lectores }, leer),
        ]);
        for (const visto of vistos) {
          expect(visto.ok, `ronda ${n}`).toBe(true);
          expect(["PERMITIR", "BLOQUEAR"], `ronda ${n}`).toContain(visto.ok ? visto.valor : "");
        }
        expect(await nivelDe(e.empresa, null), `ronda ${n}`).toBe("BLOQUEAR");
      }
    });

    it("N2: dos altas simultáneas del nivel de empresa para el mismo control: la base deja una (única), la otra falla con Unicidad", async () => {
      for (let n = 0; n < 6; n++) {
        const e = await escenario();
        const barrera = crearBarrera(2);
        const contexto = comoEmpresa(e.empresa);
        const alta = (nivel: string) =>
          entorno.ejecutar({ contexto }, async (tx) => {
            await barrera();
            await sql`insert into nivel_de_control (empresa_id, control, nivel)
                      values (${e.empresa}, ${CONTROL}, ${nivel})`.execute(tx.db);
            return ok(nivel);
          });
        const [x, y] = await Promise.all([alta("AVISAR"), alta("BLOQUEAR")]);
        expect([x.ok, y.ok].sort(), `ronda ${n}`).toEqual([false, true]);
        const perdedor = x.ok ? y : x;
        expect(perdedor, `ronda ${n}`).toMatchObject({
          ok: false,
          error: { tipo: "Unicidad", restriccion: "nivel_de_control_uk" },
        });
        const { rows } = await dueno.query(
          "select nivel from nivel_de_control where empresa_id = $1 and control = $2",
          [e.empresa, CONTROL],
        );
        expect(rows, `ronda ${n}`).toHaveLength(1);
        expect(await nivelDe(e.empresa, null)).toBe(x.ok ? "AVISAR" : "BLOQUEAR");
      }
    });
  });
});
