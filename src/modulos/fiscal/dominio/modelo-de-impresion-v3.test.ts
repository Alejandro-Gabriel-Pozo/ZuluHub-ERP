import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  facturaArmada,
  imprimibleDe as imprimible,
  receptorInscripto,
  receptorMonotributista,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "./condicion-iva-receptor";
import type { CondicionIvaReceptor } from "./condicion-iva-receptor";
import {
  LEYENDAS_DE_CONDICION,
  leyendaDeCondicionDelReceptor,
} from "./leyenda-de-condicion-del-receptor";
import {
  modeloDeImpresion,
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ComprobanteParaImprimir,
  type MarcaParaImprimir,
  type ModeloImpreso,
} from "./modelo-de-impresion";
import type { Receptor } from "./receptor";
import {
  PRIMERA_VERSION_CON_LEYENDA_DE_CONDICION,
  VERSIONES_SOPORTADAS,
} from "./versiones-de-representacion";

const MARCA: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "https://ejemplo.test/zulu.png",
  colorPrincipal: "#8b4513",
};

const modelo = (c: ComprobanteParaImprimir): ModeloImpreso => {
  const r = modeloDeImpresion(c, MARCA);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

const conCondicion = (base: Receptor, condicionIva: CondicionIvaReceptor): Receptor => ({
  ...base,
  condicionIva,
});

const CON_IVA_21 = [renglon("1210.00", "1", "21", null, "Torta")];
const facturaB = facturaArmada(consumidorFinal, CON_IVA_21);
const DISCRIMINADO = { modoDePrecio: "IVA_DISCRIMINADO" } as const;

describe("modelo de impresión v3: leyenda de la condición del receptor (RG 1415 Anexo II A.II)", () => {
  const casos: readonly (readonly [string, ComprobanteParaImprimir])[] = [
    ["factura-a-inscripto", imprimible(facturaArmada(receptorInscripto, CON_IVA_21, DISCRIMINADO))],
    [
      "factura-a-monotributista",
      imprimible(facturaArmada(receptorMonotributista, CON_IVA_21, DISCRIMINADO)),
    ],
    [
      "factura-a-monotributista-social",
      imprimible(
        facturaArmada(
          conCondicion(receptorMonotributista, "MONOTRIBUTISTA_SOCIAL"),
          CON_IVA_21,
          DISCRIMINADO,
        ),
      ),
    ],
    [
      "factura-a-monotributo-promovido",
      imprimible(
        facturaArmada(
          conCondicion(receptorMonotributista, "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO"),
          CON_IVA_21,
          DISCRIMINADO,
        ),
      ),
    ],
    [
      // La emisión de una B a un no categorizado se rechaza hoy (error 10067), así que este caso es solo del modelo: la leyenda f) 4
      // queda lista para cuando se emita (p. ej. una C de un emisor monotributista).
      "factura-b-no-categorizado",
      imprimible(facturaB, { receptor: conCondicion(receptorInscripto, "NO_CATEGORIZADO") }),
    ],
    [
      "factura-b-a-exento",
      imprimible(facturaB, { receptor: conCondicion(receptorInscripto, "EXENTO") }),
    ],
    ["factura-b-consumidor-final", imprimible(facturaB)],
    [
      "factura-b-consumidor-final-identificado",
      imprimible(facturaB, {
        receptor: {
          ...consumidorFinal,
          nombre: "Juan Gómez",
          documento: { tipo: "DNI", numero: "30123456" },
        },
      }),
    ],
    [
      "factura-b-no-alcanzado",
      imprimible(facturaB, { receptor: conCondicion(receptorInscripto, "IVA_NO_ALCANZADO") }),
    ],
  ];
  for (const [nombre, comprobante] of casos) {
    it(`golden ${nombre}`, async () => {
      const m = modelo(comprobante);
      expect(m.versionDeRepresentacion).toBe(3);
      await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
        `./golden/modelo-v3-${nombre}.golden.txt`,
      );
    });
  }

  it("la leyenda sale en las condiciones decididas y en ninguna otra; el consumidor final conserva su campo de la versión 2", () => {
    for (const condicion of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      const m = modelo(
        imprimible(facturaB, { receptor: conCondicion(receptorInscripto, condicion) }),
      );
      const esperada = LEYENDAS_DE_CONDICION[condicion];
      expect(m.receptor.leyendaDeCondicion, condicion).toBe(esperada ?? undefined);
      // El campo de la versión 2 sigue siendo solo del consumidor final.
      expect(m.receptor.leyenda, condicion).toBe(
        condicion === "CONSUMIDOR_FINAL" ? "A CONSUMIDOR FINAL" : undefined,
      );
    }
  });

  it("v3 es la v2 más la leyenda de la condición, y nada más (la v1 y la v2 no cambian)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONDICIONES_DE_IVA_DEL_RECEPTOR), (condicion) => {
        const base = imprimible(facturaB, { receptor: conCondicion(receptorInscripto, condicion) });
        const v2 = modelo({ ...base, versionDeRepresentacion: 2 });
        const v3 = modelo({ ...base, versionDeRepresentacion: 3 });
        const receptorV3 = Object.fromEntries(
          Object.entries(v3.receptor).filter(([clave]) => clave !== "leyendaDeCondicion"),
        );
        expect({ ...v3, receptor: receptorV3, versionDeRepresentacion: 2 }).toEqual(v2);
        expect(v2.receptor.leyendaDeCondicion).toBeUndefined();
        expect(
          modelo({ ...base, versionDeRepresentacion: 1 }).receptor.leyendaDeCondicion,
        ).toBeUndefined();
      }),
    );
  });
});

describe("versiones de representación: cuál se usa al emitir", () => {
  it("la que sella un comprobante nuevo es la mayor de las soportadas, y cada una tiene sus golden", () => {
    expect(VERSION_DE_REPRESENTACION_ACTUAL).toBe(Math.max(...VERSIONES_SOPORTADAS));
    expect(PRIMERA_VERSION_CON_LEYENDA_DE_CONDICION).toBeLessThanOrEqual(
      VERSION_DE_REPRESENTACION_ACTUAL,
    );
  });
});

describe("leyendas de condición: textos de la norma", () => {
  it("cada texto es el de la norma, tal cual (RG 1415 Anexo II A.II a.4, e.4, f.4)", () => {
    expect(LEYENDAS_DE_CONDICION).toEqual({
      RESPONSABLE_INSCRIPTO: "IVA RESPONSABLE INSCRITO",
      EXENTO: "IVA EXENTO",
      IVA_NO_ALCANZADO: "NO RESPONSABLE IVA",
      CONSUMIDOR_FINAL: "A CONSUMIDOR FINAL",
      MONOTRIBUTO: "RESPONSABLE MONOTRIBUTO",
      MONOTRIBUTISTA_SOCIAL: "MONOTRIBUTISTA SOCIAL",
      MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO:
        "MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO",
      NO_CATEGORIZADO: "SUJETO NO CATEGORIZADO",
      CLIENTE_DEL_EXTERIOR: null,
      PROVEEDOR_DEL_EXTERIOR: null,
      IVA_LIBERADO_LEY_19640: null,
    });
    expect(leyendaDeCondicionDelReceptor("CONSUMIDOR_FINAL")).toBe("A CONSUMIDOR FINAL");
    expect(leyendaDeCondicionDelReceptor("CLIENTE_DEL_EXTERIOR")).toBeNull();
  });
});

/**
 * Una regla, un lugar: el texto de una leyenda de la norma vive SOLO en `leyenda-de-condicion-del-receptor.ts`; la hoja, el ticket y el
 * PDF lo toman del modelo. Previene que una pantalla copie el texto y, si ARCA lo cambia (versión nueva del modelo), siga imprimiendo el
 * viejo. Se busca el texto como literal entre comillas (los comentarios que lo citan no cuentan). Los archivos de prueba y las ayudas de prueba quedan afuera (tienen datos de ejemplo).
 */
function archivosQueRepiten(
  fuentes: ReadonlyMap<string, string>,
  texto: string,
  dueno: string,
): string[] {
  return [...fuentes]
    .filter(([ruta, contenido]) => !ruta.endsWith(dueno) && contenido.includes(`"${texto}"`))
    .map(([ruta]) => ruta);
}

function leerFuentes(): Map<string, string> {
  const fuentes = new Map<string, string>();
  const recorrer = (carpeta: string) => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".next") recorrer(ruta);
      } else if (
        /\.(ts|tsx)$/.test(e.name) &&
        !/\.test\.|ayudas-de-impresion|\/test\//.test(ruta)
      ) {
        fuentes.set(ruta, readFileSync(ruta, "utf8"));
      }
    }
  };
  recorrer("src");
  return fuentes;
}

describe("leyendas de condición: el texto vive una sola vez", () => {
  const DUENO = "leyenda-de-condicion-del-receptor.ts";
  const textos = Object.values(LEYENDAS_DE_CONDICION).filter((t): t is string => t !== null);

  it("ningún otro archivo de src repite una leyenda", () => {
    const fuentes = leerFuentes();
    for (const t of textos) expect(archivosQueRepiten(fuentes, t, DUENO), t).toEqual([]);
  });

  it("violación inyectada: una copia del texto en otro archivo se detecta", () => {
    const fuentes = new Map([
      [`src/${DUENO}`, `const a = "${textos[0]}";`],
      ["otra/pantalla.tsx", `const t = "${textos[0]}";`],
    ]);
    expect(archivosQueRepiten(fuentes, textos[0] ?? "", DUENO)).toEqual(["otra/pantalla.tsx"]);
  });
});
