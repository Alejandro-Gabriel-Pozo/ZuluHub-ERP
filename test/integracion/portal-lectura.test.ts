import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { asignarVersion, versionDeLaCarta } from "./carta-publica-lectura-apoyo";
import { codigoAlAzar } from "./carta-publica-apoyo";
import type { BaseDePruebas } from "./global";
import { valorDe } from "./catalogo-apoyo";
import {
  comoPublicoDelPortal,
  direccionDeImagen,
  empresaConPortal,
  hostDeLaMarca,
  montarPortal,
  nuevoId,
  type Montaje,
} from "./portal-apoyo";
import { COLUMNAS_PUBLICAS_DE_PORTAL } from "../../src/modulos/portal/publico";

/**
 * La lectura pública del portal (0078 y 0083) con el rol `pedernal_publico` VERDADERO: qué sale (y qué no), el cierre sin código, el aislamiento entre empresas, la regla de
 * plan por visita y el enlace «← PORTAL» desde una carta. El escenario, con SQL del dueño; lo que se prueba pasa por el rol real y por los casos de uso.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const haceSegundos = (n: number): string => new Date(Date.now() - n * 1000).toISOString();

describe.skipIf(base === null)("lectura pública del portal (0078 y 0083)", () => {
  let c: Montaje;
  beforeAll(async () => {
    c = await montarPortal(base as BaseDePruebas);
  });
  afterAll(async () => {
    await c.cerrar();
  });

  /** Una empresa con el portal guardado por el caso de uso: variante A con una tarjeta por sucursal y una zona de la variante B ya cargada. */
  const empresaConPortalGuardado = async () => {
    const m = await empresaConPortal(c);
    const g = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        id: nuevoId(),
        variante: "A",
        lineaSuperior: "Nuestros locales",
        titulo: null,
        logoVisible: true,
        imagen: direccionDeImagen(),
        tarjetas: [
          {
            sucursalId: m.e.otraSucursal,
            orden: 0,
            visible: true,
            nombre: "El Norte",
            telefono: "1155550000",
            foto: direccionDeImagen("foto"),
          },
          { sucursalId: m.e.sucursal, orden: 1, visible: true },
        ],
        zonas: [
          {
            id: nuevoId(),
            sucursalId: m.e.sucursal,
            x: "10",
            y: "10",
            ancho: "20",
            alto: "20",
            visible: true,
          },
        ],
      }),
    );
    return { ...m, codigoDePortal: g.codigo, portalId: g.portalId };
  };
  const vista = (codigo: string) => c.portalPublico.porCodigo(hostDeLaMarca(), codigo);

  it("con el código del portal se ve: textos, imagen como partes, tarjetas en su orden con el nombre propio o el de la carta, y los enlaces a las cartas en línea", async () => {
    const m = await empresaConPortalGuardado();
    const p = await vista(m.codigoDePortal);
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      variante: "A",
      lineaSuperior: "Nuestros locales",
      titulo: null,
      logoVisible: true,
    });
    expect(p?.imagen).toEqual({
      proveedor: "CLOUDINARY",
      cuenta: "mi-cuenta",
      idPublico: "portal",
      version: "1700000000",
      extension: "jpg",
    });
    expect(p?.tarjetas.map((t) => [t.nombre, t.codigoDeCarta])).toEqual([
      ["El Norte", m.carta2.codigo],
      ["Casa central", m.carta1.codigo],
    ]);
    expect(p?.tarjetas[0]?.telefono).toBe("1155550000");
    expect(p?.zonas).toEqual([
      { x: "10.00", y: "10.00", ancho: "20.00", alto: "20.00", codigoDeCarta: m.carta1.codigo },
    ]);
  });

  it("las dos variantes se ofrecen: guardada como B (imagen con zonas) se lee igual, y volver a A y otra vez a B no pierde lo cargado en la otra", async () => {
    const m = await empresaConPortalGuardado();
    const pedir = (variante: "A" | "B", version: number) =>
      c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        id: m.portalId,
        variante,
        logoVisible: true,
        versionEsperada: version,
      });
    const b = valorDe(await pedir("B", 1));
    let p = await vista(m.codigoDePortal);
    expect(p?.variante).toBe("B");
    expect(p?.imagen).not.toBeNull();
    expect(p?.zonas).toHaveLength(1);
    expect(p?.tarjetas).toHaveLength(2);
    const a = valorDe(await pedir("A", b.version));
    p = await vista(m.codigoDePortal);
    expect(p?.variante).toBe("A");
    expect(p?.zonas).toHaveLength(1);
    valorDe(await pedir("B", a.version));
    expect((await vista(m.codigoDePortal))?.zonas).toHaveLength(1);
    // `null` SÍ quita la imagen; ausente la conserva.
    const sin = await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
      id: m.portalId,
      variante: "B",
      logoVisible: true,
      imagen: null,
      versionEsperada: valorDe(await pedir("B", a.version + 1)).version,
    });
    expect(sin.ok).toBe(true);
    expect((await vista(m.codigoDePortal))?.imagen).toBeNull();
  });

  it("no se recorre: código inexistente, sin forma de código, o el de una CARTA puesto como de portal, dan la misma respuesta nula", async () => {
    const m = await empresaConPortalGuardado();
    expect(await vista(codigoAlAzar())).toBeNull();
    expect(await vista("corto")).toBeNull();
    expect(await vista(m.carta1.codigo)).toBeNull();
    const sinCodigo = await comoPublicoDelPortal(
      c.propia.base.publico,
      null,
      "select codigo from portal_de_empresa",
    );
    expect(sinCodigo).toEqual([]);
    const conElDeCarta = await comoPublicoDelPortal(
      c.propia.base.publico,
      m.carta1.codigo,
      "select codigo from portal_de_empresa",
    );
    expect(conElDeCarta).toEqual([]);
  });

  it("aislamiento: un portal nunca muestra cartas, sucursales, tarjetas ni zonas de otra empresa, ni el plan de otro tenant", async () => {
    const a = await empresaConPortalGuardado();
    const b = await empresaConPortalGuardado();
    const q = (tabla: string, col: string, codigo: string) =>
      comoPublicoDelPortal<{ v: string }>(
        c.propia.base.publico,
        codigo,
        `select ${col}::text as v from ${tabla}`,
      );
    expect(
      (await q("carta_publica", "empresa_id", a.codigoDePortal)).map((f) => f.v).sort(),
    ).toEqual([a.e.empresa, a.e.empresa]);
    expect(
      (await q("sucursal", "empresa_id", a.codigoDePortal)).every((f) => f.v === a.e.empresa),
    ).toBe(true);
    expect(
      (await q("portal_tarjeta", "empresa_id", a.codigoDePortal)).every((f) => f.v === a.e.empresa),
    ).toBe(true);
    expect(
      (await q("portal_zona", "empresa_id", a.codigoDePortal)).every((f) => f.v === a.e.empresa),
    ).toBe(true);
    expect((await q("portal_de_empresa", "empresa_id", a.codigoDePortal)).map((f) => f.v)).toEqual([
      a.e.empresa,
    ]);
    // 0083: del plan solo lo del tenant de ESTA empresa.
    expect(
      (await q("plan_de_tenant", "tenant_id", a.codigoDePortal)).every(
        (f) => f.v === a.plan.tenant,
      ),
    ).toBe(true);
    expect((await q("plan_de_tenant", "tenant_id", a.codigoDePortal)).length).toBeGreaterThan(0);
    expect(
      (await q("modulo_de_empresa", "empresa_id", a.codigoDePortal)).every(
        (f) => f.v === a.e.empresa,
      ),
    ).toBe(true);
    expect((await q("version_de_plan", "id", a.codigoDePortal)).map((f) => f.v)).toContain(
      a.plan.version,
    );
    expect((await q("version_de_plan", "id", a.codigoDePortal)).map((f) => f.v)).not.toContain(
      b.plan.version,
    );
    expect(b.codigoDePortal).not.toBe(a.codigoDePortal);
  });

  it("aislamiento: el código de portal de OTRA empresa no devuelve filas de esta, y el portal de una no ve lo de la otra aunque se fije la empresa ajena", async () => {
    const a = await empresaConPortalGuardado();
    const b = await empresaConPortalGuardado();
    const pa = await vista(a.codigoDePortal);
    const pb = await vista(b.codigoDePortal);
    const cartasA = [a.carta1.codigo, a.carta2.codigo].sort();
    expect([...(pa?.tarjetas.map((t) => t.codigoDeCarta) ?? [])].sort()).toEqual(cartasA);
    expect(pb?.tarjetas.map((t) => t.codigoDeCarta).some((x) => cartasA.includes(x))).toBe(false);
    // Con el código de A, las tablas de B no devuelven nada.
    const filas = await comoPublicoDelPortal<{ id: string }>(
      c.propia.base.publico,
      a.codigoDePortal,
      "select id from portal_de_empresa where empresa_id = $1",
      [b.e.empresa],
    );
    expect(filas).toEqual([]);
  });

  it("variante B: un portal solo deja leer la carta de las sucursales con tarjeta o zona VISIBLE; otra sucursal de la empresa no aparece, ni su código", async () => {
    const m = await empresaConPortal(c);
    // Solo la sucursal 1 tiene tarjeta; la sucursal 2 tiene una carta en línea pero ninguna tarjeta ni zona.
    const g = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        id: nuevoId(),
        variante: "A",
        logoVisible: true,
        tarjetas: [{ sucursalId: m.e.sucursal, orden: 0, visible: true }],
      }),
    );
    const cartas = () =>
      comoPublicoDelPortal<{ codigo: string }>(
        c.propia.base.publico,
        g.codigo,
        "select codigo from carta_publica",
      );
    expect((await cartas()).map((f) => f.codigo)).toEqual([m.carta1.codigo]);
    expect((await vista(g.codigo))?.tarjetas.map((t) => t.codigoDeCarta)).toEqual([
      m.carta1.codigo,
    ]);
    const sucursales = await comoPublicoDelPortal<{ id: string }>(
      c.propia.base.publico,
      g.codigo,
      "select id from sucursal",
    );
    expect(sucursales.map((f) => f.id)).toEqual([m.e.sucursal]);
    // Una zona visible hacia la sucursal 2 la abre; ocultarla la cierra otra vez.
    const zona = {
      id: nuevoId(),
      sucursalId: m.e.otraSucursal,
      x: "1",
      y: "1",
      ancho: "5",
      alto: "5",
      visible: true,
    };
    const v2 = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        id: g.portalId,
        variante: "B",
        logoVisible: true,
        zonas: [zona],
        versionEsperada: g.version,
      }),
    );
    expect((await cartas()).map((f) => f.codigo).sort()).toEqual(
      [m.carta1.codigo, m.carta2.codigo].sort(),
    );
    valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        id: g.portalId,
        variante: "B",
        logoVisible: true,
        zonas: [{ ...zona, visible: false }],
        versionEsperada: v2.version,
      }),
    );
    expect((await cartas()).map((f) => f.codigo)).toEqual([m.carta1.codigo]);
    // Y una tarjeta oculta de la sucursal 1 cierra también su carta.
    await c.dueno.query("update portal_tarjeta set visible = false where portal_id = $1", [
      g.portalId,
    ]);
    expect(await cartas()).toEqual([]);
  });

  it("solo sale lo mostrable: carta fuera de línea, sucursal cerrada, tarjeta o zona oculta no aparecen, y nada se borró", async () => {
    const m = await empresaConPortalGuardado();
    await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
      m.carta2.id,
    ]);
    let p = await vista(m.codigoDePortal);
    expect(p?.tarjetas.map((t) => t.codigoDeCarta)).toEqual([m.carta1.codigo]);
    await c.dueno.query("update sucursal set activa = false where id = $1", [m.e.sucursal]);
    p = await vista(m.codigoDePortal);
    expect(p?.tarjetas).toEqual([]);
    expect(p?.zonas).toEqual([]);
    await c.dueno.query("update sucursal set activa = true where id = $1", [m.e.sucursal]);
    await c.dueno.query("update carta_publica set estado = 'EN_LINEA' where id = $1", [
      m.carta2.id,
    ]);
    await c.dueno.query(
      "update portal_tarjeta set visible = false where portal_id = $1 and sucursal_id = $2",
      [m.portalId, m.e.sucursal],
    );
    await c.dueno.query("update portal_zona set visible = false where portal_id = $1", [
      m.portalId,
    ]);
    p = await vista(m.codigoDePortal);
    expect(p?.tarjetas.map((t) => t.codigoDeCarta)).toEqual([m.carta2.codigo]);
    expect(p?.zonas).toEqual([]);
    expect(
      await c.contar("select count(*) as n from portal_tarjeta where portal_id = $1", [m.portalId]),
    ).toBe(2);
  });

  it("plan por visita: una baja de plan, o perder el módulo, oculta el portal en la visita siguiente y al volver el plan vuelve", async () => {
    const m = await empresaConPortalGuardado();
    expect(await vista(m.codigoDePortal)).not.toBeNull();
    const sinCarta = await versionDeLaCarta(c, { conModulo: false, conPerilla: false });
    await asignarVersion(c, m.plan.tenant, sinCarta, haceSegundos(60));
    expect(await vista(m.codigoDePortal)).toBeNull();
    await asignarVersion(c, m.plan.tenant, m.plan.version, haceSegundos(30));
    expect(await vista(m.codigoDePortal)).not.toBeNull();
    await c.dueno.query(
      "update modulo_de_empresa set activo = false where empresa_id = $1 and modulo = 'vidriera'",
      [m.e.empresa],
    );
    expect(await vista(m.codigoDePortal)).toBeNull();
    await c.dueno.query(
      "update modulo_de_empresa set activo = true where empresa_id = $1 and modulo = 'vidriera'",
      [m.e.empresa],
    );
    expect(await vista(m.codigoDePortal)).not.toBeNull();
    // Sin la perilla de la carta por QR (extra de pago) tampoco.
    await asignarVersion(
      c,
      m.plan.tenant,
      await versionDeLaCarta(c, { conModulo: true, conPerilla: false }),
      haceSegundos(10),
    );
    expect(await vista(m.codigoDePortal)).toBeNull();
  });

  it("el host: otra marca no lo sirve, y uno dedicado a otra empresa tampoco", async () => {
    const m = await empresaConPortalGuardado();
    const otraMarca = await c.portalPublico.porCodigo(
      { marcaId: "00000000-0000-4000-8000-0000000000b9", duenio: { tipo: "MARCA" } },
      m.codigoDePortal,
    );
    expect(otraMarca).toBeNull();
    const ajeno = await c.portalPublico.porCodigo(
      {
        ...hostDeLaMarca(),
        duenio: { tipo: "EMPRESA", empresaId: "00000000-0000-4000-8000-0000000000e1" },
      },
      m.codigoDePortal,
    );
    expect(ajeno).toBeNull();
    const propio = await c.portalPublico.porCodigo(
      { ...hostDeLaMarca(), duenio: { tipo: "EMPRESA", empresaId: m.e.empresa } },
      m.codigoDePortal,
    );
    expect(propio).not.toBeNull();
  });

  it("hrefDelPortal: con el código de UNA carta se obtiene el código del portal de SU empresa (y solo si el portal se sirve); nunca el de otra", async () => {
    const m = await empresaConPortalGuardado();
    const otra = await empresaConPortalGuardado();
    expect(await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), m.carta1.codigo)).toBe(
      m.codigoDePortal,
    );
    expect(
      await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), otra.carta2.codigo),
    ).toBe(otra.codigoDePortal);
    expect(
      await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), codigoAlAzar()),
    ).toBeNull();
    expect(
      await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), m.codigoDePortal),
    ).toBeNull();
    await asignarVersion(
      c,
      m.plan.tenant,
      await versionDeLaCarta(c, { conModulo: false, conPerilla: false }),
      haceSegundos(5),
    );
    expect(
      await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), m.carta1.codigo),
    ).toBeNull();
    // Una empresa sin portal: sin flecha.
    const sin = await empresaConPortal(c);
    expect(
      await c.portalPublico.codigoDelPortalDeLaCarta(hostDeLaMarca(), sin.carta1.codigo),
    ).toBeNull();
  });

  it("privilegios: el rol público lee EXACTAMENTE las columnas declaradas, sin creado_por, fechas ni versión, y no escribe ni borra", async () => {
    const r = await c.filas<{ tabla: string; columnas: string }>(
      `select table_name as tabla, string_agg(column_name, ',' order by column_name) as columnas
         from information_schema.column_privileges
        where grantee = 'pedernal_publico' and privilege_type = 'SELECT' and table_schema = 'public'
          and table_name in ('portal_de_empresa', 'portal_tarjeta', 'portal_zona')
        group by table_name order by table_name`,
    );
    const esperado = Object.entries(COLUMNAS_PUBLICAS_DE_PORTAL)
      .map(([tabla, columnas]) => ({ tabla, columnas: [...columnas].sort().join(",") }))
      .sort((x, y) => x.tabla.localeCompare(y.tabla));
    expect(r).toEqual(esperado);
    const otros = await c.filas<{ tabla: string; privilegio: string }>(
      `select table_name as tabla, privilege_type as privilegio from information_schema.table_privileges
        where grantee in ('pedernal_publico', 'pedernal_app') and table_schema = 'public'
          and table_name in ('portal_de_empresa', 'portal_tarjeta', 'portal_zona') and privilege_type in ('DELETE', 'TRUNCATE')`,
    );
    expect(otros).toEqual([]);
    const escribe = await c.filas<{ n: string }>(
      `select count(*) as n from information_schema.column_privileges where grantee = 'pedernal_publico' and table_name like 'portal_%' and privilege_type <> 'SELECT'`,
    );
    expect(Number(escribe[0]?.n)).toBe(0);
  });
});
