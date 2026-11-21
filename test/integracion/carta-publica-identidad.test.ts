import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarVistaDeVidriera } from "../../src/capacidades/experiencia/vidriera/vista";
import { temaDeLaCarta } from "../../src/capacidades/experiencia/vidriera/tema-de-la-carta";
import { deLaMarca } from "../utilidades/alcance-del-host";
import { montarCatalogo, precioDeBase } from "./catalogo-apoyo";
import { cartaDeBase, empresaDeCarta } from "./carta-publica-apoyo";
import {
  MARCA_DEL_HOST,
  adaptadorReal,
  darleLaCartaAlPlan,
  type Catalogo,
} from "./carta-publica-lectura-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * V1b contra la base real y el rol público: lo que la persona eligió en «Carta en línea» (cara, color propio, logo; migración 0077) llega, por el puerto real de la carta, a la vista que dibuja la carta
 * pública: la cara que rige, el tema que sale de ella y del color elegido (guardado COMO SE ELIGIÓ: el ajuste de contraste se calcula al mostrar) y la inicial del nombre. Una carta que no eligió nada no
 * lleva tema. Lo de una empresa no toca a la carta de otra. Las páginas que pintan la vista: `test/web/vidriera-identidad.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const despues = (): Date => new Date(Date.now() + 120_000);

describe.skipIf(base === null)("la identidad de la carta llega a la carta pública", () => {
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

  const empresaConCarta = async (nombre = "Parador El Ensayo") => {
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
    const carta = await cartaDeBase(c.dueno, e.empresa, e.s1, { nombre });
    await darleLaCartaAlPlan(c, e.empresa);
    return { ...e, carta };
  };
  const vistaDe = async (codigo: string) => {
    const publicada = await vidriera.porCodigo(deLaMarca(MARCA_DEL_HOST), codigo);
    if (publicada === null) throw new Error("la carta tendría que servirse");
    return armarVistaDeVidriera(publicada, `/${codigo}`);
  };
  const elegir = (id: string, columnas: Record<string, string | null>) =>
    c.dueno.query(
      `update carta_publica set ${Object.keys(columnas)
        .map((k, i) => `${k} = $${String(i + 2)}`)
        .join(", ")} where id = $1`,
      [id, ...Object.values(columnas)],
    );

  it("la cara y el color propio elegidos llegan como el tema de esa cara, con la inicial del nombre", async () => {
    const m = await empresaConCarta("Parador El Ensayo");
    await elegir(m.carta.id, { cara: "NOCHE", color_propio: "#1f4e79" });
    const vista = await vistaDe(m.carta.codigo);
    expect(vista.identidad).toEqual({
      cara: "NOCHE",
      tema: (temaDeLaCarta("NOCHE", "#1f4e79") as { valor: unknown }).valor,
      inicial: "P",
    });
  });

  it("cada cara da su tema: no son el mismo", async () => {
    const m = await empresaConCarta();
    const temas = new Set<string>();
    for (const cara of ["DIA", "BOLICHE", "NOCHE"]) {
      await elegir(m.carta.id, { cara, color_propio: "#7a1f2b" });
      const { identidad } = await vistaDe(m.carta.codigo);
      expect(identidad.cara).toBe(cara);
      temas.add(JSON.stringify(identidad.tema));
    }
    expect(temas.size).toBe(3);
  });

  it("un color de bajo contraste se guardó como se eligió y se muestra ajustado (7:1 con su texto)", async () => {
    const m = await empresaConCarta();
    await elegir(m.carta.id, { cara: "DIA", color_propio: "#808080" });
    const { rows } = await c.dueno.query<{ color_propio: string | null }>(
      "select color_propio from carta_publica where id = $1",
      [m.carta.id],
    );
    expect(rows[0]?.["color_propio"]).toBe("#808080");
    const { identidad } = await vistaDe(m.carta.codigo);
    expect(identidad.tema?.primariaFondo).not.toBe("#808080");
    expect(identidad.tema?.primariaTexto).toBe("#ffffff");
  });

  it("solo el color elegido: rige la cara de siempre (DIA); solo la cara: rige el color por defecto", async () => {
    const m = await empresaConCarta();
    await elegir(m.carta.id, { color_propio: "#17562f" });
    expect((await vistaDe(m.carta.codigo)).identidad).toMatchObject({ cara: "DIA" });
    expect((await vistaDe(m.carta.codigo)).identidad.tema?.primariaFondo).toBe("#17562f");
    await elegir(m.carta.id, { color_propio: null, cara: "BOLICHE" });
    const solo = await vistaDe(m.carta.codigo);
    expect(solo.identidad.cara).toBe("BOLICHE");
    expect(solo.identidad.tema).not.toBeNull();
  });

  it("una carta que no eligió nada no lleva tema (se ve como siempre)", async () => {
    const m = await empresaConCarta();
    expect((await vistaDe(m.carta.codigo)).identidad).toEqual({
      cara: "DIA",
      tema: null,
      inicial: "P",
    });
  });

  it("el logo elegido no cambia lo que se dibuja todavía (la CSP no deja imágenes de afuera) y no se cuela en la vista", async () => {
    const m = await empresaConCarta();
    await elegir(m.carta.id, {
      cara: "DIA",
      logo_proveedor: "CLOUDINARY",
      logo_cuenta: "demo",
      logo_id_publico: "logos/parador",
      logo_version: "1700000000",
      logo_extension: "png",
    });
    const vista = await vistaDe(m.carta.codigo);
    expect(JSON.stringify(vista)).not.toContain("cloudinary");
    expect(JSON.stringify(vista)).not.toContain("logos/parador");
  });

  it("la identidad de una empresa no toca a la carta de otra", async () => {
    const a = await empresaConCarta("Alfa");
    const b = await empresaConCarta("Beta");
    await elegir(a.carta.id, { cara: "NOCHE", color_propio: "#1f4e79" });
    expect((await vistaDe(b.carta.codigo)).identidad).toEqual({
      cara: "DIA",
      tema: null,
      inicial: "B",
    });
    expect((await vistaDe(a.carta.codigo)).identidad.cara).toBe("NOCHE");
  });
});
