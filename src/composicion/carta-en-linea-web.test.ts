import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cambiarElEstadoDeLaCartaEnLinea,
  direccionPublicaDeLaCarta,
  guardarLaCartaEnLinea,
  verLaCartaEnLinea,
  type DependenciasDeCartaEnLineaWeb,
} from "./carta-en-linea-web";

/**
 * La pantalla «Carta en línea» (C1) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/carta-en-linea-web.test.ts`.
 */
const CARTA = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SUCURSAL = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OTRA = "7d2e1f00-1111-4222-8333-944455556666";
const CODIGO = "AbCdEfGhIjKlMnOpQrStUv";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const VIGENTE = {
  id: CARTA,
  codigo: CODIGO,
  rutaPublica: `/s/carta/${CODIGO}`,
  nombre: "Parador",
  rubro: "Parrilla",
  lugar: null,
  mensajeDePortada: "Desliza para ver el menú",
  estado: "FUERA_DE_LINEA",
  modelo: "LISTA",
  cara: "BOLICHE",
  colorPropio: "#1f4e79",
  logo: {
    proveedor: "CLOUDINARY",
    cuenta: "demo",
    idPublico: "logos/parador",
    version: "1700000000",
    extension: "png",
  },
  version: 3,
};
const LOGO_DIRECCION = "https://res.cloudinary.com/demo/image/upload/v1700000000/logos/parador.png";
const VISIBILIDAD = {
  salen: 12,
  faltan: { desactivados: 1, ocultos: 2, sinSeccion: 3, sinPrecio: 4 },
};

type Montaje = {
  vista: () => unknown;
  guardar: () => unknown;
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
};
const montar = (
  cambios: Partial<Pick<Montaje, "vista" | "guardar">> = {},
  hostPropio: string | null = null,
) => {
  const m: Montaje = {
    vista: () => ok({ carta: VIGENTE, sucursalActiva: true, visibilidad: VISIBILIDAD }),
    guardar: () =>
      ok({ cartaId: CARTA, codigo: CODIGO, estado: "EN_LINEA", version: 4, yaExistia: false }),
    llamadas: [],
    registrados: [],
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      guardarCartaPublica: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "guardar", entrada });
        return Promise.resolve(m.guardar());
      },
    }),
    consultas: () => ({
      verCartaPublica: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "ver", entrada });
        return Promise.resolve(m.vista());
      },
    }),
    hostPropioDeLaCarta: () => () => Promise.resolve(hostPropio),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeCartaEnLineaWeb;
  return { m, d };
};
const GENERICO = {
  ok: false,
  error: {
    codigo: "CATALOGO_ACCION_NO_PERMITIDA",
    clave: "catalogo.error.accion_no_permitida",
    presentacion: "AVISO",
  },
};
const queLlamo = (m: Montaje) => m.llamadas.map((l) => l.que);

describe("direccionPublicaDeLaCarta", () => {
  it("con host: https y el camino del código; sin host: solo el camino", () => {
    expect(direccionPublicaDeLaCarta("app.ejemplo.test", CODIGO)).toBe(
      `https://app.ejemplo.test/${CODIGO}`,
    );
    expect(direccionPublicaDeLaCarta(null, CODIGO)).toBe(`/${CODIGO}`);
  });
});

describe("verLaCartaEnLinea: dirección propia (DEC-0913)", () => {
  it("con dirección propia activa, la dirección sale ahí; sin ella, en el host de la marca", async () => {
    const propio = montar({}, "carta.cliente.test");
    const r1 = await verLaCartaEnLinea(propio.d, contexto, {
      sucursalId: SUCURSAL,
      hostDeApp: "app.ejemplo.test",
    });
    expect(r1.ok && r1.dato.direccion).toBe(`https://carta.cliente.test/${CODIGO}`);
    const sin = montar();
    const r2 = await verLaCartaEnLinea(sin.d, contexto, {
      sucursalId: SUCURSAL,
      hostDeApp: "app.ejemplo.test",
    });
    expect(r2.ok && r2.dato.direccion).toBe(`https://app.ejemplo.test/${CODIGO}`);
  });
});

describe("verLaCartaEnLinea", () => {
  it("trae la carta sin el código ni el mensaje, la dirección, un QR que no lleva el texto de la dirección y la cuenta de productos", async () => {
    const { d } = montar();
    const r = await verLaCartaEnLinea(d, contexto, {
      sucursalId: SUCURSAL,
      hostDeApp: "app.ejemplo.test",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.carta).toEqual({
      id: CARTA,
      nombre: "Parador",
      rubro: "Parrilla",
      lugar: null,
      estado: "FUERA_DE_LINEA",
      version: 3,
      cara: "BOLICHE",
      colorPropio: "#1f4e79",
      logo: LOGO_DIRECCION,
    });
    expect(r.dato.direccion).toBe(`https://app.ejemplo.test/${CODIGO}`);
    expect(r.dato.qrSvg).toMatch(/^<svg /);
    expect(r.dato.qrSvg).not.toContain(CODIGO);
    expect(r.dato.salen).toBe(12);
    expect(r.dato.faltan).toEqual({ sinPrecio: 4, sinSeccion: 3, desactivados: 1, ocultos: 2 });
    expect(JSON.stringify(r)).not.toContain("Desliza");
  });

  it("sin carta: sin dirección ni QR, pero con la cuenta; sin host: la dirección es el camino y no hay QR", async () => {
    const sin = montar({
      vista: () => ok({ carta: null, sucursalActiva: true, visibilidad: VISIBILIDAD }),
    });
    expect(
      await verLaCartaEnLinea(sin.d, contexto, { sucursalId: SUCURSAL, hostDeApp: "h" }),
    ).toMatchObject({
      ok: true,
      dato: { carta: null, direccion: null, qrSvg: null, salen: 12 },
    });
    const { d } = montar();
    expect(
      await verLaCartaEnLinea(d, contexto, { sucursalId: SUCURSAL, hostDeApp: null }),
    ).toMatchObject({
      ok: true,
      dato: { direccion: `/${CODIGO}`, qrSvg: null },
    });
  });

  it("el motivo del guard sale tal cual y una excepción sale sin detalle, con referencia", async () => {
    const guard = montar({ vista: () => err("MODULO_EN_DESARROLLO") });
    const r = await verLaCartaEnLinea(guard.d, contexto, { sucursalId: SUCURSAL, hostDeApp: null });
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
    const rota = montar({
      vista: () => {
        throw new Error("la base no responde");
      },
    });
    const e = await verLaCartaEnLinea(rota.d, contexto, { sucursalId: SUCURSAL, hostDeApp: null });
    expect(e.ok).toBe(false);
    expect(JSON.stringify(e)).not.toContain("la base no responde");
    expect(rota.m.registrados.join(" ")).toContain("la base no responde");
  });
});

describe("guardarLaCartaEnLinea", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    cartaId: CARTA,
    sucursalId: SUCURSAL,
    versionEsperada: 3,
    nombre: "Nuevo",
    rubro: "",
    lugar: "Huinganco",
    ...extra,
  });

  it("pide al caso de uso los textos nuevos con el estado y el mensaje VIGENTES y la versión vista; la empresa y la persona no viajan", async () => {
    const { m, d } = montar();
    const r = await guardarLaCartaEnLinea(
      d,
      contexto,
      { ...pedido(), empresaId: "otra", estado: "EN_LINEA" },
      SUCURSAL,
    );
    expect(r).toEqual({
      ok: true,
      dato: { cartaId: CARTA, estado: "EN_LINEA", version: 4, yaExistia: false },
    });
    expect(queLlamo(m)).toEqual(["ver", "guardar"]);
    expect(m.llamadas[1]?.entrada).toEqual({
      id: CARTA,
      sucursalId: SUCURSAL,
      nombre: "Nuevo",
      rubro: "",
      lugar: "Huinganco",
      mensajeDePortada: "Desliza para ver el menú",
      estado: "FUERA_DE_LINEA",
      modelo: "LISTA",
      cara: "BOLICHE",
      colorPropio: "#1f4e79",
      logo: VIGENTE.logo,
      versionEsperada: 3,
    });
  });

  it("la identidad del pedido reemplaza a la vigente: la cara, la paleta o «otro» color y el logo como PARTES; vacío es «sin elegir»; el modelo es el del pedido o, si no lo trae, el vigente", async () => {
    const { m, d } = montar();
    await guardarLaCartaEnLinea(
      d,
      contexto,
      pedido({
        cara: "NOCHE",
        paleta: "otro",
        colorPropio: "#0e7490",
        logo: LOGO_DIRECCION.replace("parador", "nuevo"),
        modelo: "LIBRO",
      }),
      SUCURSAL,
    );
    expect(m.llamadas[1]?.entrada).toMatchObject({
      modelo: "LIBRO",
      cara: "NOCHE",
      colorPropio: "#0e7490",
      logo: { ...VIGENTE.logo, idPublico: "logos/nuevo" },
    });
    await guardarLaCartaEnLinea(d, contexto, pedido({ cara: "", paleta: "", logo: "" }), SUCURSAL);
    expect(m.llamadas[3]?.entrada).toMatchObject({ cara: null, colorPropio: null, logo: null });
    // Sin modelo en el pedido queda el vigente (otra pantalla, un reintento viejo).
    expect(m.llamadas[3]?.entrada).toMatchObject({ modelo: "LISTA" });
    await guardarLaCartaEnLinea(d, contexto, pedido({ paleta: "#17562f" }), SUCURSAL);
    expect(m.llamadas[5]?.entrada).toMatchObject({ colorPropio: "#17562f" });
  });

  it("valores fuera de la lista: cara «X», color «#12345», «otro» sin color, un script en el color y un logo de otro proveedor son el genérico y no se llama a nada", async () => {
    const { m, d } = montar();
    for (const malo of [
      { cara: "X" },
      { paleta: "#12345" },
      { paleta: "otro", colorPropio: "#12345" },
      { paleta: "otro" },
      { paleta: "otro", colorPropio: "<script>" },
      { paleta: "<script>alert(1)</script>" },
      { logo: "https://ejemplo.com/logo.png" },
      { logo: "javascript:alert(1)" },
    ]) {
      expect(
        await guardarLaCartaEnLinea(d, contexto, pedido(malo), SUCURSAL),
        JSON.stringify(malo),
      ).toEqual(GENERICO);
    }
    expect(m.llamadas).toEqual([]);
  });

  it("un color de bajo contraste se guarda como se eligió (el ajuste se calcula al mostrar)", async () => {
    const { m, d } = montar();
    await guardarLaCartaEnLinea(
      d,
      contexto,
      pedido({ paleta: "otro", colorPropio: "#808080" }),
      SUCURSAL,
    );
    expect(m.llamadas[1]?.entrada).toMatchObject({ colorPropio: "#808080" });
  });

  it("una carta nueva se pide fuera de línea y sin versión", async () => {
    const { m, d } = montar({
      vista: () => ok({ carta: null, sucursalActiva: true, visibilidad: VISIBILIDAD }),
    });
    await guardarLaCartaEnLinea(d, contexto, pedido({ versionEsperada: null }), SUCURSAL);
    expect(m.llamadas[1]?.entrada).toEqual({
      id: CARTA,
      sucursalId: SUCURSAL,
      nombre: "Nuevo",
      rubro: "",
      lugar: "Huinganco",
      mensajeDePortada: null,
      estado: "FUERA_DE_LINEA",
      modelo: null,
      cara: null,
      colorPropio: null,
      logo: null,
    });
  });

  it("la sucursal que se mostró tiene que ser la del servidor: si no, el genérico y no se llama a nada", async () => {
    const { m, d } = montar();
    expect(
      await guardarLaCartaEnLinea(d, contexto, pedido({ sucursalId: OTRA }), SUCURSAL),
    ).toEqual(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("un pedido mal formado es el genérico; el nombre vacío tiene su texto aprobado, sobre el campo", async () => {
    const { m, d } = montar();
    expect(await guardarLaCartaEnLinea(d, contexto, { nada: 1 }, SUCURSAL)).toEqual(GENERICO);
    const vacio = await guardarLaCartaEnLinea(d, contexto, pedido({ nombre: "   " }), SUCURSAL);
    expect(!vacio.ok && vacio.error).toMatchObject({
      codigo: "CATALOGO_FALTA_EL_NOMBRE",
      campo: "nombre",
    });
    expect(m.llamadas).toEqual([]);
  });

  it("los errores de negocio salen como el genérico y los del guard, tal cual", async () => {
    for (const interno of [
      "NOMBRE_DE_CARTA_INVALIDO",
      "VERSION_DESACTUALIZADA",
      "CARTA_DE_LA_SUCURSAL_YA_EXISTE",
      "ID_REUTILIZADO",
    ]) {
      const { d } = montar({ guardar: () => err(interno) });
      expect(await guardarLaCartaEnLinea(d, contexto, pedido(), SUCURSAL)).toEqual(GENERICO);
    }
    const { d } = montar({ guardar: () => err("SIN_PERMISO") });
    const r = await guardarLaCartaEnLinea(d, contexto, pedido(), SUCURSAL);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
  });
});

describe("cambiarElEstadoDeLaCartaEnLinea", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    cartaId: CARTA,
    sucursalId: SUCURSAL,
    versionEsperada: 3,
    estado: "EN_LINEA",
    ...extra,
  });

  it("pide el ESTADO con los datos vigentes (solo cambia el estado) y la versión vista", async () => {
    const { m, d } = montar();
    const r = await cambiarElEstadoDeLaCartaEnLinea(d, contexto, pedido(), SUCURSAL);
    expect(r).toMatchObject({ ok: true, dato: { estado: "EN_LINEA" } });
    expect(m.llamadas[1]?.entrada).toEqual({
      id: CARTA,
      sucursalId: SUCURSAL,
      nombre: "Parador",
      rubro: "Parrilla",
      lugar: null,
      mensajeDePortada: "Desliza para ver el menú",
      estado: "EN_LINEA",
      modelo: "LISTA",
      cara: "BOLICHE",
      colorPropio: "#1f4e79",
      logo: VIGENTE.logo,
      versionEsperada: 3,
    });
  });

  it("una carta que no existe o no es la pedida, una sucursal que no es la del servidor o un estado que no existe: el genérico, sin llamar al caso de uso", async () => {
    const sin = montar({
      vista: () => ok({ carta: null, sucursalActiva: true, visibilidad: VISIBILIDAD }),
    });
    expect(await cambiarElEstadoDeLaCartaEnLinea(sin.d, contexto, pedido(), SUCURSAL)).toEqual(
      GENERICO,
    );
    const { m, d } = montar();
    expect(
      await cambiarElEstadoDeLaCartaEnLinea(d, contexto, pedido({ cartaId: OTRA }), SUCURSAL),
    ).toEqual(GENERICO);
    expect(
      await cambiarElEstadoDeLaCartaEnLinea(d, contexto, pedido({ sucursalId: OTRA }), SUCURSAL),
    ).toEqual(GENERICO);
    expect(
      await cambiarElEstadoDeLaCartaEnLinea(d, contexto, pedido({ estado: "ALTERNAR" }), SUCURSAL),
    ).toEqual(GENERICO);
    expect(queLlamo(m)).toEqual(["ver"]);
    expect(queLlamo(sin.m)).toEqual(["ver"]);
  });

  it("el error de la perilla del QR apagada sale como el genérico, no como un fallo inesperado; CARTA_SIN_PRODUCTOS_VISIBLES también", async () => {
    for (const error of [
      { codigo: "FUNCION_NO_INCLUIDA", perilla: "vidriera_por_qr" },
      "CARTA_SIN_PRODUCTOS_VISIBLES",
      "SUCURSAL_INACTIVA",
    ]) {
      const { d } = montar({ guardar: () => err(error) });
      expect(await cambiarElEstadoDeLaCartaEnLinea(d, contexto, pedido(), SUCURSAL)).toEqual(
        GENERICO,
      );
    }
  });
});
