import { describe, expect, it } from "vitest";
import {
  RUTAS_DE_CONFIGURACION,
  armarLaLista,
  cartelDeDatosFiscales,
  cartelDePuntosDeVenta,
  cartelDelCertificado,
  type EstadoParaLaLista,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";

/**
 * La lista de Configuración fiscal (D-43, opción C; carteles de D-64): qué cartel lleva cada fila. Un tema completo no lleva cartel;
 * el certificado muestra el estado más urgente de los ambientes en uso (SUPUESTO: Vencido, Falta cargar, Pendiente).
 */
type Certificado = EstadoParaLaLista["certificados"][number];
const cert = (
  ambiente: Certificado["ambiente"],
  situacion: Certificado["situacion"],
  vencido = false,
): Certificado => ({ ambiente, situacion, vencido });

const estado = (cambios: {
  datos?: EstadoParaLaLista["datosFiscales"]["estado"];
  puntos?: EstadoParaLaLista["puntosDeVenta"]["estado"];
  enUso?: EstadoParaLaLista["puntosDeVenta"]["ambientesEnUso"];
  certificados?: EstadoParaLaLista["certificados"];
}): EstadoParaLaLista => ({
  datosFiscales: { estado: cambios.datos ?? "VIGENTES" },
  puntosDeVenta: {
    estado: cambios.puntos ?? "CON_ACTIVOS",
    ambientesEnUso: cambios.enUso ?? ["HOMOLOGACION"],
  },
  certificados: cambios.certificados ?? [
    cert("HOMOLOGACION", "VIGENTE"),
    cert("PRODUCCION", "FALTA_CARGAR"),
  ],
});

describe("el cartel de los datos fiscales (D-64)", () => {
  it.each([
    ["SIN_CARGAR", "FALTA_CARGAR"],
    ["BORRADOR", "PENDIENTE"],
    ["VIGENTES", null],
    // SUPUESTO del ingeniero; fuente D-61 (la web ya no puede producirlo): se sigue diciendo «Pendiente».
    ["SOLO_FUTUROS", "PENDIENTE"],
  ] as const)("%s lleva %s", (entrada, esperado) => {
    expect(cartelDeDatosFiscales(entrada)).toBe(esperado);
  });
});

describe("el cartel de los puntos de venta (D-64)", () => {
  it.each([
    ["SIN_PUNTOS", "FALTA_CREAR_UNO"],
    ["SIN_ACTIVOS", "NINGUNO_ACTIVO"],
    ["CON_ACTIVOS", null],
  ] as const)("%s lleva %s", (entrada, esperado) => {
    expect(cartelDePuntosDeVenta(entrada)).toBe(esperado);
  });
});

describe("el cartel del certificado (D-64) según los ambientes en uso", () => {
  it.each([
    ["falta cargar", cert("HOMOLOGACION", "FALTA_CARGAR"), "FALTA_CARGAR"],
    ["pedido hecho, esperando el archivo", cert("HOMOLOGACION", "PEDIDO_GENERADO"), "PENDIENTE"],
    ["vigente y vencido", cert("HOMOLOGACION", "VIGENTE", true), "VENCIDO"],
    ["vigente", cert("HOMOLOGACION", "VIGENTE"), null],
  ] as const)("un ambiente en uso, %s", (_nombre, c, esperado) => {
    expect(cartelDelCertificado(["HOMOLOGACION"], [c])).toBe(esperado);
  });

  it("el certificado de un ambiente que no está en uso no cuenta", () => {
    expect(
      cartelDelCertificado(
        ["HOMOLOGACION"],
        [cert("HOMOLOGACION", "VIGENTE"), cert("PRODUCCION", "FALTA_CARGAR")],
      ),
    ).toBeNull();
  });

  it.each([
    [
      "Vencido gana a Falta cargar y a Pendiente",
      [
        cert("HOMOLOGACION", "PEDIDO_GENERADO"),
        cert("PRODUCCION", "VIGENTE", true),
        cert("PRODUCCION", "FALTA_CARGAR"),
      ],
      "VENCIDO",
    ],
    [
      "Falta cargar gana a Pendiente",
      [cert("HOMOLOGACION", "PEDIDO_GENERADO"), cert("PRODUCCION", "FALTA_CARGAR")],
      "FALTA_CARGAR",
    ],
    [
      "Pendiente gana a lo completo",
      [cert("HOMOLOGACION", "VIGENTE"), cert("PRODUCCION", "PEDIDO_GENERADO")],
      "PENDIENTE",
    ],
    [
      "los dos completos: sin cartel",
      [cert("HOMOLOGACION", "VIGENTE"), cert("PRODUCCION", "VIGENTE")],
      null,
    ],
  ] as const)("con los dos ambientes en uso, %s", (_nombre, certificados, esperado) => {
    expect(cartelDelCertificado(["HOMOLOGACION", "PRODUCCION"], certificados)).toBe(esperado);
    // El orden en que llegan no cambia el resultado.
    expect(cartelDelCertificado(["PRODUCCION", "HOMOLOGACION"], [...certificados].reverse())).toBe(
      esperado,
    );
  });

  it("SUPUESTO: sin ningún ambiente en uso cuentan los dos", () => {
    expect(
      cartelDelCertificado(
        [],
        [cert("HOMOLOGACION", "VIGENTE"), cert("PRODUCCION", "FALTA_CARGAR")],
      ),
    ).toBe("FALTA_CARGAR");
  });
});

describe("el certificado sin punto de venta activo (respuesta del dueño, 2026-10-29: «sigue faltando»)", () => {
  // Producción cargada y vigente: lo único que puede faltar es el punto de venta.
  const PRODUCCION_VIGENTE = [cert("PRODUCCION", "VIGENTE")];

  it.each([
    ["SIN_ACTIVOS", "Ninguno activo"],
    ["SIN_PUNTOS", "Falta crear uno"],
  ] as const)(
    "con %s la fila de puntos de venta lleva «%s» y la lista cuenta como «falta algo»",
    (puntos, cartel) => {
      const filas = armarLaLista(estado({ puntos, enUso: [], certificados: PRODUCCION_VIGENTE }));
      expect(filas.find((f) => f.clave === "PUNTOS_DE_VENTA")?.cartel?.texto).toBe(cartel);
      expect(filas.some((f) => f.cartel !== null)).toBe(true);
    },
  );
});

describe("las tres filas de la lista", () => {
  it("el orden y los textos aprobados; datos fiscales y puntos de venta llevan a su pantalla", () => {
    const filas = armarLaLista(
      estado({ datos: "SIN_CARGAR", puntos: "SIN_PUNTOS", enUso: [], certificados: [] }),
    );
    expect(filas.map((f) => f.titulo)).toEqual([
      "Datos fiscales",
      "Puntos de venta",
      "Certificado de ARCA",
    ]);
    expect(filas.map((f) => f.href)).toEqual([
      "/configuracion-fiscal/datos-fiscales",
      "/configuracion-fiscal/puntos-de-venta",
      // Su pantalla de estado no tiene textos aprobados: la fila no es un enlace.
      null,
    ]);
    expect(filas.map((f) => f.cartel?.texto ?? null)).toEqual([
      "Falta cargar",
      "Falta crear uno",
      // Sin certificados no hay nada que decir.
      null,
    ]);
  });

  it("un tema completo no lleva cartel", () => {
    const filas = armarLaLista(
      estado({ certificados: [cert("HOMOLOGACION", "VIGENTE"), cert("PRODUCCION", "VIGENTE")] }),
    );
    expect(filas.map((f) => f.cartel)).toEqual([null, null, null]);
  });

  it("los carteles con sus textos y tonos: Vencido es peligro, Ninguno activo es aviso, Pendiente es información", () => {
    const filas = armarLaLista(
      estado({
        datos: "BORRADOR",
        puntos: "SIN_ACTIVOS",
        certificados: [cert("HOMOLOGACION", "VIGENTE", true)],
      }),
    );
    expect(filas.map((f) => f.cartel)).toEqual([
      { texto: "Pendiente", tono: "info" },
      { texto: "Ninguno activo", tono: "aviso" },
      { texto: "Vencido", tono: "peligro" },
    ]);
  });

  it("las rutas son las aprobadas", () => {
    expect(RUTAS_DE_CONFIGURACION).toEqual({
      lista: "/configuracion-fiscal",
      puntosDeVenta: "/configuracion-fiscal/puntos-de-venta",
      nuevoPuntoDeVenta: "/configuracion-fiscal/puntos-de-venta/nuevo",
    });
  });
});
