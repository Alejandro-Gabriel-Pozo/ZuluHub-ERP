import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearMemoriaDeLogos } from "../../src/capacidades/activos/memoria-de-logos";
import type { AlcanceDelHost } from "../../src/capacidades/experiencia/puerta";
import { logoPublicoDeLaCarta } from "../../src/capacidades/experiencia/vidriera/logo-publico";
import type { ImagenesExternas } from "../../src/puertos/imagenes-externas";
import { ok } from "../../src/primitivas/resultado/resultado";
import { deLaEmpresa, deLaMarca } from "../utilidades/alcance-del-host";
import { montarCatalogo, precioDeBase } from "./catalogo-apoyo";
import { cartaDeBase, empresaDeCarta } from "./carta-publica-apoyo";
import {
  MARCA_DEL_HOST,
  OTRA_MARCA,
  adaptadorReal,
  asignarVersion,
  darleLaCartaAlPlan,
  versionDeLaCarta,
  type Catalogo,
} from "./carta-publica-lectura-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * El logo de la carta contra la base real y el rol público (V1c, §5.7.5): el traedor es de mentira (lo que se prueba acá es la PUERTA: qué cartas dejan salir
 * a internet y cuáles no), y la memoria es la real. Una carta que no se sirve (otra marca, otro dueño de host, fuera de línea, sucursal cerrada, plan sin la perilla),
 * una versión vieja o un logo ajeno dan la MISMA respuesta vacía y no cuestan ni una conexión saliente.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const BYTES = new Uint8Array([9, 9, 9]);
const LOGO = {
  logo_proveedor: "CLOUDINARY",
  logo_cuenta: "demo",
  logo_id_publico: "logos/parador",
  logo_version: "1700000000",
  logo_extension: "png",
};
const TRAMO = "1700000000.webp";
const despues = (): Date => new Date(Date.now() + 120_000);

describe.skipIf(base === null)("el logo de la carta pública, contra la base real", () => {
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

  const empresaConCarta = async (plan: "completo" | "sin-perilla" = "completo") => {
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
    if (plan === "completo") {
      await darleLaCartaAlPlan(c, e.empresa);
    } else {
      const { rows } = await c.dueno.query<{ tenant_id: string }>(
        "select tenant_id from empresa where id = $1",
        [e.empresa],
      );
      await asignarVersion(
        c,
        rows[0]?.tenant_id as string,
        await versionDeLaCarta(c, { conPerilla: false }),
      );
      await c.dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'vidriera')",
        [e.empresa],
      );
    }
    await c.dueno.query(
      `update carta_publica set logo_proveedor = $2, logo_cuenta = $3, logo_id_publico = $4, logo_version = $5, logo_extension = $6 where id = $1`,
      [carta.id, ...Object.values(LOGO)],
    );
    return { ...e, carta };
  };

  /** Lo que arma la composición: la puerta real, el traedor de mentira que cuenta sus viajes y una memoria nueva. */
  const sistema = () => {
    const traerLogo = vi.fn<ImagenesExternas["traerLogo"]>(() => Promise.resolve(ok(BYTES)));
    const pedir = (host: AlcanceDelHost, codigo: string, tramo = TRAMO) =>
      logoPublicoDeLaCarta(
        { vidriera, traedor: { traerLogo }, memoria: crearMemoriaDeLogos(() => Date.now()) },
        host,
        codigo,
        tramo,
      );
    return { traerLogo, pedir };
  };

  it("una carta en línea, de esta marca y con su plan: se sirve, y el destino sale de lo guardado", async () => {
    const m = await empresaConCarta();
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBe(BYTES);
    expect(traerLogo).toHaveBeenCalledTimes(1);
    expect(traerLogo.mock.calls[0]?.[0].url).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_limit,w_240,h_240,f_webp,q_80/v1700000000/logos/parador.png",
    );
  });

  it("el host dedicado de ESA empresa también la sirve", async () => {
    const m = await empresaConCarta();
    const { pedir } = sistema();
    expect(await pedir(deLaEmpresa(MARCA_DEL_HOST, m.empresa), m.carta.codigo)).toBe(BYTES);
  });

  it("A-1: la misma respuesta vacía, sin salir a internet, para otra marca, otra empresa en un host dedicado, código inventado o malformado", async () => {
    const m = await empresaConCarta();
    const otra = await empresaConCarta();
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(OTRA_MARCA), m.carta.codigo)).toBeNull();
    expect(await pedir(deLaEmpresa(MARCA_DEL_HOST, otra.empresa), m.carta.codigo)).toBeNull();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), "no-existe-0123456789ab")).toBeNull();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), "../etc/passwd")).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("una carta fuera de línea deja de entregar su logo", async () => {
    const m = await empresaConCarta();
    await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
      m.carta.id,
    ]);
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("una sucursal cerrada tampoco", async () => {
    const m = await empresaConCarta();
    await c.dueno.query("update sucursal set activa = false where id = $1", [m.s1]);
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("un plan sin la perilla de la carta no la sirve ni entrega su logo", async () => {
    const m = await empresaConCarta("sin-perilla");
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("una carta sin logo, o una versión vieja, nueva o inventada: vacío y sin salir a internet", async () => {
    const m = await empresaConCarta();
    const sinLogo = await empresaConCarta();
    await c.dueno.query(
      "update carta_publica set logo_proveedor = null, logo_cuenta = null, logo_id_publico = null, logo_version = null, logo_extension = null where id = $1",
      [sinLogo.carta.id],
    );
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), sinLogo.carta.codigo)).toBeNull();
    for (const tramo of ["1699999999.webp", "1700000001.webp", "1700000000", "1700000000.png"]) {
      expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo, tramo), tramo).toBeNull();
    }
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("al cambiar el logo, la versión nueva se sirve y la vieja deja de servirse", async () => {
    const m = await empresaConCarta();
    const { traerLogo, pedir } = sistema();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBe(BYTES);
    await c.dueno.query("update carta_publica set logo_version = '1800000000' where id = $1", [
      m.carta.id,
    ]);
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBeNull();
    expect(await pedir(deLaMarca(MARCA_DEL_HOST), m.carta.codigo, "1800000000.webp")).toBe(BYTES);
    expect(traerLogo).toHaveBeenCalledTimes(2);
  });

  it("20 visitas a la vez a la misma carta: una sola conexión saliente y la misma respuesta para todas", async () => {
    const m = await empresaConCarta();
    let abrir: (() => void) | undefined;
    const traerLogo = vi.fn<ImagenesExternas["traerLogo"]>(
      () =>
        new Promise((resolver) => {
          abrir = () => resolver(ok(BYTES));
        }),
    );
    const memoria = crearMemoriaDeLogos(() => Date.now());
    const visitas = Array.from({ length: 20 }, () =>
      logoPublicoDeLaCarta(
        { vidriera, traedor: { traerLogo }, memoria },
        deLaMarca(MARCA_DEL_HOST),
        m.carta.codigo,
        TRAMO,
      ),
    );
    await vi.waitFor(() => expect(traerLogo).toHaveBeenCalledTimes(1));
    abrir?.();
    const todas = await Promise.all(visitas);
    expect(todas.every((b) => b === BYTES)).toBe(true);
    expect(traerLogo).toHaveBeenCalledTimes(1);
  });

  it("la misma visita repetida (doble clic, reintento) no repite el viaje", async () => {
    const m = await empresaConCarta();
    const { traerLogo, pedir: unaVez } = sistema();
    expect(await unaVez(deLaMarca(MARCA_DEL_HOST), m.carta.codigo)).toBe(BYTES);
    expect(traerLogo).toHaveBeenCalledTimes(1);
  });
});
