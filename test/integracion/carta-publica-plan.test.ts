import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { BaseDePruebas } from "./global";
import { montarCatalogo, precioDeBase } from "./catalogo-apoyo";
import { cartaDeBase, codigoAlAzar, comoPublico, empresaDeCarta } from "./carta-publica-apoyo";
import {
  CATALOGOS_DE_PRUEBA_DE_LA_CARTA,
  MARCA_DEL_HOST,
  adaptadorReal,
  asignarVersion,
  darleLaCartaAlPlan,
  versionDeLaCarta,
  type Catalogo,
} from "./carta-publica-lectura-apoyo";
import { crearEmpresaActiva } from "./entorno";
import { ajustarPerilla } from "./marcas-apoyo";
import { tenantId } from "../../src/primitivas/identificadores/marca";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";

/**
 * T6 de la carta real (0050): la carta pública mira el plan de la empresa EN CADA VISITA. Una empresa que baja de plan, pierde el módulo de la carta o tiene la
 * perilla `vidriera_por_qr` apagada deja de mostrarla sola, con la misma respuesta `null` que una carta inexistente; al volver el plan, vuelve. El rol público
 * lee del plan solo lo mínimo y solo de la empresa de la carta. Todo con el rol `pedernal_publico` real; el escenario, con SQL del dueño.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Una hora un poco posterior a «ahora» del reloj de la base: los ajustes de las pruebas rigen desde hace 30 segundos. */
const despues = (): Date => new Date(Date.now() + 120_000);
const haceSegundos = (n: number): string => new Date(Date.now() - n * 1000).toISOString();

describe.skipIf(base === null)("carta pública y plan de la empresa (0050)", () => {
  let c: Catalogo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];
  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    ({ vidriera, publicas } = adaptadorReal(c, despues));
  });
  afterAll(async () => {
    await publicas.cerrar();
    await c.cerrar();
  });

  /** Una empresa con un producto visible y su carta en línea, con el plan que da la carta (módulo y perilla). */
  const empresaConCarta = async () => {
    const e = await empresaDeCarta(c.entorno, c.dueno);
    const seccion = randomUUID();
    await c.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, 'Platos', 'platos', 0, true)",
      [seccion, e.empresa],
    );
    await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      e.producto,
      seccion,
    ]);
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: e.producto,
      precio: "1500",
      desde: "2026-10-01T00:00:00Z",
    });
    const carta = await cartaDeBase(c.dueno, e.empresa, e.s1);
    const plan = await darleLaCartaAlPlan(c, e.empresa);
    return { ...e, carta, ...plan };
  };
  const sirve = async (codigo: string, puerto = vidriera) =>
    (await puerto.porCodigo(MARCA_DEL_HOST, codigo)) !== null;

  it("con módulo y perilla en el plan, la carta se sirve", async () => {
    const m = await empresaConCarta();
    expect(await sirve(m.carta.codigo)).toBe(true);
  });

  it("una baja de plan (otra versión sin el módulo ni la perilla) la oculta en la visita siguiente, y al volver el plan vuelve", async () => {
    const m = await empresaConCarta();
    expect(await sirve(m.carta.codigo)).toBe(true);
    const sinCarta = await versionDeLaCarta(c, { conModulo: false, conPerilla: false });
    await asignarVersion(c, m.tenant, sinCarta, haceSegundos(60));
    expect(await sirve(m.carta.codigo)).toBe(false);
    await asignarVersion(c, m.tenant, m.version, haceSegundos(30));
    expect(await sirve(m.carta.codigo)).toBe(true);
  });

  it("un plan con el módulo pero sin la perilla encendida tampoco la sirve, y con la perilla pero sin el módulo tampoco", async () => {
    const m = await empresaConCarta();
    await asignarVersion(
      c,
      m.tenant,
      await versionDeLaCarta(c, { conModulo: true, conPerilla: false }),
      haceSegundos(60),
    );
    expect(await sirve(m.carta.codigo)).toBe(false);
    await asignarVersion(
      c,
      m.tenant,
      await versionDeLaCarta(c, { conModulo: false, conPerilla: true }),
      haceSegundos(30),
    );
    expect(await sirve(m.carta.codigo)).toBe(false);
  });

  it("un cambio de plan programado a futuro todavía no rige: la carta se sigue sirviendo hasta esa hora", async () => {
    const m = await empresaConCarta();
    const sinCarta = await versionDeLaCarta(c, { conModulo: false, conPerilla: false });
    await asignarVersion(c, m.tenant, sinCarta, new Date(Date.now() + 3_600_000).toISOString());
    expect(await sirve(m.carta.codigo)).toBe(true);
    // La misma carta, vista desde una hora posterior a la vigencia: ya no.
    const mas = adaptadorReal(c, () => new Date(Date.now() + 7_200_000));
    try {
      expect(await sirve(m.carta.codigo, mas.vidriera)).toBe(false);
    } finally {
      await mas.publicas.cerrar();
    }
  });

  it("si la empresa pierde el módulo (queda desactivado) se oculta, y al reactivarlo vuelve; nada se borra", async () => {
    const m = await empresaConCarta();
    await c.dueno.query(
      "update modulo_de_empresa set activo = false where empresa_id = $1 and modulo = 'vidriera'",
      [m.empresa],
    );
    expect(await sirve(m.carta.codigo)).toBe(false);
    await c.dueno.query(
      "update modulo_de_empresa set activo = true where empresa_id = $1 and modulo = 'vidriera'",
      [m.empresa],
    );
    expect(await sirve(m.carta.codigo)).toBe(true);
  });

  it("una empresa que nunca activó el módulo no la muestra, aunque su plan lo incluya", async () => {
    const m = await empresaConCarta();
    await c.dueno.query("delete from modulo_de_empresa where empresa_id = $1", [m.empresa]).catch(
      // `modulo_de_empresa` no admite borrado (ni para el dueño): se apaga igual.
      () =>
        c.dueno.query("update modulo_de_empresa set activo = false where empresa_id = $1", [
          m.empresa,
        ]),
    );
    expect(await sirve(m.carta.codigo)).toBe(false);
  });

  it("un tenant sin ningún plan asignado no la muestra (sin plan, solo lo obligatorio)", async () => {
    const e = await empresaDeCarta(c.entorno, c.dueno);
    const seccion = randomUUID();
    await c.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, 'Platos', 'platos', 0, true)",
      [seccion, e.empresa],
    );
    await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      e.producto,
      seccion,
    ]);
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: e.producto,
      precio: "1500",
      desde: "2026-10-01T00:00:00Z",
    });
    const carta = await cartaDeBase(c.dueno, e.empresa, e.s1);
    await c.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'vidriera')",
      [e.empresa],
    );
    expect(await sirve(carta.codigo)).toBe(false);
  });

  it("un ajuste que apaga la perilla para ESA empresa la oculta; el de otra empresa del mismo tenant no la toca; quitarlo (DEL_PLAN) la devuelve", async () => {
    const m = await empresaConCarta();
    const idDeOtra = (await crearEmpresaActiva(c.entorno, { tenant: tenantId(m.tenant) })).empresa;
    await ajustarPerilla(c.dueno, m.tenant, "vidriera_por_qr", "0", { empresa: idDeOtra });
    expect(await sirve(m.carta.codigo)).toBe(true);
    await ajustarPerilla(c.dueno, m.tenant, "vidriera_por_qr", "0", { empresa: m.empresa });
    expect(await sirve(m.carta.codigo)).toBe(false);
    await ajustarPerilla(c.dueno, m.tenant, "vidriera_por_qr", "DEL_PLAN", { empresa: m.empresa });
    expect(await sirve(m.carta.codigo)).toBe(true);
  });

  it("con el catálogo real (el módulo de la carta sigue en desarrollo) ninguna carta se sirve: todo nace cerrado", async () => {
    const m = await empresaConCarta();
    const real = adaptadorReal(c, despues, {
      catalogoDeModulos: CATALOGO_DE_MODULOS,
      catalogoDePerillas: CATALOGO_DE_PERILLAS,
    });
    try {
      expect(CATALOGO_DE_MODULOS.vidriera.estado).toBe("en_desarrollo");
      expect(await sirve(m.carta.codigo, real.vidriera)).toBe(false);
      expect(await sirve(m.carta.codigo)).toBe(true);
    } finally {
      await real.publicas.cerrar();
    }
  });

  it("la baja de plan de una empresa no toca la carta de otra, aunque tengan el mismo plan", async () => {
    const a = await empresaConCarta();
    const b = await empresaConCarta();
    await asignarVersion(
      c,
      a.tenant,
      await versionDeLaCarta(c, { conModulo: false, conPerilla: false }),
      haceSegundos(60),
    );
    expect(await sirve(a.carta.codigo)).toBe(false);
    expect(await sirve(b.carta.codigo)).toBe(true);
  });

  it("una carta retirada, un código inventado y uno malformado responden lo mismo que una baja de plan (null): no hay forma de distinguir el motivo", async () => {
    const m = await empresaConCarta();
    const sinCarta = await versionDeLaCarta(c, { conModulo: false, conPerilla: false });
    await asignarVersion(c, m.tenant, sinCarta, haceSegundos(60));
    const respuestas = await Promise.all([
      vidriera.porCodigo(MARCA_DEL_HOST, m.carta.codigo),
      vidriera.porCodigo(MARCA_DEL_HOST, codigoAlAzar()),
      vidriera.porCodigo(MARCA_DEL_HOST, "x"),
    ]);
    expect(respuestas).toEqual([null, null, null]);
  });

  it("muchas visitas a la vez mientras el plan baja: cada una ve la carta entera o nada, nunca a medias ni un error", async () => {
    const m = await empresaConCarta();
    const sinCarta = await versionDeLaCarta(c, { conModulo: false, conPerilla: false });
    const visitas = Array.from({ length: 12 }, () =>
      vidriera.porCodigo(MARCA_DEL_HOST, m.carta.codigo),
    );
    const baja = asignarVersion(c, m.tenant, sinCarta, haceSegundos(60));
    const [respuestas] = await Promise.all([Promise.all(visitas), baja]);
    for (const r of respuestas) {
      if (r !== null) expect(r.secciones[0]?.productos).toHaveLength(1);
    }
    expect(await sirve(m.carta.codigo)).toBe(false);
  });

  describe("el rol público real lee del plan solo lo mínimo y solo de la empresa de la carta", () => {
    const publico = () => c.propia.base.publico;
    const tablas = ["modulo_de_empresa", "plan_de_tenant", "version_de_plan", "ajuste_de_perilla"];
    const contar = async (codigo: string | null, tabla: string) =>
      (
        await comoPublico<{ n: string }>(
          publico(),
          codigo,
          `select count(*)::text as n from ${tabla}`,
        )
      )[0]?.n;

    it("sin código fijado, con uno inventado o con el de una carta retirada, ninguna de las cuatro tablas devuelve filas", async () => {
      const m = await empresaConCarta();
      const retirada = await cartaDeBase(c.dueno, m.empresa, m.s2, { estado: "FUERA_DE_LINEA" });
      for (const t of tablas) {
        expect(await contar(null, t), `${t} sin código`).toBe("0");
        expect(await contar(codigoAlAzar(), t), `${t} con código inventado`).toBe("0");
        expect(await contar(retirada.codigo, t), `${t} con carta retirada`).toBe("0");
      }
    });

    it("con el código de una carta en línea ve solo lo de su tenant y su empresa, nunca lo de otro cliente", async () => {
      const a = await empresaConCarta();
      const b = await empresaConCarta();
      await ajustarPerilla(c.dueno, a.tenant, "vidriera_por_qr", "1", { empresa: a.empresa });
      await ajustarPerilla(c.dueno, b.tenant, "vidriera_por_qr", "0", { empresa: b.empresa });
      await ajustarPerilla(c.dueno, b.tenant, "cajas_por_sucursal", "9");
      const delTenant = async (codigo: string, tabla: string, columna: string) =>
        comoPublico<Record<string, string>>(
          publico(),
          codigo,
          `select distinct ${columna} as x from ${tabla} order by 1`,
        );
      expect(await delTenant(a.carta.codigo, "plan_de_tenant", "tenant_id::text")).toEqual([
        { x: a.tenant },
      ]);
      expect(await delTenant(a.carta.codigo, "modulo_de_empresa", "empresa_id::text")).toEqual([
        { x: a.empresa },
      ]);
      expect(await delTenant(a.carta.codigo, "ajuste_de_perilla", "tenant_id::text")).toEqual([
        { x: a.tenant },
      ]);
      expect(await delTenant(a.carta.codigo, "version_de_plan", "id::text")).toEqual([
        { x: a.version },
      ]);
    });

    it("los ajustes de OTRA empresa del mismo tenant no se ven; los de todo el tenant sí", async () => {
      const m = await empresaConCarta();
      const otra = await crearEmpresaActiva(c.entorno, { tenant: tenantId(m.tenant) });
      await ajustarPerilla(c.dueno, m.tenant, "cajas_por_sucursal", "5", {
        empresa: otra.empresa,
      });
      await ajustarPerilla(c.dueno, m.tenant, "cajas_por_sucursal", "3");
      const filas = await comoPublico<{ empresa_id: string | null; valor: string }>(
        publico(),
        m.carta.codigo,
        "select empresa_id::text as empresa_id, valor from ajuste_de_perilla order by numero",
      );
      expect(filas).toEqual([{ empresa_id: null, valor: "3" }]);
    });

    it("no puede leer lo que no se le otorgó (nombre comercial, motivo, autor, versión) ni escribir ni borrar", async () => {
      const m = await empresaConCarta();
      const lecturasProhibidas = [
        "select nombre_comercial from version_de_plan",
        "select motivo from version_de_plan",
        "select publicada_por from version_de_plan",
        "select version from modulo_de_empresa",
        "select motivo from plan_de_tenant",
        "select asignado_por from plan_de_tenant",
        "select origen from plan_de_tenant",
        "select motivo from ajuste_de_perilla",
        "select asignado_por from ajuste_de_perilla",
        "select creado_en from ajuste_de_perilla",
        "select * from plan_de_tenant",
      ];
      for (const consulta of lecturasProhibidas) {
        await expect(
          comoPublico(publico(), m.carta.codigo, consulta),
          consulta,
        ).rejects.toMatchObject({
          code: "42501",
        });
      }
      // Escribir: ni siquiera el privilegio (la transacción de solo lectura sola lo frenaría antes de mirarlo).
      for (const tabla of tablas) {
        for (const privilegio of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          const { rows } = await c.dueno.query<{ puede: boolean }>(
            "select has_table_privilege('pedernal_publico', $1, $2) as puede",
            [`public.${tabla}`, privilegio],
          );
          expect(rows[0]?.puede, `${tabla} ${privilegio}`).toBe(false);
        }
      }
      await expect(
        comoPublico(publico(), m.carta.codigo, "update modulo_de_empresa set activo = false"),
      ).rejects.toMatchObject({ code: "25006" });
    });
  });

  it("el catálogo de pruebas solo cambia el estado del módulo de la carta", () => {
    expect(CATALOGOS_DE_PRUEBA_DE_LA_CARTA.catalogoDeModulos.vidriera.estado).toBe("disponible");
    expect(CATALOGOS_DE_PRUEBA_DE_LA_CARTA.catalogoDeModulos.catalogo).toBe(
      CATALOGO_DE_MODULOS.catalogo,
    );
  });
});
