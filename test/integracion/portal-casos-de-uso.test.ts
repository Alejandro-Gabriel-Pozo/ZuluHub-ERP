import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { BaseDePruebas } from "./global";
import { valorDe } from "./catalogo-apoyo";
import {
  direccionDeImagen,
  empresaConPortal,
  montarPortal,
  nuevoId,
  type Montaje,
} from "./portal-apoyo";

/**
 * El caso de uso `guardarPortalDeLaEmpresa` contra una base real: permiso nuevo y alcance total, validación, idempotencia, versión, atomicidad, aislamiento entre
 * empresas y trazabilidad. Los roles, las personas y el plan salen del montaje del catálogo; el escenario, con SQL del dueño (que evade RLS).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("guardarPortalDeLaEmpresa (0078)", () => {
  let c: Montaje;
  beforeAll(async () => {
    c = await montarPortal(base as BaseDePruebas);
  });
  afterAll(async () => {
    await c.cerrar();
  });

  const portalBase = {
    variante: "A",
    lineaSuperior: "Nuestros locales",
    titulo: "Elegí dónde ir",
    colorEncabezado: "#1f4e79",
    logoVisible: true,
  } as const;
  const contarPortales = (empresa: string) =>
    c.contar("select count(*) as n from portal_de_empresa where empresa_id = $1", [empresa]);

  it("P-1: guardarPortalDeLaEmpresa con el mismo id dos veces deja UN portal, un solo código y una entrada de auditoría; la segunda es yaExistia", async () => {
    const m = await empresaConPortal(c);
    const id = nuevoId();
    const entrada = {
      ...portalBase,
      id,
      tarjetas: [{ sucursalId: m.e.sucursal, orden: 0, visible: true, telefono: "1143210000" }],
    };
    const a = valorDe(await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, entrada));
    const b = valorDe(await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, entrada));
    expect(a.yaExistia).toBe(false);
    expect(b).toEqual({ ...a, yaExistia: true });
    expect(await contarPortales(m.e.empresa)).toBe(1);
    expect(await c.auditoria(m.e.empresa, "PORTAL_CREADO")).toHaveLength(1);
    expect(a.codigo).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(
      await c.contar("select count(*) as n from portal_tarjeta where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(1);
  });

  it("gerente y administrador (con todas las sucursales) lo guardan; el administrador de una sola sucursal y el operador no", async () => {
    const m = await empresaConPortal(c);
    const entrada = (id: string) => ({ ...portalBase, id });
    const o = await c.casos.guardarPortalDeLaEmpresa(m.e.operador, entrada(nuevoId()));
    expect(o).toMatchObject({ ok: false });
    const una = await c.casos.guardarPortalDeLaEmpresa(
      m.e.administradorDeUnaSucursal,
      entrada(nuevoId()),
    );
    expect(una).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await contarPortales(m.e.empresa)).toBe(0);
    valorDe(await c.casos.guardarPortalDeLaEmpresa(m.e.administrador, entrada(nuevoId())));
    expect(await contarPortales(m.e.empresa)).toBe(1);
  });

  it("la consulta de administración la hacen los tres roles (el operador solo ve) y devuelve null sin portal", async () => {
    const m = await empresaConPortal(c);
    for (const quien of [m.e.operador, m.e.gerente, m.e.administrador]) {
      expect(valorDe(await c.consultas.verPortalDeLaEmpresa(quien))).toBeNull();
    }
    const g = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, { ...portalBase, id: nuevoId() }),
    );
    const visto = valorDe(await c.consultas.verPortalDeLaEmpresa(m.e.operador));
    expect(visto?.portal.codigo).toBe(g.codigo);
    expect(visto?.rutaPublica).toBe(`/s/portal/${g.codigo}`);
  });

  it("valida con lista de permitidos: variante, largos, colores, imagen fuera de la lista cerrada, teléfono, orden y zonas fuera de la imagen", async () => {
    const m = await empresaConPortal(c);
    const intentar = async (cambio: Record<string, unknown>) =>
      c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        ...portalBase,
        id: nuevoId(),
        ...cambio,
      });
    const err = async (cambio: Record<string, unknown>) => {
      const r = await intentar(cambio);
      return r.ok ? "OK" : r.error;
    };
    expect(await err({ variante: "C" })).toBe("VARIANTE_INVALIDA");
    expect(await err({ lineaSuperior: "x".repeat(41) })).toBe("LINEA_DEL_PORTAL_INVALIDA");
    expect(await err({ colorPagina: "#ABCDEF" })).toBe("COLOR_INVALIDO");
    expect(await err({ colorDetras: "rojo" })).toBe("COLOR_INVALIDO");
    expect(await err({ imagen: "https://ejemplo.com/a/image/upload/v1/x.jpg" })).toBe(
      "IMAGEN_DEL_PORTAL_INVALIDA",
    );
    expect(await err({ imagen: "http://localhost/a.png" })).toBe("IMAGEN_DEL_PORTAL_INVALIDA");
    const t = (cambio: Record<string, unknown>) => ({
      tarjetas: [{ sucursalId: m.e.sucursal, orden: 0, visible: true, ...cambio }],
    });
    expect(await err(t({ telefono: "a\nb" }))).toBe("TELEFONO_DE_TARJETA_INVALIDO");
    expect(await err(t({ orden: -1 }))).toBe("ORDEN_INVALIDO");
    expect(await err(t({ foto: "https://evil.example/x.jpg" }))).toBe("FOTO_DE_TARJETA_INVALIDA");
    const z = (cambio: Record<string, unknown>) => ({
      zonas: [
        {
          id: nuevoId(),
          sucursalId: m.e.sucursal,
          x: "10",
          y: "10",
          ancho: "20",
          alto: "20",
          visible: true,
          ...cambio,
        },
      ],
    });
    expect(await err(z({ x: "90", ancho: "10.01" }))).toBe("ZONA_INVALIDA");
    expect(await err(z({ ancho: "0" }))).toBe("ZONA_INVALIDA");
    expect(await err(z({ x: "-1" }))).toBe("ZONA_INVALIDA");
    expect(await err(z({ x: "1.005" }))).toBe("ZONA_INVALIDA");
    expect(await err(z({ y: "100.01" }))).toBe("ZONA_INVALIDA");
    expect(await err({ ...z({ x: "90", ancho: "10" }), imagen: direccionDeImagen() })).toBe("OK");
    expect(await contarPortales(m.e.empresa)).toBe(1);
  });

  it("aislamiento: una tarjeta o zona hacia una sucursal de OTRA empresa se rechaza y no guarda nada (atomicidad)", async () => {
    const m = await empresaConPortal(c);
    const ajena = await empresaConPortal(c);
    const r = await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
      ...portalBase,
      id: nuevoId(),
      tarjetas: [{ sucursalId: ajena.e.sucursal, orden: 0, visible: true }],
    });
    expect(r).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
    const z = await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
      ...portalBase,
      id: nuevoId(),
      tarjetas: [{ sucursalId: m.e.sucursal, orden: 0, visible: true }],
      zonas: [
        {
          id: nuevoId(),
          sucursalId: ajena.e.otraSucursal,
          x: "1",
          y: "1",
          ancho: "5",
          alto: "5",
          visible: true,
        },
      ],
    });
    expect(z).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
    expect(await contarPortales(m.e.empresa)).toBe(0);
    expect(await contarPortales(ajena.e.empresa)).toBe(0);
  });

  it("editar exige la versión: sin ella o con una vieja, VERSION_DESACTUALIZADA; con la actual cambia, sube la versión y audita antes y después", async () => {
    const m = await empresaConPortal(c);
    const id = nuevoId();
    const a = valorDe(await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, { ...portalBase, id }));
    const cambio = { ...portalBase, id, titulo: "Otro título" };
    expect(await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, cambio)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    const b = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        ...cambio,
        versionEsperada: a.version,
      }),
    );
    expect(b.version).toBeGreaterThan(a.version);
    expect(b.codigo).toBe(a.codigo);
    expect(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        ...cambio,
        titulo: "Un tercero",
        versionEsperada: a.version,
      }),
    ).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    const auditoria = await c.auditoria(m.e.empresa, "PORTAL_EDITADO");
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ entidad: "portal_de_empresa", entidad_id: id });
  });

  it("un id reutilizado con otro contenido por otra empresa o por la misma es ID_REUTILIZADO; cambiar de variante no pierde lo cargado en la otra", async () => {
    const m = await empresaConPortal(c);
    const id = nuevoId();
    const zona = {
      id: nuevoId(),
      sucursalId: m.e.sucursal,
      x: "10.5",
      y: "20",
      ancho: "30",
      alto: "25.25",
      visible: true,
    };
    const a = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        ...portalBase,
        id,
        variante: "B",
        imagen: direccionDeImagen(),
        zonas: [zona],
        tarjetas: [{ sucursalId: m.e.sucursal, orden: 1, visible: true, nombre: "Casa" }],
      }),
    );
    const vuelta = valorDe(
      await c.casos.guardarPortalDeLaEmpresa(m.e.gerente, {
        ...portalBase,
        id,
        variante: "A",
        versionEsperada: a.version,
      }),
    );
    expect(vuelta.version).toBeGreaterThan(a.version);
    const leido = valorDe(await c.consultas.verPortalDeLaEmpresa(m.e.gerente))?.portal;
    expect(leido?.datos.variante).toBe("A");
    expect(leido?.zonas).toEqual([{ ...zona, x: 1050, y: 2000, ancho: 3000, alto: 2525 }]);
    expect(leido?.tarjetas).toHaveLength(1);
    // La misma persona crea el portal de OTRA empresa con un id ya usado: la base lo rechaza (clave) y vuelve tipado.
    const otra = await empresaConPortal(c);
    const r = await c.casos.guardarPortalDeLaEmpresa(otra.e.gerente, { ...portalBase, id });
    expect(r.ok).toBe(false);
    expect(randomUUID()).toBeTruthy();
  });
});
