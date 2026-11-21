import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { valorDe } from "./catalogo-apoyo";
import type { BaseDePruebas } from "./global";
import { empresaConPortal, montarPortal, nuevoId, type Montaje } from "./portal-apoyo";

/** Dos acciones a la vez sobre el mismo portal (contra una base real): una gana, la otra recibe el aviso, y nunca queda un estado a medias ni dos portales. */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("portal de la vidriera: concurrencia (0078)", () => {
  let c: Montaje;
  beforeAll(async () => {
    c = await montarPortal(base as BaseDePruebas);
  });
  afterAll(async () => {
    await c.cerrar();
  });

  it("dos administradores lo crean a la vez con ids distintos: queda UN portal y un solo código; el que llegó segundo no crea otro", async () => {
    const m = await empresaConPortal(c);
    const pedir = (quien: typeof m.e.gerente, titulo: string) =>
      c.casos.guardarPortalDeLaVidriera(quien, {
        id: nuevoId(),
        variante: "A",
        titulo,
        logoVisible: true,
      });
    const r = await Promise.all([pedir(m.e.gerente, "Uno"), pedir(m.e.administrador, "Dos")]);
    expect(
      await c.contar("select count(*) as n from portal_de_empresa where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(1);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
  });

  it("dos ediciones con la misma versión a la vez: una gana y la otra recibe VERSION_DESACTUALIZADA; el portal queda con una sola de las dos", async () => {
    const m = await empresaConPortal(c);
    const id = nuevoId();
    const a = valorDe(
      await c.casos.guardarPortalDeLaVidriera(m.e.gerente, {
        id,
        variante: "A",
        logoVisible: true,
      }),
    );
    const editar = (titulo: string) =>
      c.casos.guardarPortalDeLaVidriera(m.e.gerente, {
        id,
        variante: "A",
        logoVisible: true,
        titulo,
        versionEsperada: a.version,
      });
    const r = await Promise.all([editar("Uno"), editar("Dos")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const titulo = (
      await c.filas<{ titulo: string }>(
        "select titulo from portal_de_empresa where empresa_id = $1",
        [m.e.empresa],
      )
    )[0]?.titulo;
    expect(["Uno", "Dos"]).toContain(titulo);
  });

  it("la misma acción repetida a la vez (clic doble): un portal, una auditoría, y las dos respuestas con el mismo código", async () => {
    const m = await empresaConPortal(c);
    const entrada = {
      id: nuevoId(),
      variante: "A",
      logoVisible: true,
      tarjetas: [{ sucursalId: m.e.sucursal, orden: 0, visible: true }],
    } as const;
    const r = await Promise.all([
      c.casos.guardarPortalDeLaVidriera(m.e.gerente, entrada),
      c.casos.guardarPortalDeLaVidriera(m.e.gerente, entrada),
    ]);
    const [x, y] = r.map((q) => valorDe(q));
    expect(x?.codigo).toBe(y?.codigo);
    expect(
      await c.contar("select count(*) as n from portal_de_empresa where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(1);
    expect(await c.auditoria(m.e.empresa, "PORTAL_CREADO")).toHaveLength(1);
    expect(
      await c.contar("select count(*) as n from portal_tarjeta where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(1);
  });
});
