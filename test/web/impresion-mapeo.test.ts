import { describe, expect, it } from "vitest";
import { comprobanteParaLaHoja } from "../../apps/web/pantallas/modelo-de-impresion";
import { armarLaHoja } from "../../apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja";
import type { ModeloDeImpresionParaLaPantalla } from "../../src/composicion/modelo-de-impresion-web";
import { webDesdeTexto, type SitioWeb } from "../../src/primitivas/contacto/web";
import { modeloDeImpresion } from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  imprimibleDe,
  receptorInscripto,
  renglon,
  SIN_CONTACTO,
} from "../utilidades/facturacion";

/**
 * El mapeo del modelo de impresión de fiscal a lo que dibuja la hoja, con el modelo REAL (no a mano): qué pasa a la hoja, qué NO pasa
 * (referencias, descuento, logo, color, nombre de fantasía) y que lo armado con el mapeo muestra los textos del modelo.
 */

const MARCA = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "https://x.test/l.png",
  colorPrincipal: "#ff0000",
};

function modelo(
  c: Parameters<typeof modeloDeImpresion>[0],
): ModeloDeImpresionParaLaPantalla["modelo"] {
  const r = modeloDeImpresion(c, MARCA);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
}

const facturaB = facturaArmada(consumidorFinal, [renglon("1210.00", "1", "21", null, "Torta")]);
const facturaA = (modoDePrecio: "IVA_INCLUIDO" | "IVA_DISCRIMINADO") =>
  facturaArmada(receptorInscripto, [renglon("1000.00", "2", "21", null, "Torta")], {
    modoDePrecio,
  });
const facturaC = facturaArmada(
  consumidorFinal,
  [renglon("1000.00", "1", null, null, "Café")],
  {},
  contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }) }),
);

const hoja = (m: ReturnType<typeof modelo>) => armarLaHoja({}, comprobanteParaLaHoja(m), "A4");
const precio = (m: ReturnType<typeof modelo>) =>
  hoja(m).columnas.find((c) => c.clave === "precio")?.titulo;

describe("comprobanteParaLaHoja: lista blanca", () => {
  const m = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
  const c = comprobanteParaLaHoja(m);

  it("no imprime nombre de fantasía aunque el modelo lo traiga (SUPUESTO de la primera entrega)", () => {
    expect(m.marca.nombreDeFantasia).toBe("La Panadería de Zulu");
    expect(c.marca).toEqual({ nombreDeFantasia: null });
    expect(hoja(m).nombreDeFantasia).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/La Panader|l\.png|ff0000/);
  });

  it("no llegan referencias, descuento, QR ni versión de representación", () => {
    const texto = JSON.stringify(c);
    for (const clave of ["referencias", "descuento", "qr", "versionDeRepresentacion", "logoUrl"]) {
      expect(texto).not.toContain(`"${clave}"`);
    }
    expect(Object.keys(c.renglones[0] ?? {}).sort()).toEqual(
      ["alicuota", "cantidad", "descripcion", "importe", "precioUnitario"].sort(),
    );
  });
});

const sitio = (texto: string): SitioWeb => {
  const r = webDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const CONTACTO = { telefono: "011 4444-5555", correo: "hola@zulu.test", web: sitio("zulu.test") };

describe("comprobanteParaLaHoja: la lista blanca es profunda", () => {
  const INTRUSA = "claveNuevaDelDominio";
  const conIntrusa = <T extends object>(o: T): T => ({ ...o, [INTRUSA]: "x" });

  it("una clave nueva en los objetos anidados del modelo no llega al resultado", () => {
    const m = modelo(imprimibleDe(facturaB, { contacto: CONTACTO }));
    const asociado = {
      tipo: "FACTURA_B" as const,
      puntoDeVenta: 1,
      numero: 7n,
      cuit: facturaB.emisor.cuit,
      fecha: facturaB.asociado?.fecha ?? imprimibleDe(facturaB).fechaEmision,
    };
    const nota = modelo(imprimibleDe({ ...facturaB, tipo: "NOTA_CREDITO_B" as const, asociado }));
    const a = modelo(imprimibleDe(facturaA("IVA_INCLUIDO")));
    const sucio = (x: typeof m): typeof m => ({
      ...x,
      fiscal: { ...x.fiscal, emisor: conIntrusa(x.fiscal.emisor) },
      receptor: { ...x.receptor, documento: conIntrusa(x.receptor.documento) },
      totales:
        x.totales.letra === "A"
          ? {
              ...x.totales,
              netoPorAlicuota: x.totales.netoPorAlicuota.map((n) => conIntrusa(n)),
            }
          : x.totales,
      ...(x.transparenciaFiscal === undefined
        ? {}
        : {
            transparenciaFiscal: {
              ...conIntrusa(x.transparenciaFiscal),
              titulo: conIntrusa(x.transparenciaFiscal.titulo),
              ivaContenido: {
                ...conIntrusa(x.transparenciaFiscal.ivaContenido),
                porAlicuota: x.transparenciaFiscal.ivaContenido.porAlicuota.map((p) =>
                  conIntrusa(p),
                ),
              },
              otrosImpuestosNacionalesIndirectos: conIntrusa(
                x.transparenciaFiscal.otrosImpuestosNacionalesIndirectos,
              ),
            },
          }),
      ...(x.contacto === undefined
        ? {}
        : {
            contacto: {
              ...conIntrusa(x.contacto),
              web: x.contacto.web === null ? null : conIntrusa(x.contacto.web),
            },
          }),
      asociado: x.asociado === null ? null : conIntrusa(x.asociado),
    });
    for (const original of [m, nota, a]) {
      const limpio = JSON.stringify(comprobanteParaLaHoja(original));
      const conClave = JSON.stringify(comprobanteParaLaHoja(sucio(original)));
      expect(conClave).not.toContain(INTRUSA);
      expect(conClave).toBe(limpio);
    }
    // Que la prueba no sea vacía: el modelo sucio sí trae la clave, y se ejercitaron los anidados.
    expect(JSON.stringify(sucio(m))).toContain(INTRUSA);
    expect(m.transparenciaFiscal).toBeDefined();
    expect(m.contacto).toBeDefined();
    expect(nota.asociado).not.toBeNull();
    expect(a.totales.letra).toBe("A");
  });
});

describe("comprobanteParaLaHoja: cada comprobante", () => {
  it("B a consumidor final: leyenda, transparencia fiscal, «Precio con IVA»", () => {
    const m = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
    const c = comprobanteParaLaHoja(m);
    expect(c.receptor.leyenda).toBe("A CONSUMIDOR FINAL");
    expect(c.transparenciaFiscal).toEqual(m.transparenciaFiscal);
    expect(hoja(m).transparencia).not.toBeNull();
    expect(precio(m)).toBe("Precio con IVA");
  });

  it("A: el encabezado del precio sigue al modo de precio, en las dos variantes", () => {
    const incluido = modelo(imprimibleDe(facturaA("IVA_INCLUIDO")));
    const discriminado = modelo(imprimibleDe(facturaA("IVA_DISCRIMINADO")));
    expect(comprobanteParaLaHoja(incluido).modoDePrecio).toBe("IVA_INCLUIDO");
    expect(comprobanteParaLaHoja(discriminado).modoDePrecio).toBe("IVA_DISCRIMINADO");
    expect(precio(incluido)).toBe("Precio con IVA");
    expect(precio(discriminado)).toBe("Precio");
  });

  it("C: sin bloque de transparencia, sin columna de IVA y «Precio»", () => {
    const m = modelo(imprimibleDe(facturaC, { contacto: SIN_CONTACTO }));
    const c = comprobanteParaLaHoja(m);
    expect(c.transparenciaFiscal).toBeUndefined();
    expect(c.totales.letra).toBe("C");
    expect(hoja(m).transparencia).toBeNull();
    expect(hoja(m).columnas.map((x) => x.clave)).not.toContain("iva");
    expect(precio(m)).toBe("Precio");
  });

  it("nota de crédito: rótulo, comprobante asociado y mismos totales", () => {
    const nota = { ...facturaB, tipo: "NOTA_CREDITO_B" as const };
    const asociado = {
      tipo: "FACTURA_B" as const,
      puntoDeVenta: 1,
      numero: 7n,
      cuit: facturaB.emisor.cuit,
      fecha: facturaB.asociado?.fecha ?? imprimibleDe(facturaB).fechaEmision,
    };
    const m = modelo(imprimibleDe({ ...nota, asociado }, { contacto: SIN_CONTACTO }));
    const c = comprobanteParaLaHoja(m);
    expect(c.fiscal.rotulo).toBe("NOTA DE CRÉDITO");
    expect(c.asociado).toEqual(m.asociado);
    expect(hoja(m).corresponde).not.toBeNull();
  });

  it("las leyendas del modelo (homologación) pasan tal cual", () => {
    const m = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
    expect(comprobanteParaLaHoja({ ...m, leyendas: ["UNA", "OTRA"] }).leyendas).toEqual([
      "UNA",
      "OTRA",
    ]);
    expect(comprobanteParaLaHoja(m).leyendas).toEqual(m.leyendas);
  });

  it("las leyendas legales: sin la clave si el modelo no la trae; con ella, copia profunda y tal cual", () => {
    const m = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
    expect("leyendasLegales" in comprobanteParaLaHoja(m)).toBe(false);
    expect(hoja(m).leyendasLegales).toEqual([]);
    const legales = ["  Texto legal de prueba, tal cual.  "];
    const conLegales = { ...m, leyendasLegales: legales, claveAjena: "x" };
    const c = comprobanteParaLaHoja(conLegales);
    expect(c.leyendasLegales).toEqual(legales);
    expect(c.leyendasLegales).not.toBe(legales);
    expect(JSON.stringify(c)).not.toContain("claveAjena");
    expect(hoja(conLegales).leyendasLegales).toEqual(legales);
    expect(hoja(conLegales).leyendas).toEqual(m.leyendas);
  });

  it("el contacto congelado llega y se dibuja", () => {
    const contacto = { telefono: "341 555 1234", correo: null, web: null };
    const m = modelo(imprimibleDe(facturaB, { contacto }));
    expect(comprobanteParaLaHoja(m).contacto).toEqual(m.contacto);
    expect(hoja(m).contacto).toContain("341 555 1234");
  });

  it("la sucursal congelada: sin la clave si el modelo no la trae; con ella, copia campo por campo, tal cual y sin claves ajenas", () => {
    const m = modelo(imprimibleDe(facturaB));
    expect("sucursal" in comprobanteParaLaHoja(m)).toBe(false);
    expect(hoja(m).nombreDeLaSucursal).toBeNull();
    const nombre = "  Sucursal  Ñandú   Centro ".padEnd(100, "é");
    expect(nombre).toHaveLength(100);
    const sucursal = { nombre, claveAjena: "x" };
    const conSucursal = { ...m, sucursal };
    const c = comprobanteParaLaHoja(conSucursal);
    expect(c.sucursal).toEqual({ nombre });
    expect(c.sucursal).not.toBe(sucursal);
    expect(Object.keys(c.sucursal ?? {})).toEqual(["nombre"]);
    expect(JSON.stringify(c)).not.toContain("claveAjena");
    expect(hoja(conSucursal).nombreDeLaSucursal).toBe(nombre);
  });

  it("con el modelo real, el nombre que congeló el comprobante llega a la hoja", () => {
    const m = modelo(imprimibleDe(facturaB, { sucursalNombre: "Sucursal Centro" }));
    expect(m.sucursal).toEqual({ nombre: "Sucursal Centro" });
    expect(hoja(m).nombreDeLaSucursal).toBe("Sucursal Centro");
  });
});
