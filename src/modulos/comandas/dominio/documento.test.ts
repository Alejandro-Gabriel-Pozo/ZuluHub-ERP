import { describe, expect, it } from "vitest";
import {
  cantidadParaPapel,
  columnasDelPapel,
  documentoDeAnulacion,
  documentoDeComanda,
  documentoDeTicket,
  type AvisoParaElPapel,
  type EnvioParaElPapel,
  type RenglonDelPapel,
} from "./documento";

const unidad = (cantidad: string, paso = "0.125") =>
  cantidadParaPapel(cantidad, { unidadDeVenta: "UNIDAD", paso });

describe("cantidadParaPapel (decisión 181)", () => {
  it("fracciones con barra, nunca el símbolo ½", () => {
    const casos: Record<string, string> = {
      "0.5": "1/2",
      "0.25": "1/4",
      "0.75": "3/4",
      "0.125": "1/8",
      "0.875": "7/8",
      "1.5": "1 1/2",
      "2.25": "2 1/4",
      "2": "2",
      "10": "10",
    };
    for (const [entrada, salida] of Object.entries(casos)) {
      expect(unidad(entrada)).toEqual({ ok: true, valor: salida });
    }
  });
  it("por peso: el número con coma y la unidad, sin fracciones", () => {
    const g = (c: string, u = "GRAMO") => cantidadParaPapel(c, { unidadDeVenta: u, paso: "0.5" });
    expect(g("350")).toEqual({ ok: true, valor: "350 g" });
    expect(g("0.5", "KILOGRAMO")).toEqual({ ok: true, valor: "0,5 kg" });
    expect(g("1.5", "KILOGRAMO")).toEqual({ ok: true, valor: "1,5 kg" });
    expect(g("2.5", "LITRO")).toEqual({ ok: true, valor: "2,5 l" });
  });
  it("rechaza lo que no se puede imprimir", () => {
    const no = { ok: false, error: "CANTIDAD_NO_IMPRIMIBLE" };
    expect(unidad("0")).toEqual(no);
    expect(unidad("x")).toEqual(no);
    expect(cantidadParaPapel("1", { unidadDeVenta: "UNIDAD", paso: "0" })).toEqual(no);
    // no es múltiplo del paso
    expect(cantidadParaPapel("0.25", { unidadDeVenta: "UNIDAD", paso: "0.5" })).toEqual(no);
    // un tercio no existe: paso 1/10000 deja 0.3333 pasar el paso, pero no es potencia de 2
    expect(cantidadParaPapel("0.3333", { unidadDeVenta: "UNIDAD", paso: "0.0001" })).toEqual(no);
    // 1/16 no se imprime
    expect(cantidadParaPapel("0.0625", { unidadDeVenta: "UNIDAD", paso: "0.0625" })).toEqual(no);
    expect(cantidadParaPapel("1", { unidadDeVenta: "PARSEC", paso: "1" })).toEqual(no);
    expect(cantidadParaPapel("1", { unidadDeVenta: "toString", paso: "1" })).toEqual(no);
  });
});

const envio: EnvioParaElPapel = {
  numero: 3,
  tipo: "ENVIO",
  rotulo: "Mesa 5",
  enviadoEn: "09/11/2026 21:10",
  tomadoPor: "Ana",
};
const renglones: RenglonDelPapel[] = [
  {
    cantidad: "0.5",
    unidadDeVenta: "UNIDAD",
    paso: "0.5",
    nombreDeCocina: "Muzzarella grande",
    detalle: ["Sin aceitunas (oculta)"],
    rol: "SALE",
  },
  {
    cantidad: "2",
    unidadDeVenta: "UNIDAD",
    paso: "1",
    nombreDeCocina: "Milanesa",
    detalle: [],
    rol: "ESPERA",
  },
];

describe("documentoDeComanda", () => {
  it("mesa en grande, número, hora del envío, quién tomó, cantidades con barra y sin precios", () => {
    const r = documentoDeComanda(envio, renglones, { copia: false, ancho: 58 });
    if (!r.ok) throw new Error("esperaba ok");
    const textos = r.valor.lineas.map((l) => l.texto);
    expect(r.valor.ancho).toBe(58);
    expect(textos).toContain("COMANDA · COCINA");
    expect(r.valor.lineas).toContainEqual({ texto: "Mesa 5", estilo: "GRANDE" });
    expect(textos).toContain("Envío 3");
    expect(textos).toContain("09/11/2026 21:10");
    expect(textos).toContain("Tomó: Ana");
    expect(textos).toContain("1/2 Muzzarella grande");
    expect(textos).toContain("  Sin aceitunas (oculta)");
    expect(textos).toContain("2 Milanesa");
    expect(textos).toContain("  no preparar todavía");
    expect(textos).not.toContain("Copia");
    expect(textos.join("\n")).not.toMatch(/[$½]/);
  });
  it("la copia dice «Copia» y conserva la hora del envío original; no dice REIMPRESIÓN", () => {
    const r = documentoDeComanda(envio, renglones, { copia: true, ancho: 80 });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.valor.lineas[0]).toEqual({ texto: "Copia", estilo: "NEGRITA" });
    const textos = r.valor.lineas.map((l) => l.texto);
    expect(textos).toContain("09/11/2026 21:10");
    expect(textos.join("\n")).not.toContain("REIMPRESIÓN");
  });
  it("una salida pedida lo dice", () => {
    const r = documentoDeComanda({ ...envio, tipo: "SALIDA_PEDIDA" }, renglones, {
      copia: false,
      ancho: 58,
    });
    expect(r.ok && r.valor.lineas.map((l) => l.texto)).toContain("Piden que salga");
  });
  it("la foto es la misma: el mismo envío da el mismo papel", () => {
    const a = documentoDeComanda(envio, renglones, { copia: false, ancho: 58 });
    const b = documentoDeComanda(
      { ...envio },
      renglones.map((r) => ({ ...r })),
      { copia: false, ancho: 58 },
    );
    expect(a).toEqual(b);
  });
  it("ningún renglón pasa del ancho del papel; un nombre largo se parte", () => {
    const largo = {
      ...(renglones[0] as RenglonDelPapel),
      nombreDeCocina: "Pizza ".repeat(12) + "X".repeat(50),
    };
    for (const ancho of [58, 80] as const) {
      const r = documentoDeComanda(
        { ...envio, rotulo: "Mesa 12 terraza del fondo con vista" },
        [largo],
        { copia: true, ancho },
      );
      if (!r.ok) throw new Error("esperaba ok");
      for (const l of r.valor.lineas) {
        const columnas = columnasDelPapel(ancho);
        expect(l.texto.length).toBeLessThanOrEqual(
          l.estilo === "GRANDE" ? Math.floor(columnas / 2) : columnas,
        );
      }
    }
  });
  it("falla si un renglón no se puede imprimir (nada a medias)", () => {
    const mal = { ...(renglones[0] as RenglonDelPapel), cantidad: "0.3333", paso: "0.0001" };
    expect(documentoDeComanda(envio, [mal], { copia: false, ancho: 58 })).toEqual({
      ok: false,
      error: "CANTIDAD_NO_IMPRIMIBLE",
    });
  });
});

describe("documentoDeAnulacion", () => {
  const aviso: AvisoParaElPapel = {
    rotulo: "Mesa 5",
    envioNumero: 2,
    enviadoEn: "09/11/2026 21:10",
    anuladoPor: "Ana",
    cantidadAnulada: "1",
    quedan: "2",
    unidadDeVenta: "UNIDAD",
    paso: "1",
    nombreDeCocina: "Milanesa",
    detalle: ["Napolitana"],
    motivo: "Se equivocó el pedido",
  };
  it("dice ANULACIÓN · NO PREPARAR, cuánto se anuló, cuánto queda y el motivo", () => {
    const r = documentoDeAnulacion(aviso, { copia: false, ancho: 58 });
    const t = r.ok ? r.valor.lineas.map((l) => l.texto) : [];
    expect(t).toContain("ANULACIÓN · NO PREPARAR");
    expect(t).toContain("1 Milanesa");
    expect(t).toContain("Quedan: 2");
    expect(t).toContain("Motivo: Se equivocó el pedido");
    expect(t).toContain("Envío 2");
  });
  it("si se anuló entera, quedan 0", () => {
    const r = documentoDeAnulacion({ ...aviso, quedan: "0" }, { copia: true, ancho: 80 });
    expect(r.ok && r.valor.lineas.map((l) => l.texto)).toContain("Quedan: 0");
    expect(r.ok && r.valor.lineas[0]?.texto).toBe("Copia");
  });
  it("rechaza cantidades que no se imprimen", () => {
    expect(
      documentoDeAnulacion({ ...aviso, cantidadAnulada: "0" }, { copia: false, ancho: 58 }).ok,
    ).toBe(false);
    expect(documentoDeAnulacion({ ...aviso, quedan: "x" }, { copia: false, ancho: 58 }).ok).toBe(
      false,
    );
    expect(
      documentoDeAnulacion(
        { ...aviso, quedan: "0.3333", paso: "0.0001" },
        { copia: false, ancho: 58 },
      ).ok,
    ).toBe(false);
  });
});

describe("documentoDeTicket", () => {
  it("descripción a la izquierda, importe a la derecha y total en negrita", () => {
    const m = documentoDeTicket(
      {
        numero: 12,
        fecha: "09/11/2026",
        lineas: [{ cantidad: "2", descripcion: "Milanesa", importe: "2300.00" }],
        total: "2300.00",
      },
      { ancho: 58 },
    );
    expect(m.lineas[0]).toEqual({ texto: "Ticket N.º 12", estilo: "NEGRITA" });
    const fila = m.lineas.find((l) => l.texto.startsWith("2 Milanesa"));
    expect(fila?.texto.length).toBe(32);
    expect(fila?.texto.endsWith("2300.00")).toBe(true);
    const total = m.lineas.at(-1);
    expect(total?.estilo).toBe("NEGRITA");
    expect(total?.texto.startsWith("Total")).toBe(true);
  });
  it("una descripción que no entra en la fila pasa a renglones aparte", () => {
    const m = documentoDeTicket(
      {
        numero: 1,
        fecha: "f",
        lineas: [{ cantidad: "1", descripcion: "X".repeat(40), importe: "1.00" }],
        total: "1.00",
      },
      { ancho: 58 },
    );
    expect(m.lineas.some((l) => l.texto === "1.00")).toBe(true);
    for (const l of m.lineas) expect(l.texto.length).toBeLessThanOrEqual(32);
  });
});
