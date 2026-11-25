import { describe, expect, it } from "vitest";
import type { ProveedorDeEmision } from "../modulos/fiscal/publico";
import type { Conexiones } from "./conexiones";
import { armarWeb } from "./web";
import type { BaseDeWeb } from "./web-base";
import { armarWebDeCaja } from "./web-de-caja";
import { armarWebDeCatalogo } from "./web-de-catalogo";
import { armarWebDeCierre } from "./web-de-cierre";
import { armarWebDeClientes } from "./web-de-clientes";
import { armarWebDeComandas } from "./web-de-comandas";
import { armarWebDeCompras } from "./web-de-compras";
import { armarWebDeEmpresas } from "./web-de-empresas";
import { armarWebDeFiscal } from "./web-de-fiscal";
import { armarWebDeIdentidad } from "./web-de-identidad";
import { armarWebDeProduccion } from "./web-de-produccion";
import { armarWebDeSalon } from "./web-de-salon";
import { armarWebDeStock } from "./web-de-stock";
import { armarWebDeVentas } from "./web-de-ventas";

/**
 * `armarWeb` se parte en un archivo por carpeta de `src/modulos` (`web-de-<carpeta>.ts`) y `web.ts` solo junta. Es una mudanza: esta prueba
 * fija lo que no puede cambiar. Cada caso previene un fallo concreto de la mudanza:
 *  1. las claves de `Web` son exactamente las de antes (una entrada perdida o agregada);
 *  2. ninguna clave aparece en dos partes ni en las de infraestructura (un spread que pisa a otro en silencio: TypeScript no avisa);
 *  3. armar no lee nada (perder la pereza rompería `next build`, que corre sin secretos);
 *  4. las listas blancas de fiscal, una por una (agregar o quitar una función cambia lo que la web puede llamar).
 * Las claves de abajo son las de `web.ts` antes de partirlo (35, contadas en `main` b4f3f0b; 37 desde V1c: `imagenesExternas` y `memoriaDeLogos` de la carta; 38 desde el dominio propio: `hostPropioDeLaCarta`).
 */

const CLAVES_DE_INFRAESTRUCTURA = [
  "autenticacion",
  "barridoDeAutenticacion",
  "configuracionPublicaDeHost",
  "lecturasCompartidas",
  "resolucionDeHost",
];

const CLAVES_DE_WEB = [
  "autenticacion",
  "barridoDeAutenticacion",
  "casosDeUsoDeCaja",
  "casosDeUsoDeCatalogo",
  "casosDeUsoDeCertificados",
  "casosDeUsoDeCierre",
  "casosDeUsoDeClientes",
  "casosDeUsoDeComandas",
  "casosDeUsoDeCompras",
  "casosDeUsoDeConfiguracionFiscal",
  "casosDeUsoDeEmpresas",
  "casosDeUsoDeFacturacion",
  "casosDeUsoDeIdentidad",
  "casosDeUsoDeProduccion",
  "casosDeUsoDeSalon",
  "casosDeUsoDeStock",
  "casosDeUsoDeVentas",
  "configuracionPublicaDeHost",
  "consultasDeCaja",
  "consultasDeCatalogo",
  "consultasDeCierre",
  "consultasDeClientes",
  "consultasDeComandas",
  "consultasDeCompras",
  "consultasDeEmpresas",
  "consultasDeFacturacion",
  "consultasDeIdentidad",
  "consultasDeProduccion",
  "consultasDeSalon",
  "consultasDeSesion",
  "consultasDeStock",
  "consultasDeVentas",
  "hostPropioDeLaCarta",
  "imagenesExternas",
  "lecturasCompartidas",
  "memoriaDeLogos",
  "resolucionDeHost",
  "vidrieraPublica",
];

const LISTA_BLANCA_DE_FISCAL = {
  casosDeUsoDeFacturacion: [
    "emitirComprobanteManual",
    "emitirNotaDeCredito",
    "emitirNotaDeDebito",
    "descartarComprobante",
    "reintentarComprobante",
    "resincronizarSerie",
    "cambiarAmbienteDePuntoDeVenta",
  ],
  casosDeUsoDeConfiguracionFiscal: [
    "guardarBorradorDeDatosFiscales",
    "empezarCorreccionDeDatosFiscales",
    "confirmarDatosFiscales",
    "crearPuntoDeVenta",
    "editarPuntoDeVenta",
    "activarPuntoDeVenta",
    "desactivarPuntoDeVenta",
  ],
  casosDeUsoDeCertificados: ["generarPedidoDeCertificado", "cargarCertificado"],
  consultasDeFacturacion: [
    "listarComprobantes",
    "listarPuntosDeVentaDeLaSucursal",
    "discriminaIvaAlEmitir",
    "listarPuntosDeVentaParaEmitir",
    "verComprobante",
    "modeloDeImpresion",
    "estadoDeCertificados",
    "estadoDeLaConfiguracionFiscal",
    "datosFiscalesDelEmisor",
    "puntosDeVentaDelEmisor",
  ],
} as const;

/** Conexiones donde TODO método lanza al llamarlo: si armar la composición lee algo, lanza. */
function conexionesQueLanzan(): Conexiones {
  return new Proxy(
    {},
    {
      get: (_destino, nombre) => () => {
        throw new Error(`se leyó conexiones.${String(nombre)}() al armar`);
      },
    },
  ) as unknown as Conexiones;
}

/** Conexiones que devuelven piezas vacías: alcanza para armar un grupo y mirar qué expone (nada se ejecuta). */
function conexionesVacias(): Conexiones {
  return new Proxy({}, { get: () => () => ({}) }) as unknown as Conexiones;
}

const emisionDeMentira = {} as unknown as ProveedorDeEmision;
const SIN_CADENAS = { HOMOLOGACION: [], PRODUCCION: [] };

function baseDeMentira(conexiones: Conexiones): BaseDeWeb {
  return {
    conexiones,
    reglas: {} as unknown as BaseDeWeb["reglas"],
    reloj: { ahora: () => new Date("2026-11-18T12:00:00.000Z") },
    emision: emisionDeMentira,
    cadenasDeConfianza: SIN_CADENAS,
  };
}

/** Las claves que aparecen en más de un grupo (cada grupo es un nombre y sus claves). */
function clavesRepetidas(grupos: Record<string, readonly string[]>): string[] {
  const dueno = new Map<string, string>();
  const repetidas = new Set<string>();
  for (const [nombre, claves] of Object.entries(grupos)) {
    for (const clave of claves) {
      if (dueno.has(clave)) repetidas.add(clave);
      else dueno.set(clave, nombre);
    }
  }
  return [...repetidas].sort();
}

describe("armarWeb por partes: las mismas claves que antes", () => {
  it("la lista de claves de Web es exactamente la de antes de partir el archivo", () => {
    const web = armarWeb(conexionesQueLanzan());
    expect(Object.keys(web).sort()).toEqual([...CLAVES_DE_WEB].sort());
    expect(CLAVES_DE_WEB).toHaveLength(38);
  });

  it("cada entrada de Web se pide como función (no hay valores sueltos)", () => {
    const web = armarWeb(conexionesQueLanzan());
    for (const [clave, valor] of Object.entries(web)) {
      expect(typeof valor, clave).toBe("function");
    }
  });
});

describe("ninguna clave repetida entre partes", () => {
  it("las 13 partes y las cinco de infraestructura no comparten ninguna clave", () => {
    const base = baseDeMentira(conexionesQueLanzan());
    const grupos = {
      infraestructura: CLAVES_DE_INFRAESTRUCTURA,
      empresas: Object.keys(armarWebDeEmpresas(base)),
      catalogo: Object.keys(armarWebDeCatalogo(base)),
      cierre: Object.keys(armarWebDeCierre(base)),
      caja: Object.keys(armarWebDeCaja(base)),
      ventas: Object.keys(armarWebDeVentas(base)),
      stock: Object.keys(armarWebDeStock(base)),
      produccion: Object.keys(armarWebDeProduccion(base)),
      comandas: Object.keys(armarWebDeComandas(base)),
      salon: Object.keys(armarWebDeSalon(base)),
      clientes: Object.keys(armarWebDeClientes(base)),
      compras: Object.keys(armarWebDeCompras(base)),
      identidad: Object.keys(armarWebDeIdentidad(base)),
      fiscal: Object.keys(armarWebDeFiscal(base)),
    };
    expect(clavesRepetidas(grupos)).toEqual([]);
    // Y juntas dan exactamente las claves de Web: ninguna se perdió ni se inventó.
    expect(Object.values(grupos).flat().sort()).toEqual([...CLAVES_DE_WEB].sort());
  });

  it("violación inyectada: dos partes con la misma clave se detectan", () => {
    expect(
      clavesRepetidas({ uno: ["casosDeUsoDeCaja", "a"], dos: ["b", "casosDeUsoDeCaja"] }),
    ).toEqual(["casosDeUsoDeCaja"]);
    expect(
      clavesRepetidas({ infraestructura: ["autenticacion"], parte: ["autenticacion"] }),
    ).toEqual(["autenticacion"]);
  });
});

describe("armar no lee nada", () => {
  it("armarWeb con conexiones que lanzan al llamarlas no lanza", () => {
    expect(() => armarWeb(conexionesQueLanzan())).not.toThrow();
  });

  it("cada parte se arma sin leer nada; solo lanza al pedir una entrada", () => {
    const base = baseDeMentira(conexionesQueLanzan());
    const partes = [
      armarWebDeEmpresas,
      armarWebDeCatalogo,
      armarWebDeCierre,
      armarWebDeCaja,
      armarWebDeVentas,
      armarWebDeStock,
      armarWebDeProduccion,
      armarWebDeComandas,
      armarWebDeSalon,
      armarWebDeClientes,
      armarWebDeCompras,
      armarWebDeIdentidad,
      armarWebDeFiscal,
    ];
    for (const armar of partes) expect(() => armar(base)).not.toThrow();
  });

  it("control: pedir una entrada sí lee las conexiones (las conexiones de prueba lanzan de verdad)", () => {
    const web = armarWeb(conexionesQueLanzan());
    expect(() => web.casosDeUsoDeEmpresas()).toThrow(/conexiones\./);
  });
});

describe("la lista blanca de fiscal no cambió", () => {
  const web = armarWeb(conexionesVacias(), {
    emision: emisionDeMentira,
    cadenasDeConfianza: SIN_CADENAS,
  });

  it.each(Object.entries(LISTA_BLANCA_DE_FISCAL))(
    "%s expone exactamente las funciones de hoy",
    (nombre, esperadas) => {
      const grupo = web[nombre as keyof typeof LISTA_BLANCA_DE_FISCAL]() as Record<string, unknown>;
      expect(Object.keys(grupo).sort()).toEqual([...esperadas].sort());
    },
  );
});
